import { defineTool } from "eve/tools";
import { z } from "zod";

// Веб-поиск без API-ключа через DuckDuckGo HTML-эндпоинт — работает с любого IP (в т.ч. RU).
// Переопределяет встроенный eve web_search (тот провайдерный и с Ollama/DeepSeek — заглушка-исключение).
// Для чтения конкретной страницы агент использует встроенный web_fetch; для интерактива — agent-browser.
// САМОДОСТАТОЧНО: только eve/tools, zod, node fetch.

const SNIPPET_MAX = 300; // усечение, чтобы поиск не раздувал контекст
const TITLE_MAX = 200;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHref(href: string): string {
  // DDG оборачивает результат в редирект /l/?uddg=<urlencoded>.
  const m = href.match(/[?&]uddg=([^&]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      /* fallthrough */
    }
  }
  return href.startsWith("//") ? "https:" + href : href;
}

export default defineTool({
  description:
    "Поиск в интернете (DuckDuckGo, без ключа). Возвращает топ-результаты: title, url, snippet. " +
    "Чтобы прочитать конкретную страницу — вызови web_fetch с url. Для интерактива/логина/JS — agent-browser.",
  inputSchema: z.object({
    query: z.string().min(1).describe("Поисковый запрос"),
    count: z.number().int().min(1).max(10).optional().describe("Сколько результатов (по умолчанию 5)"),
  }),
  async execute({ query, count }) {
    const n = Math.min(count ?? 5, 10);
    let res: Response;
    try {
      res = await fetch("https://html.duckduckgo.com/html/", {
        method: "POST",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; iva-agent/1.0)",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `q=${encodeURIComponent(query)}`,
      });
    } catch (e) {
      return { error: `сеть: ${(e as Error).message}` };
    }
    if (!res.ok) return { error: `DuckDuckGo HTTP ${res.status}` };
    const html = await res.text();

    const snippets: string[] = [];
    const snippetRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let sm: RegExpExecArray | null;
    while ((sm = snippetRe.exec(html)) !== null) snippets.push(clip(stripTags(sm[1]), SNIPPET_MAX));

    const results: Array<{ title: string; url: string; snippet: string }> = [];
    const linkRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let m: RegExpExecArray | null;
    let i = 0;
    while ((m = linkRe.exec(html)) !== null && results.length < n) {
      results.push({
        title: clip(stripTags(m[2]), TITLE_MAX),
        url: decodeHref(m[1]),
        snippet: snippets[i] ?? "",
      });
      i++;
    }

    return results.length ? { results } : { results: [], note: "Ничего не найдено." };
  },
});
