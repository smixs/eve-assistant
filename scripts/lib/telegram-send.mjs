// Единая сетевая отправка форматированного сообщения в Telegram. Используется обоими
// cron-скриптами (rollup, daily-digest), чтобы конвертация + self-heal жили в одном месте.
//
// Контракт sendTelegramHtml:
//   • model-markdown → валидный Telegram-HTML через общий конвертер, режется на чанки ≤4096;
//   • каждый чанк шлётся с parse_mode=HTML;
//   • если Telegram вернул 400 (не распарсил сущности) — ОДНА повторная попытка тем же
//     чанком, но без тегов и без parse_mode (так 400 по сущностям невозможен), fellBack=true;
//   • НИКОГДА не бросает — на любую ошибку возвращает { ok:false, error }.
// Возвращает { ok, fellBack, error } — вызывающий cron-скрипт по fellBack даёт агенту
// обратную связь в ту же сессию, чтобы он переформатировал следующий отчёт.
// htmlToPlain (HTML→plain с декодом сущностей) живёт в общем модуле — тот же
// фолбэк-декодер использует и Telegram-канал (agent/channels/telegram.ts).
import { toTelegramHtmlChunks, htmlToPlain } from "./telegram-format.mjs";

async function post(bot, body) {
  const res = await fetch(`https://api.telegram.org/bot${bot}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, text: res.ok ? "" : await res.text() };
}

export async function sendTelegramHtml(bot, chat, md, { caption = false } = {}) {
  let fellBack = false;
  try {
    for (const chunk of toTelegramHtmlChunks(md, caption ? 1024 : 4096)) {
      const r = await post(bot, { chat_id: chat, text: chunk, parse_mode: "HTML" });
      if (r.ok) continue;
      // 400 = Telegram не распарсил HTML. Одна повторная попытка без тегов/parse_mode.
      if (r.status === 400) {
        fellBack = true;
        const plain = await post(bot, { chat_id: chat, text: htmlToPlain(chunk) });
        if (!plain.ok) return { ok: false, fellBack, error: `plain retry ${plain.status}: ${plain.text}` };
        continue;
      }
      return { ok: false, fellBack, error: `${r.status}: ${r.text}` };
    }
    return { ok: true, fellBack, error: "" };
  } catch (e) {
    return { ok: false, fellBack, error: String(e?.message ?? e) };
  }
}
