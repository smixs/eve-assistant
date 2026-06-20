import { defineTool } from "eve/tools";
import { z } from "zod";
import { readFile } from "node:fs/promises";

// Host-native чтение файла. Переопределяет встроенный read_file eve: читает реальный
// файл на VPS через node:fs/promises (UTF-8). Самодостаточно (eve/tools, zod, node-builtins).

export default defineTool({
  description:
    "Прочитать UTF-8 файл НАПРЯМУЮ с файловой системы хоста VPS. " +
    "По умолчанию возвращает всё содержимое; можно ограничить диапазон строк " +
    "через offset (номер первой строки, 1-based) и limit (число строк). " +
    "Возвращает { path, content, lines, truncated }.",
  inputSchema: z.object({
    path: z.string().min(1).describe("Абсолютный путь к файлу на хосте"),
    offset: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Номер первой возвращаемой строки (1-based)"),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Максимальное число строк для чтения"),
  }),
  async execute({ path, offset, limit }) {
    const raw = await readFile(path, "utf8");

    // Без offset/limit — отдаём файл целиком.
    if (offset === undefined && limit === undefined) {
      return {
        path,
        content: raw,
        lines: raw.length === 0 ? 0 : raw.split("\n").length,
        truncated: false,
      };
    }

    const allLines = raw.split("\n");
    const start = offset ? offset - 1 : 0;
    const end = limit ? start + limit : allLines.length;
    const slice = allLines.slice(start, end);
    return {
      path,
      content: slice.join("\n"),
      lines: slice.length,
      truncated: end < allLines.length || start > 0,
    };
  },
});
