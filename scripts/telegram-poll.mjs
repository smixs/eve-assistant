#!/usr/bin/env node
// Telegram long-polling мост → локальный webhook-роут eve.
//
//   node --env-file=.env scripts/telegram-poll.mjs
//
// eve Telegram-канал работает ТОЛЬКО по webhook (POST /eve/v1/telegram, проверка
// заголовка X-Telegram-Bot-Api-Secret-Token). На голом VPS публичного HTTPS нет,
// поэтому сами забираем апдейты у Telegram (getUpdates, long-poll) и POST-им их в
// локальный роут eve с тем же секретом — Telegram видит обычного бота, прокси не нужен.
// Канал/агент не меняются. Webhook и polling взаимоисключающи → на старте deleteWebhook.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN;
const HOST = (process.env.ASSISTANT_HOST ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const DATA_DIR = process.env.ASSISTANT_DATA_DIR ?? "data";
const ROUTE = `${HOST}/eve/v1/telegram`;
const API = `https://api.telegram.org/bot${TOKEN}`;
const OFFSET_FILE = join(DATA_DIR, "telegram-offset.json");

if (!TOKEN) {
  console.error("telegram-poll: нет TELEGRAM_BOT_TOKEN в .env — нечем поллить.");
  process.exit(1);
}
if (!SECRET) {
  console.error("telegram-poll: нет TELEGRAM_WEBHOOK_SECRET_TOKEN — канал не примет апдейты.");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);

// null ⇒ файла нет (первый запуск) — отличаем от честного offset 0.
async function loadOffset() {
  try {
    const { offset } = JSON.parse(await readFile(OFFSET_FILE, "utf8"));
    return typeof offset === "number" ? offset : null;
  } catch {
    return null;
  }
}

// Первый запуск: встать за хвост очереди (последний update_id + 1), чтобы не реплеить
// install-бэклог. drop_pending уже чистит очередь у Telegram — это пояс поверх подтяжек.
async function fastForwardOffset() {
  try {
    const data = await tg("getUpdates", { offset: -1, timeout: 0 });
    const list = data.ok ? data.result || [] : [];
    return list.length ? list[list.length - 1].update_id + 1 : 0;
  } catch (e) {
    log("fast-forward offset не удался:", e.message);
    return 0;
  }
}

async function saveOffset(offset) {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(OFFSET_FILE, JSON.stringify({ offset }), "utf8");
  } catch (e) {
    log("offset save failed:", e.message);
  }
}

async function tg(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return res.json();
}

// Доставить один апдейт в локальный eve (имитируем webhook). Ждём 2xx — не теряем апдейт,
// даже если сервер ещё поднимается (бэкофф до 15с).
async function deliver(update) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(ROUTE, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": SECRET,
        },
        body: JSON.stringify(update),
      });
      if (res.ok) return;
      log(`deliver: eve ответил ${res.status} (попытка ${attempt}) — ретрай`);
    } catch (e) {
      log(`deliver: eve недоступен (${e.message}, попытка ${attempt}) — жду сервер`);
    }
    await sleep(Math.min(15000, 1000 * attempt));
  }
}

async function main() {
  log(`telegram-poll старт → ${ROUTE}`);
  // Снять webhook И сбросить накопленный бэклог: на старте не реплеим старое (иначе
  // install-очередь выливается одной пачкой и ломает сериализацию сессий eve).
  const dw = await tg("deleteWebhook", { drop_pending_updates: true });
  log("deleteWebhook(drop_pending):", dw.ok ? "ок" : dw.description);

  let offset = await loadOffset();
  if (offset === null) {
    offset = await fastForwardOffset();
    log("первый запуск — offset за хвостом очереди:", offset);
    await saveOffset(offset);
  } else {
    log("стартовый offset:", offset);
  }

  for (;;) {
    let data;
    try {
      data = await tg("getUpdates", {
        offset,
        timeout: 30,
        allowed_updates: ["message", "callback_query"],
      });
    } catch (e) {
      log("getUpdates сеть:", e.message);
      await sleep(3000);
      continue;
    }
    if (!data.ok) {
      log("getUpdates:", data.description);
      // 409/конфликт — где-то остался webhook; снимаем и пробуем снова.
      if (/409|conflict|webhook/i.test(data.description || "")) {
        await tg("deleteWebhook", { drop_pending_updates: false });
      }
      await sleep(3000);
      continue;
    }
    for (const update of data.result || []) {
      await deliver(update); // ждём успешной доставки — порядок и без потерь
      offset = update.update_id + 1;
      await saveOffset(offset);
    }
  }
}

main().catch((e) => {
  console.error("telegram-poll фатально:", e);
  process.exit(1);
});
