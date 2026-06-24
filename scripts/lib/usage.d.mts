// Типы для usage.mjs (чистый ESM) — чтобы tsgo-потребители (agent/hooks/usage.ts) не ловили
// TS7016/TS2305. Сводки возвращают разную форму по окну — типизируем как unknown-объект.
export interface UsageRecord {
  ts: string;
  source: string;
  provider: string;
  model: string;
  sessionId: string;
  turnId: string;
  step: number;
  subagent?: string;
  in: number;
  out: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export function usageFilePath(dataDir?: string): string;
export function appendUsage(record: UsageRecord, dataDir?: string): void;
export function readEntries(dataDir?: string): UsageRecord[];
export function parseWindow(arg?: string): string;
export function summarize(
  entries: UsageRecord[],
  opts?: { window?: string; now?: number; tz?: string },
): Record<string, unknown>;
export function formatUsageReport(aggregate: Record<string, unknown>): string;
