// VPS cron-runner: asks the agent for a morning digest and sends it to Telegram.
// Launched from system cron (see README/implementation-notes).
//
//   0 5 * * *  cd /srv/assistant && node --env-file=.env scripts/daily-digest.ts >> /var/log/assistant-cron.log 2>&1
//
// Requires: a running agent (eve start) and the TELEGRAM_BOT_TOKEN, TELEGRAM_DIGEST_CHAT_ID variables.
import { Client } from "eve/client";
import { sendTelegramHtml } from "./lib/telegram-send.mjs";

const PORT = process.env.IVA_PORT ?? "8723";
const HOST = process.env.ASSISTANT_HOST ?? `http://127.0.0.1:${PORT}`;
const BOT = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_DIGEST_CHAT_ID;
const BEARER = process.env.ASSISTANT_BEARER; // needed if the eve channel in prod requires auth

if (!BOT || !CHAT) {
  console.error("TELEGRAM_BOT_TOKEN and TELEGRAM_DIGEST_CHAT_ID are required");
  process.exit(1);
}

const client = new Client({
  host: HOST,
  ...(BEARER ? { auth: { bearer: async () => BEARER } } : {}),
});

const session = client.session();
const response = await session.send(
  "Load the morning-digest skill and build the morning digest for my tasks. " +
    "Return only the finished digest text, no preamble.",
);
const result = await response.result();

// An interactive turn ends with status "waiting" (the session is ready for the next message),
// so we key off the presence of text rather than the "completed" status.
if (result.status === "failed" || !result.message) {
  console.error("Agent did not return a digest:", result.status);
  process.exit(1);
}

// The markdown → Telegram-HTML conversion + self-heal live in a shared helper.
const r = await sendTelegramHtml(BOT, CHAT, result.message);
if (r.fellBack) {
  await session.send(
    `The last digest failed Telegram parse_mode=HTML (${r.error}) and was sent as plain text — ` +
      "format more simply next time: **bold**, `code`, lists, no raw HTML.",
  );
}
if (!r.ok) {
  console.error("digest: Telegram send failed:", r.error);
  process.exit(1);
}
console.log("Digest sent to Telegram.");
