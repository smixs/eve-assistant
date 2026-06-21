import { defineTool } from "eve/tools";
import { z } from "zod";

// Веб-поиск с выбором провайдера (SEARCH_PROVIDER: tavily|brave|exa|parallel).
// Скрейпинг DuckDuckGo выкинут: с серверного IP он отдаёт капчу и возвращает пусто.
// Каждый провайдер — пара чистых функций build()/parse() (SRP); провайдеры лежат в массиве
// PROVIDERS, а execute() диспетчеризует по нему, не зная реализаций (DIP). Новый бэкенд =
// добавить элемент в массив, плита fetch/normalize не трогается (OCP). Паттерн scripts/lib/ports.mjs.
// САМОДОСТАТОЧНО: только eve/tools, zod, node fetch (без cross-authored import — иначе ломается eve dev).
// Чтение страницы — web_fetch; интерактив/логин/JS — agent-browser.

const SNIPPET_MAX = 500; // усечение сниппета, чтобы поиск не раздувал контекст
const TITLE_MAX = 200;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

// ── мелкие безопасные геттеры (ответы провайдеров — нетипизированный JSON) ──
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const joinChunks = (v: unknown): string => arr(v).map(str).filter(Boolean).join(" … ");

type Normalized = { answer?: string; results: { title: string; url: string; snippet: string }[] };
type BuiltRequest = { url: string; method: "GET" | "POST"; headers: Record<string, string>; body?: string };

interface SearchProvider {
  name: string; // совпадает со значением SEARCH_PROVIDER
  keyEnv: string; // переменная окружения с ключом
  signupUrl: string; // для понятных сообщений об ошибке/в doctor
  build(query: string, n: number, key: string): BuiltRequest; // чистый билдер запроса, без I/O
  parse(json: unknown): Normalized; // чистый парсер ответа → нормализованная форма
}

// ── адаптеры провайдеров (факты сверены по официальным докам, июнь 2026) ──
const PROVIDERS: SearchProvider[] = [
  {
    name: "tavily",
    keyEnv: "TAVILY_API_KEY",
    signupUrl: "https://app.tavily.com",
    build: (query, n, key) => ({
      url: "https://api.tavily.com/search",
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, max_results: n, search_depth: "basic", include_answer: "basic", topic: "general" }),
    }),
    parse: (json) => {
      const d = json as { answer?: unknown; results?: unknown };
      const results = arr(d.results).map((r) => {
        const it = r as { title?: unknown; url?: unknown; content?: unknown };
        return { title: str(it.title), url: str(it.url), snippet: str(it.content) };
      });
      return { answer: str(d.answer) || undefined, results };
    },
  },
  {
    name: "brave",
    keyEnv: "BRAVE_API_KEY",
    signupUrl: "https://api-dashboard.search.brave.com",
    build: (query, n, key) => ({
      url: `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(n, 20)}`,
      method: "GET",
      headers: { Accept: "application/json", "X-Subscription-Token": key },
    }),
    parse: (json) => {
      const d = json as { web?: { results?: unknown } };
      const results = arr(d.web?.results).map((r) => {
        const it = r as { title?: unknown; url?: unknown; description?: unknown };
        return { title: str(it.title), url: str(it.url), snippet: str(it.description) };
      });
      return { results }; // web/search не отдаёт inline-answer
    },
  },
  {
    name: "exa",
    keyEnv: "EXA_API_KEY",
    signupUrl: "https://dashboard.exa.ai",
    build: (query, n, key) => ({
      url: "https://api.exa.ai/search",
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key },
      // без contents результаты приходят без текста — запрашиваем highlights/summary/text явно
      body: JSON.stringify({ query, type: "auto", numResults: n, contents: { text: true, highlights: true, summary: true } }),
    }),
    parse: (json) => {
      const d = json as { results?: unknown };
      const results = arr(d.results).map((r) => {
        const it = r as { title?: unknown; url?: unknown; highlights?: unknown; summary?: unknown; text?: unknown };
        return { title: str(it.title), url: str(it.url), snippet: joinChunks(it.highlights) || str(it.summary) || str(it.text) };
      });
      return { results }; // answer — только на отдельном /answer
    },
  },
  {
    name: "parallel",
    keyEnv: "PARALLEL_API_KEY",
    signupUrl: "https://platform.parallel.ai",
    build: (query, n, key) => ({
      url: "https://api.parallel.ai/v1/search",
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key },
      // search_queries обязателен; mode=basic — низкая латентность (advanced ~3с)
      body: JSON.stringify({ objective: query, search_queries: [query], mode: "basic", advanced_settings: { max_results: n } }),
    }),
    parse: (json) => {
      const d = json as { results?: unknown };
      const results = arr(d.results).map((r) => {
        const it = r as { title?: unknown; url?: unknown; excerpts?: unknown };
        return { title: str(it.title), url: str(it.url), snippet: joinChunks(it.excerpts) };
      });
      return { results }; // answer нет — отдаёт ранжированные excerpts
    },
  },
];

function pickProvider(): SearchProvider {
  const name = (process.env.SEARCH_PROVIDER || "tavily").trim().toLowerCase();
  return PROVIDERS.find((p) => p.name === name) ?? PROVIDERS[0]; // неизвестный → tavily
}

export default defineTool({
  description:
    "Поиск в интернете (провайдер из SEARCH_PROVIDER: tavily|brave|exa|parallel). Возвращает топ-результаты: " +
    "title, url, snippet (+ быстрый answer, если провайдер его даёт). Чтобы прочитать страницу — web_fetch; интерактив — agent-browser.",
  inputSchema: z.object({
    query: z.string().min(1).describe("Поисковый запрос"),
    count: z.number().int().min(1).max(10).optional().describe("Сколько результатов (по умолчанию 5)"),
  }),
  async execute({ query, count }) {
    const n = Math.min(count ?? 5, 10);
    const provider = pickProvider();
    const key = (process.env[provider.keyEnv] || "").trim();
    if (!key) {
      return {
        error: `web_search: ключ ${provider.keyEnv} не задан (SEARCH_PROVIDER=${provider.name}). Получи на ${provider.signupUrl}, впиши в .env и перезапусти Iva.`,
      };
    }

    const req = provider.build(query, n, key);
    let res: Response;
    try {
      res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
    } catch (e) {
      return { error: `сеть: ${(e as Error).message}` };
    }

    if (res.status === 401 || res.status === 403) return { error: `${provider.name} отклонил ключ (401/403) — проверь ${provider.keyEnv}.` };
    if (res.status === 429) return { error: `${provider.name}: превышен лимит запросов (429) — попробуй позже.` };
    if (!res.ok) return { error: `${provider.name} HTTP ${res.status}` };

    let json: unknown;
    try {
      json = await res.json();
    } catch (e) {
      return { error: `${provider.name}: некорректный JSON (${(e as Error).message})` };
    }

    const norm = provider.parse(json);
    const results = norm.results
      .filter((r) => r.url)
      .slice(0, n)
      .map((r) => ({ title: clip(r.title, TITLE_MAX), url: r.url, snippet: clip(r.snippet, SNIPPET_MAX) }));
    const answer = norm.answer && norm.answer.trim() ? norm.answer.trim() : undefined;

    if (!results.length) return { results: [], ...(answer ? { answer } : {}), note: "Ничего не найдено." };
    return answer ? { answer, results } : { results };
  },
});
