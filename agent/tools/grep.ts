import { defineTool } from "eve/tools";
import { z } from "zod";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

// Host-native grep. Переопределяет встроенный grep eve: regex-поиск по содержимому
// реальных файлов на ФС VPS (node:fs + RegExp). Самодостаточно (eve/tools, zod,
// node-builtins) — вспомогательные walk/globToRegExp продублированы инлайн, а не
// импортированы из glob.ts (cross-authored relative import ломает eve dev 0.11.4).

function globToRegExp(pattern: string): RegExp {
  const p = pattern.split(sep).join("/");
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*") {
      if (p[i + 1] === "*") {
        re += "(?:.*)";
        i++;
        if (p[i + 1] === "/") i++;
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

const IGNORE_DIRS = new Set([".git", "node_modules", ".next", "dist", ".cache"]);

async function walk(root: string, dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      await walk(root, full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
}

interface Match {
  file: string;
  line: number;
  text: string;
}

const MAX_MATCHES = 1000;

export default defineTool({
  description:
    "Regex-поиск по содержимому файлов НАПРЯМУЮ на файловой системе хоста VPS. " +
    "path может быть файлом или директорией (по умолчанию cwd процесса); для директории " +
    "обход рекурсивный. Опционально glob фильтрует файлы по имени пути. flags — флаги " +
    "RegExp (напр. 'i' для регистронезависимого). Возвращает массив { file, line, text } " +
    "(до 1000 совпадений). Бинарные/нечитаемые файлы пропускаются.",
  inputSchema: z.object({
    pattern: z.string().min(1).describe("Регулярное выражение для поиска"),
    path: z
      .string()
      .optional()
      .describe("Файл или директория для поиска (абсолютный путь, по умолчанию cwd)"),
    glob: z
      .string()
      .optional()
      .describe("Glob-фильтр по пути файла, напр. **/*.ts"),
    flags: z.string().optional().describe("Флаги RegExp, напр. 'i' или 'm'"),
  }),
  async execute({ pattern, path, glob, flags }) {
    const root = path ?? process.cwd();
    const re = new RegExp(pattern, flags ?? "");
    const globRe = glob ? globToRegExp(glob) : null;

    // Собираем список файлов.
    let files: string[];
    const info = await stat(root);
    if (info.isFile()) {
      files = [root];
    } else {
      files = [];
      await walk(root, root, files);
    }

    const matches: Match[] = [];
    let truncated = false;

    for (const file of files) {
      if (globRe) {
        const rel = relative(root, file).split(sep).join("/");
        if (!globRe.test(rel)) continue;
      }
      let content: string;
      try {
        content = await readFile(file, "utf8");
      } catch {
        continue; // нечитаемый/бинарный файл
      }
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        re.lastIndex = 0;
        if (re.test(lines[i])) {
          // Усекаем длинные строки (минифайлы), чтобы не раздуть контекст.
          const text = lines[i].length > 300 ? lines[i].slice(0, 300) + "…" : lines[i];
          matches.push({ file, line: i + 1, text });
          if (matches.length >= MAX_MATCHES) {
            truncated = true;
            break;
          }
        }
      }
      if (truncated) break;
    }

    return { count: matches.length, truncated, matches };
  },
});
