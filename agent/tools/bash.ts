import { defineTool } from "eve/tools";
import { z } from "zod";
import { exec } from "node:child_process";

// Host-native bash. Переопределяет встроенный sandbox-bash eve: команда выполняется
// напрямую на реальной файловой системе VPS через node:child_process (без sandbox).
// Самодостаточно: импортирует только eve/tools, zod и node-builtins.

const MAX_OUTPUT = 30_000; // оставляем последние ~30k символов каждого потока

function truncate(s: string): { text: string; truncated: boolean } {
  if (s.length <= MAX_OUTPUT) return { text: s, truncated: false };
  return { text: s.slice(s.length - MAX_OUTPUT), truncated: true };
}

export default defineTool({
  description:
    "Выполнить shell-команду НАПРЯМУЮ на хосте VPS (без sandbox, полный доступ к реальной " +
    "файловой системе и окружению). Возвращает { stdout, stderr, exitCode }. " +
    "Очень большой вывод обрезается до последних ~30000 символов каждого потока " +
    "(в этом случае добавляется пометка об усечении). " +
    "Используй для запуска любых команд: git, ls, uv, systemctl --user и т.д.",
  inputSchema: z.object({
    command: z.string().min(1).describe("Shell-команда для выполнения на хосте"),
    cwd: z.string().optional().describe("Рабочая директория (абсолютный путь)"),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Таймаут в миллисекундах (по умолчанию 120000)"),
  }),
  async execute({ command, cwd, timeoutMs }) {
    const timeout = timeoutMs ?? 120_000;
    return await new Promise<{
      stdout: string;
      stderr: string;
      exitCode: number;
      truncated?: boolean;
      timedOut?: boolean;
    }>((resolve) => {
      exec(
        command,
        { cwd, timeout, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" },
        (error, stdout, stderr) => {
          const out = truncate(stdout ?? "");
          const err = truncate(stderr ?? "");
          // error.code — числовой код выхода; для таймаута node ставит error.killed=true.
          const e = error as (Error & { code?: number; killed?: boolean }) | null;
          const exitCode = e?.code ?? (error ? 1 : 0);
          resolve({
            stdout: out.text,
            stderr: err.text,
            exitCode,
            truncated: out.truncated || err.truncated || undefined,
            timedOut: e?.killed || undefined,
          });
        },
      );
    });
  },
});
