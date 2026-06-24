// Учёт расхода токенов — ЕДИНЫЙ источник правды по формату usage.jsonl, чтению и сводкам.
// Переиспользуется хуком (запись: agent/hooks/usage.ts), Telegram-мостом и CLI `iva usage`
// (чтение). Чистый ESM (только node-builtins) — бандлится в eve и работает в bare-node,
// как scripts/lib/telegram-format.mjs.
//
// Лог живёт в data/usage.jsonl (ASSISTANT_DATA_DIR, дефолт ./data) — рядом с tasks.json,
// gitignored, НЕ в vault (иначе ночной doctor коммитил бы растущий лог в репо памяти).
// Одна строка JSONL на шаг модели; ход (turn) = несколько шагов, группируем по turnId.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const defaultDir = () => process.env.ASSISTANT_DATA_DIR || "data";

export function usageFilePath(dataDir = defaultDir()) {
  return join(dataDir, "usage.jsonl");
}

// Sync append (как transcript.ts) — короткая дозапись против латентности модели, без
// interleave от конкурентных асинхронных записей.
export function appendUsage(record, dataDir = defaultDir()) {
  const file = usageFilePath(dataDir);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(record) + "\n", "utf8");
}

// Толерантный парсер: нет файла → пусто; битую строку (обрыв при падении на середине
// append) — молча пропускаем.
export function readEntries(dataDir = defaultDir()) {
  let raw;
  try {
    raw = readFileSync(usageFilePath(dataDir), "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      out.push(JSON.parse(s));
    } catch {
      /* битая/частичная строка — пропускаем */
    }
  }
  return out;
}

// Нормализуем аргумент команды → допустимое окно (дефолт last).
export function parseWindow(arg) {
  const a = (arg || "").trim().toLowerCase().replace(/^by[ -]/, "by-");
  const ok = ["last", "today", "week", "month", "by-model", "by-source"];
  return ok.includes(a) ? a : "last";
}

// Локальная дата YYYY-MM-DD в TZ пользователя (как transcript.ts/telegram.ts) — строковое
// сравнение, не ловит naive-UTC-midnight баг.
function localDate(ts, tz) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz || undefined,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ts));
}

function inWindow(e, window, now, tz) {
  const t = Date.parse(e.ts);
  if (Number.isNaN(t)) return false;
  if (window === "today") return localDate(e.ts, tz) === localDate(now, tz);
  if (window === "month") return localDate(e.ts, tz).slice(0, 7) === localDate(now, tz).slice(0, 7);
  if (window === "week") return t >= now - 7 * 86400000;
  return true; // lifetime — by-model/by-source
}

const blank = () => ({ in: 0, out: 0, cacheRead: 0, cacheWrite: 0, total: 0, steps: 0, turns: new Set() });
function add(acc, e) {
  acc.in += e.in || 0;
  acc.out += e.out || 0;
  acc.cacheRead += e.cacheRead || 0;
  acc.cacheWrite += e.cacheWrite || 0;
  acc.total += e.total || 0;
  acc.steps += 1;
  acc.turns.add(`${e.sessionId}:${e.turnId}`);
}
const finalize = (a) => ({
  in: a.in, out: a.out, cacheRead: a.cacheRead, cacheWrite: a.cacheWrite,
  total: a.total, steps: a.steps, turns: a.turns.size,
});
function rowsOf(map) {
  return [...map].map(([key, acc]) => ({ key, ...finalize(acc) })).sort((x, y) => y.total - x.total);
}

export function summarize(entries, { window = "last", now = Date.now(), tz } = {}) {
  if (window === "last") {
    if (!entries.length) return { window, last: null };
    const lastE = entries[entries.length - 1];
    const key = `${lastE.sessionId}:${lastE.turnId}`;
    const acc = blank();
    let model = lastE.model, source = lastE.source, subagent = null, when = lastE.ts;
    for (const e of entries) {
      if (`${e.sessionId}:${e.turnId}` !== key) continue;
      add(acc, e);
      model = e.model;
      if (e.subagent) subagent = e.subagent;
    }
    return { window, last: { ...finalize(acc), model, source, subagent, when } };
  }
  if (window === "by-model" || window === "by-source") {
    const keyFn = window === "by-model" ? (e) => e.model || "?" : (e) => e.source || "?";
    const groups = new Map();
    const tot = blank();
    for (const e of entries) {
      const k = keyFn(e);
      if (!groups.has(k)) groups.set(k, blank());
      add(groups.get(k), e);
      add(tot, e);
    }
    return { window, rows: rowsOf(groups), totals: finalize(tot) };
  }
  // today / week / month — итог + разбивка по источникам и моделям
  const win = entries.filter((e) => inWindow(e, window, now, tz));
  const tot = blank(), bySrc = new Map(), byMod = new Map();
  for (const e of win) {
    add(tot, e);
    const s = e.source || "?";
    if (!bySrc.has(s)) bySrc.set(s, blank());
    add(bySrc.get(s), e);
    const m = e.model || "?";
    if (!byMod.has(m)) byMod.set(m, blank());
    add(byMod.get(m), e);
  }
  return { window, totals: finalize(tot), bySource: rowsOf(bySrc), byModel: rowsOf(byMod) };
}

const WINDOW_LABEL = {
  last: "Последний ход", today: "Сегодня", week: "За 7 дней", month: "За месяц",
  "by-model": "По моделям", "by-source": "По источникам",
};
const SOURCE_LABEL = { telegram: "чат", http: "фон (cron/digest)", unknown: "прочее" };
const src = (k) => SOURCE_LABEL[k] || k;
const num = (n) => String(n ?? 0).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

export function formatUsageReport(agg) {
  const w = agg.window;
  if (w === "last") {
    if (!agg.last) return "Расхода пока нет — лог usage пуст.";
    const l = agg.last;
    const sub = l.subagent ? ` (+субагент ${l.subagent})` : "";
    return [
      `Последний ход: ${num(l.total)} ток${sub}`,
      `вход ${num(l.in)} · выход ${num(l.out)}${l.cacheRead ? ` · из кэша ${num(l.cacheRead)}` : ""}`,
      `${num(l.steps)} шаг(ов) · ${l.model} · ${src(l.source)}`,
    ].join("\n");
  }
  if (w === "by-model" || w === "by-source") {
    if (!agg.rows.length) return "Расхода пока нет — лог usage пуст.";
    const lines = agg.rows.map(
      (r) => `• ${w === "by-source" ? src(r.key) : r.key}: ${num(r.total)} ток (${num(r.turns)} ход.)`,
    );
    return [`${WINDOW_LABEL[w]} (всего ${num(agg.totals.total)} ток):`, ...lines].join("\n");
  }
  const t = agg.totals;
  if (!t.steps) return `${WINDOW_LABEL[w]}: расхода нет.`;
  const out = [`${WINDOW_LABEL[w]}: ${num(t.total)} ток (вход ${num(t.in)} / выход ${num(t.out)}) · ${num(t.turns)} ход.`];
  if (agg.bySource.length > 1) {
    out.push("Источники:");
    for (const r of agg.bySource) out.push(`• ${src(r.key)}: ${num(r.total)}`);
  }
  if (agg.byModel.length > 1) {
    out.push("Модели:");
    for (const r of agg.byModel) out.push(`• ${r.key}: ${num(r.total)}`);
  }
  return out.join("\n");
}
