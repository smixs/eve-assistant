import { defineTool } from "eve/tools";
import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

// Host-native запись файла. Переопределяет встроенный write_file eve: пишет реальный
// файл на VPS через node:fs/promises, создавая родительские директории (mkdir -p).
// Самодостаточно (eve/tools, zod, node-builtins).

export default defineTool({
  description:
    "Записать файл НАПРЯМУЮ на файловую систему хоста VPS (UTF-8). " +
    "Родительские директории создаются автоматически (mkdir -p). " +
    "Перезаписывает файл целиком. Возвращает { ok, path, bytes }.",
  inputSchema: z.object({
    path: z.string().min(1).describe("Абсолютный путь к файлу на хосте"),
    content: z.string().describe("Содержимое для записи (UTF-8)"),
  }),
  async execute({ path, content }) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
    return { ok: true, path, bytes: Buffer.byteLength(content, "utf8") };
  },
});
