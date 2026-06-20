#!/usr/bin/env node
// Интерактивная настройка ассистента «Ева»: пишет .env.
// Пошаговый гайд с инструкциями откуда брать каждый ключ, живой валидацией и
// циклом — скрипт НЕ завершится, пока не введены все обязательные секреты.
// Без внешних зависимостей.
import { createInterface } from "node:readline/promises";
import { createReadStream } from "node:fs";
import { readFile, writeFile, access } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = join(ROOT, ".env");
const OLLAMA_BASE = "https://ollama.com/v1";

const C = { g: "\x1b[32m", y: "\x1b[33m", c: "\x1b[36m", b: "\x1b[1m", r: "\x1b[31m", x: "\x1b[0m" };
const TOTAL = 5;

// Ввод из tty даже при запуске через `curl | bash`.
const input = process.stdin.isTTY ? process.stdin : createReadStream("/dev/tty");
const rl = createInterface({ input, output: process.stdout });

const ask = async (q, def = "") => {
  const a = (await rl.question(def ? `${q} [${def}]: ` : `${q}: `)).trim();
  return a || def;
};
const askYesNo = async (q, def = false) => {
  const a = (await ask(`${q} (${def ? "Y/n" : "y/N"})`)).toLowerCase();
  return a ? a.startsWith("y") : def;
};
const mask = (s) => (s ? s.slice(0, 6) + "…(оставить)" : "");
const hr = () => console.log(`${C.c}  ────────────────────────────────────────────${C.x}`);
const head = (n, title) => console.log(`\n${C.b}${C.c}  Шаг ${n}/${TOTAL}: ${title}${C.x}`);

// Повторяет вопрос, пока не получит непустое и (если задано) валидное значение.
async function askRequired(label, { help = "", existing = "", validate = null } = {}) {
  for (;;) {
    if (help) console.log(help);
    let a = await ask(label, existing ? mask(existing) : "");
    if (existing && (!a || a.endsWith("…(оставить)"))) a = existing;
    a = (a || "").trim();
    if (!a) {
      console.log(`${C.y}  ⚠ Обязательное поле — без него Ева не заработает. Введи значение.${C.x}\n`);
      continue;
    }
    if (validate) {
      process.stdout.write("  проверяю… ");
      const err = await validate(a);
      if (err) {
        console.log(`${C.r}не ок${C.x}\n${C.y}  ⚠ ${err}${C.x}\n`);
        continue;
      }
      console.log(`${C.g}ок${C.x}`);
    }
    return a;
  }
}

function parseEnv(text) {
  const env = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}
async function loadExistingEnv() {
  try {
    await access(ENV_PATH);
    return parseEnv(await readFile(ENV_PATH, "utf8"));
  } catch {
    return {};
  }
}

async function ollamaModels(key) {
  const res = await fetch(`${OLLAMA_BASE}/models`, { headers: { Authorization: `Bearer ${key}` } });
  if (res.status === 401 || res.status === 403) {
    throw Object.assign(new Error("ключ отклонён"), { auth: true });
  }
  if (!res.ok) throw new Error(`Ollama API вернул ${res.status}`);
  return ((await res.json()).data || []).map((m) => m.id).sort();
}
async function deepgramCheck(key) {
  try {
    const res = await fetch("https://api.deepgram.com/v1/projects", {
      headers: { Authorization: `Token ${key}` },
    });
    if (res.status === 401 || res.status === 403) {
      return "Deepgram не принял ключ (401/403). Скопируй ключ целиком со страницы API Keys.";
    }
    return null; // 200 или иной — ключ хотя бы валиден по форме
  } catch {
    return null; // сеть барахлит — не блокируем установку
  }
}
async function telegramGetMe(token) {
  const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  const j = await res.json();
  if (!j.ok) throw new Error(j.description || "токен отклонён");
  return j.result; // { id, username, first_name, ... }
}
async function fetchTelegramUserIds(token) {
  const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.description || "getUpdates не сработал");
  const seen = new Map();
  for (const u of json.result || []) {
    const m = u.message || u.edited_message;
    const f = m?.from;
    if (f && !seen.has(String(f.id))) {
      const name = [f.first_name, f.last_name, f.username ? `@${f.username}` : ""].filter(Boolean).join(" ");
      seen.set(String(f.id), { id: String(f.id), name: name || "(без имени)" });
    }
  }
  return [...seen.values()];
}

async function main() {
  console.log(`\n${C.b}${C.g}  Настройка Евы — вводим секреты по шагам${C.x}`);
  console.log("  Займёт пару минут. Для каждого ключа подскажу, где его взять и проверю на месте.");
  console.log(`  ${C.y}Скрипт не завершится, пока не введёшь все обязательные секреты.${C.x}`);
  const existing = await loadExistingEnv();
  const out = { ...existing };

  // ── Шаг 1: Ollama Cloud (LLM) ─────────────────────────────────────
  head(1, "Ollama Cloud — мозг Евы (модель)");
  console.log(`  Где взять ключ: ${C.c}https://ollama.com/settings/keys${C.x}`);
  console.log("    1) войди/зарегистрируйся на ollama.com");
  console.log("    2) Settings → Keys → Create key");
  console.log("    3) скопируй ключ целиком");
  let models = [];
  out.OLLAMA_API_KEY = await askRequired("  Вставь ключ Ollama", {
    existing: process.env.OLLAMA_API_KEY || existing.OLLAMA_API_KEY || "",
    validate: async (k) => {
      try {
        models = await ollamaModels(k);
        return null;
      } catch (e) {
        return e.auth
          ? "Ollama не принял ключ. Скопируй заново со страницы Keys (без пробелов)."
          : `не смог проверить ключ: ${e.message}. Проверь интернет и повтори.`;
      }
    },
  });

  const RECOMMENDED = "deepseek-v4-pro";
  console.log(`\n  Доступно моделей: ${models.length}. Рекомендую ${C.g}${RECOMMENDED}${C.x}.`);
  models.forEach((id, i) =>
    console.log(`   ${String(i + 1).padStart(2)}. ${id}${id === RECOMMENDED ? `  ${C.g}★${C.x}` : ""}`),
  );
  const defIdx = models.indexOf(out.OLLAMA_MODEL || RECOMMENDED);
  const defNum = (defIdx >= 0 ? defIdx : Math.max(0, models.indexOf(RECOMMENDED))) + 1;
  const choice = await ask("\n  Номер модели", String(defNum || 1));
  let idx = parseInt(choice, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= models.length) idx = defNum - 1;
  out.OLLAMA_MODEL = models[idx] || RECOMMENDED;
  out.OLLAMA_CONTEXT_WINDOW = out.OLLAMA_CONTEXT_WINDOW || "131072";
  console.log(`  → модель: ${C.g}${out.OLLAMA_MODEL}${C.x}`);

  // ── Шаг 2: Deepgram (голос/видео) ─────────────────────────────────
  head(2, "Deepgram — расшифровка голоса и видео");
  console.log(`  Где взять ключ: ${C.c}https://console.deepgram.com${C.x}`);
  console.log("    1) зарегистрируйся (дают бесплатный стартовый кредит)");
  console.log("    2) API Keys → Create a New API Key");
  console.log("    3) скопируй ключ");
  out.DEEPGRAM_API_KEY = await askRequired("  Вставь Deepgram API key", {
    existing: process.env.DEEPGRAM_API_KEY || existing.DEEPGRAM_API_KEY || "",
    validate: deepgramCheck,
  });
  out.DEEPGRAM_LANGUAGE = await ask("  Язык распознавания (multi = авто ru/uz/en)", out.DEEPGRAM_LANGUAGE || "multi");

  // ── Шаг 3: Telegram-бот ───────────────────────────────────────────
  head(3, "Telegram-бот — через него ты говоришь с Евой");
  console.log("  Создай бота у @BotFather в Telegram:");
  console.log("    1) открой чат с @BotFather");
  console.log("    2) отправь /newbot");
  console.log("    3) задай имя и username бота");
  console.log("    4) скопируй token вида 123456789:ABCdef...");
  let me = null;
  out.TELEGRAM_BOT_TOKEN = await askRequired("  Вставь Bot token", {
    existing: existing.TELEGRAM_BOT_TOKEN || "",
    validate: async (t) => {
      try {
        me = await telegramGetMe(t);
        return null;
      } catch (e) {
        return `Telegram не принял токен (${e.message}). Скопируй заново у @BotFather.`;
      }
    },
  });
  out.TELEGRAM_BOT_USERNAME =
    me?.username || out.TELEGRAM_BOT_USERNAME || (await ask("  Username бота (без @)", existing.TELEGRAM_BOT_USERNAME || ""));
  if (me?.username) console.log(`  → бот: ${C.g}@${me.username}${C.x}`);
  out.TELEGRAM_WEBHOOK_SECRET_TOKEN = existing.TELEGRAM_WEBHOOK_SECRET_TOKEN || randomBytes(24).toString("hex");

  // ── Шаг 4: доверенные пользователи (цикл до ≥1 ID) ────────────────
  head(4, "Доступ — кому бот вообще отвечает");
  console.log(`  ${C.y}ВАЖНО:${C.x} Ева отвечает ТОЛЬКО доверенным Telegram ID.`);
  console.log("  Без хотя бы одного ID бот промолчит всем (так твои данные защищены).");
  const ids = new Set(
    (existing.TELEGRAM_ALLOWED_USER_IDS || "").split(/[,\s]+/).map((s) => s.trim()).filter(Boolean),
  );
  while (ids.size === 0) {
    console.log(
      `\n  Определим твой ID. ${C.c}Открой Telegram, найди @${out.TELEGRAM_BOT_USERNAME || "своего_бота"} и напиши ему любое сообщение${C.x} (напр. «привет»).`,
    );
    await ask("  Написал боту? нажми Enter");
    try {
      const found = await fetchTelegramUserIds(out.TELEGRAM_BOT_TOKEN);
      if (found.length) {
        console.log("  Нашёл, кто писал боту:");
        found.forEach((u, i) => console.log(`   ${i + 1}. ${u.id}  ${u.name}`));
        const pick = await ask("  Чьи ID добавить? номера через запятую (Enter — добавить всех)", "");
        const chosen = pick
          ? pick.split(/[,\s]+/).map((n) => found[parseInt(n, 10) - 1]).filter(Boolean)
          : found;
        chosen.forEach((u) => ids.add(u.id));
      } else {
        console.log(`${C.y}  Не вижу сообщений боту. Точно написал? (если уже стоит вебхук — getUpdates не отдаёт апдейты)${C.x}`);
      }
    } catch (e) {
      console.log(`${C.y}  Не смог получить апдейты: ${e.message}${C.x}`);
    }
    if (ids.size === 0) {
      const manual = await ask(
        "  Введи свой Telegram ID вручную (узнать: напиши @userinfobot), или Enter — попробовать снова",
        "",
      );
      manual.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean).forEach((s) => ids.add(s));
    }
  }
  out.TELEGRAM_ALLOWED_USER_IDS = [...ids].join(",");
  out.TELEGRAM_DIGEST_CHAT_ID = existing.TELEGRAM_DIGEST_CHAT_ID || [...ids][0] || "";
  console.log(`  → доступ разрешён ID: ${C.g}${out.TELEGRAM_ALLOWED_USER_IDS}${C.x}`);

  // ── Шаг 5: часовой пояс и vault ───────────────────────────────────
  head(5, "Часовой пояс и хранилище памяти");
  console.log("  Часовой пояс нужен, чтобы Ева понимала твоё реальное время, а не время сервера.");
  out.ASSISTANT_TIMEZONE = await ask(
    "  Часовой пояс (IANA, напр. Asia/Almaty, Asia/Tashkent, Europe/Moscow)",
    out.ASSISTANT_TIMEZONE || "Asia/Almaty",
  );
  out.ASSISTANT_VAULT_DIR = await ask("  Каталог vault (память + git-бэкап)", out.ASSISTANT_VAULT_DIR || "vault");
  out.ASSISTANT_DATA_DIR = out.ASSISTANT_DATA_DIR || "data";
  out.ASSISTANT_HOST = out.ASSISTANT_HOST || "http://127.0.0.1:3000";

  // ── Запись .env ───────────────────────────────────────────────────
  const order = [
    "OLLAMA_API_KEY", "OLLAMA_MODEL", "OLLAMA_CONTEXT_WINDOW",
    "TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_USERNAME", "TELEGRAM_WEBHOOK_SECRET_TOKEN",
    "TELEGRAM_ALLOWED_USER_IDS", "TELEGRAM_DIGEST_CHAT_ID",
    "DEEPGRAM_API_KEY", "DEEPGRAM_LANGUAGE",
    "ASSISTANT_TIMEZONE", "ASSISTANT_VAULT_DIR",
    "ASSISTANT_DATA_DIR", "ASSISTANT_HOST", "ASSISTANT_BEARER",
  ];
  const keys = [...order.filter((k) => out[k] != null), ...Object.keys(out).filter((k) => !order.includes(k))];
  const body = keys.map((k) => `${k}=${out[k]}`).join("\n") + "\n";
  await writeFile(ENV_PATH, body, "utf8");

  console.log();
  hr();
  console.log(`${C.g}${C.b}  ✓ Готово — всё записано в .env${C.x}`);
  console.log(`  Модель: ${C.g}${out.OLLAMA_MODEL}${C.x} · Deepgram: ${out.DEEPGRAM_LANGUAGE} · Бот: ${C.g}@${out.TELEGRAM_BOT_USERNAME}${C.x}`);
  console.log(`  Доступ: ${out.TELEGRAM_ALLOWED_USER_IDS} · TZ: ${out.ASSISTANT_TIMEZONE} · vault: ${out.ASSISTANT_VAULT_DIR}`);
  hr();
  rl.close();
}

main().catch((e) => {
  console.error(`${C.r}Настройка прервана:${C.x}`, e?.message || e);
  process.exit(1);
});
