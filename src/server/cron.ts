import { config } from "./config.ts";
import { all } from "./db.ts";
import { hasCookieConfiguredForSource } from "./cookie-store.ts";
import { runSource } from "./collectors/index.ts";

/** 极简 5 段 cron 匹配：分 时 日 月 周；支持 * , - /。 */
export function matchCron(expr: string, date: Date, utc = false): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const get = utc
    ? [date.getUTCMinutes(), date.getUTCHours(), date.getUTCDate(), date.getUTCMonth() + 1, date.getUTCDay()]
    : [date.getMinutes(), date.getHours(), date.getDate(), date.getMonth() + 1, date.getDay()];
  const ranges: [number, number][] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];
  return parts.every((part, i) => matchField(part, get[i]!, ranges[i]![0], ranges[i]![1]));
}

export function matchField(field: string, value: number, min: number, max: number): boolean {
  for (const chunk of field.split(",")) {
    const [rangePart, stepPart] = chunk.split("/");
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isFinite(step) || step <= 0) return false;
    let start = min;
    let end = max;
    if (rangePart && rangePart !== "*") {
      const [a, b] = rangePart.split("-");
      start = Number(a);
      end = b === undefined ? (stepPart ? max : start) : Number(b);
    }
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
    if (value < start || value > end) continue;
    if ((value - start) % step === 0) return true;
  }
  return false;
}


/** 失败退避上限：连续失败 6 次（×64）封顶，间隔再长也不超过 24 小时（E1）。 */
export const MAX_BACKOFF_STEPS = 6;
export const MAX_BACKOFF_SEC = 86_400;

/**
 * 失败退避后的有效间隔：连续失败 n 次 → interval × 2^n，上限 24 小时；成功一次清零。
 * 例：Reddit 源 7200 秒、连败 6 次后 24 小时才重试一次，不再空转打爆对方 429。
 */
export function effectiveIntervalSec(intervalSec: number, consecutiveFailures: number): number {
  const n = Math.max(0, Math.min(MAX_BACKOFF_STEPS, Math.floor(consecutiveFailures)));
  return Math.min(intervalSec * 2 ** n, MAX_BACKOFF_SEC);
}

export function listDueSourceIds(): string[] {
  const rows = all<{ id: string; kind: string; interval_sec: number; last_run_at: string | null; consecutive_failures: number }>(
    `SELECT id, kind, interval_sec, last_run_at, COALESCE(consecutive_failures, 0) AS consecutive_failures FROM sources
      WHERE enabled = 1
      ORDER BY last_run_at IS NOT NULL, last_run_at ASC`,
  );
  const now = Date.now();
  const filter = config.enabledSources;
  return rows
    .filter((s) => {
      if (filter.length && !filter.includes(s.id)) return false;
      if (s.kind === "ingest" && !hasCookieConfiguredForSource(s.id)) return false;
      // 到点判断含失败退避：上次跑完 + 有效间隔（基础间隔 × 2^连败次数，上限 24 小时）才到期
      if (s.last_run_at) {
        const nextAt = Date.parse(s.last_run_at) + effectiveIntervalSec(s.interval_sec, s.consecutive_failures) * 1000;
        if (Number.isNaN(nextAt) || nextAt > now) return false;
      }
      return true;
    })
    .map((s) => s.id);
}

/**
 * 按每个源自己的 interval_sec 轮询：到点就跑，串行执行避免打爆上游。
 * 送码类源设 60-120 秒，日报/清单/Cookie 托管源设半小时至数小时。
 */
export function startIntervalScheduler(task: {
  log?: (m: string) => void;
  tickMs?: number;
} = {}): void {
  const log = task.log ?? ((m: string) => console.log(m));
  const tickMs = task.tickMs ?? 30_000;
  let busy = false;

  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      for (const id of listDueSourceIds()) {
        try {
          await runSource(id);
        } catch (err) {
          log(`[cron] ${id} 失败: ${err instanceof Error ? err.message : String(err)}`);
        }
        // 生产调度与 CLI 共用源间间隔，避免连续请求被上游 429（E2）
        if (config.sourceGapMs > 0) await new Promise((r) => setTimeout(r, config.sourceGapMs));
      }
    } catch (err) {
      log(`[cron] 调度异常: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      busy = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), tickMs);
  timer.unref?.();
  intervalTimer = timer;
  log(`[cron] interval scheduler started (tick=${tickMs}ms)`);
}

let intervalTimer: NodeJS.Timeout | null = null;

export function stopIntervalScheduler(): void {
  if (intervalTimer) clearInterval(intervalTimer);
  intervalTimer = null;
}
let timer: NodeJS.Timeout | null = null;
let lastKey = "";

export function startScheduler(task: { collect: () => Promise<unknown>; daily: () => Promise<unknown>; log?: (m: string) => void }): void {
  if (timer) return;
  const log = task.log ?? ((m: string) => console.log(m));
  timer = setInterval(() => {
    const now = new Date();
    const key = now.toISOString().slice(0, 16);
    if (key === lastKey) return;
    lastKey = key;
    if (config.enableScheduler && matchCron(config.collectCron, now)) {
      log("[cron] 触发采集");
      task.collect().catch((e) => log(`[cron] 采集失败: ${String(e)}`));
    }
    if (config.enableScheduler && matchCron(config.dailyCron, now)) {
      log("[cron] 触发日报");
      task.daily().catch((e) => log(`[cron] 日报失败: ${String(e)}`));
    }
  }, 30_000);
  log(`[cron] scheduler started collect="${config.collectCron}" daily="${config.dailyCron}"`);
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
