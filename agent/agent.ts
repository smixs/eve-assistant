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

export default defineAgent({
  // DeepSeek-V4-Pro: MoE, tool calling подтверждён, reasoning отдельным полем.
  model: ollama("deepseek-v4-pro:cloud"),
  // Кастомный провайдер не отдаёт метаданные окна через AI Gateway — задаём вручную.
  modelContextWindowTokens: 131072,
});
