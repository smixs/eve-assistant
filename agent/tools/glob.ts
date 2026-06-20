import { defineTool } from "eve/tools";
import { z } from "zod";
import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

// Host-native glob. Переопределяет встроенный glob eve: ищет файлы на реальной ФС VPS.
// fast-glob в node_modules отсутствует, поэтому реализовано через рекурсивный обход fs
// и собственный матчер glob-паттернов. Самодостаточно (eve/tools, zod, node-builtins).

// Перевод glob-паттерна в RegExp. Поддержка: ** (любые сегменты, вкл. /),
// * (любые символы кроме /), ? (один символ кроме /).
function globToRegExp(pattern: string): RegExp {
  // Нормализуем разделители под posix-стиль (внутри сравниваем по "/").
  const p = pattern.split(sep).join("/");
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*") {
      if (p[i + 1] === "*") {
        // ** — любое число сегментов, опционально со слэшем после
        re += "(?:.*)";
        i++;
        if (p[i + 1] === "/") i++; // съедаем слэш после **
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if ("\\^$+.()|{}[]".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

// Игнорируем тяжёлые/мусорные директории при обходе.
const IGNORE_DIRS = new Set([".git", "node_modules", ".next", "dist", ".cache"]);

async function walk(root: string, dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // нет доступа / директория исчезла — пропускаем
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      await walk(root, full, out);
    } else if (entry.isFile()) {
      out.push(relative(root, full).split(sep).join("/"));
    }
  }
}

export default defineTool({
  description:
    "Найти файлы по glob-паттерну НАПРЯМУЮ на файловой системе хоста VPS. " +
    "Поддерживает ** (любые поддиректории), * и ?. Поиск относительно cwd " +
    "(по умолчанию текущая рабочая директория процесса). Возвращает массив путей " +
    "(относительно cwd). Директории .git/node_modules/dist и т.п. пропускаются.",
  inputSchema: z.object({
    pattern: z.string().min(1).describe("Glob-паттерн, напр. **/*.ts или vault/daily/*.md"),
    cwd: z.string().optional().describe("Базовая директория поиска (абсолютный путь)"),
  }),
  async execute({ pattern, cwd }) {
    const root = cwd ?? process.cwd();
    const all: string[] = [];
    await walk(root, root, all);
    const re = globToRegExp(pattern);
    const matches = all.filter((p) => re.test(p)).sort();
    return matches;
  },
});
