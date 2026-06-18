import { defineAgent } from "eve";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

// Ollama Cloud по OpenAI-совместимому эндпоинту (/v1); ключ из окружения.
// Модель определяется прямо здесь: eve резолвит ссылку на модель из исходника
// authored-слота agent.ts, а import-only lib/ для этого не годится.
const ollama = createOpenAICompatible({
  name: "ollama-cloud",
  baseURL: "https://ollama.com/v1",
  apiKey: process.env.OLLAMA_API_KEY,
});

// Модель и размер окна настраиваются через .env (см. scripts/setup.mjs).
const MODEL = process.env.OLLAMA_MODEL ?? "deepseek-v4-pro";
const CONTEXT_WINDOW = Number(process.env.OLLAMA_CONTEXT_WINDOW ?? 131072);

export default defineAgent({
  model: ollama(MODEL),
  // Кастомный провайдер не отдаёт метаданные окна через AI Gateway — задаём вручную.
  modelContextWindowTokens: CONTEXT_WINDOW,
});
