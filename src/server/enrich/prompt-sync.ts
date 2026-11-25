/**
 * 云端提示词同步：从远端拉 system.md / extra.md，写进 settings.ai。
 *
 * 三件事必须成立，否则一次网络抖动就能把线上审核打崩：
 * 1. 拉取失败、内容非法、304 → 一律保留上一版，只记 lastError；
 * 2. 只在内容真的变化时才写库，避免每轮都刷新 settings 的 updated_at；
 * 3. 状态单独存 settings.prompt_sync，后台能直接看到「上次什么时候同步、失败原因」。
 */
import { config } from "../config.ts";
import { get, run } from "../db.ts";
import { getAiSettings, saveAiSettings } from "./ai-settings.ts";
import { validatePromptText, validatePromptUrl, type PromptSlot } from "./prompt-source.ts";

const STATE_KEY = "prompt_sync";

export type SlotState = { url: string; etag?: string; syncedAt?: string; chars?: number };
export type PromptSyncState = {
  lastCheckAt?: string;
  lastError?: string | null;
  system?: SlotState;
  extra?: SlotState;
};

export type PromptSyncResult = {
  ok: boolean;
  disabled?: boolean;
  changed: PromptSlot[];
  skipped: PromptSlot[];
  failed: PromptSlot[];
  state: PromptSyncState;
};

export function readSyncState(): PromptSyncState {
  const row = get<{ value: string }>("SELECT value FROM settings WHERE key = ?", STATE_KEY);
  if (!row) return {};
  try {
    return JSON.parse(row.value) as PromptSyncState;
  } catch {
    return {};
  }
}

function writeSyncState(state: PromptSyncState): void {
  run(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    STATE_KEY,
    JSON.stringify(state),
    new Date().toISOString(),
  );
}

type Pulled =
  | { status: "ok"; text: string; etag?: string }
  | { status: "not-modified" }
  | { status: "error"; message: string };

async function pull(url: string): Promise<Pulled> {
  // 不用 If-None-Match：raw.githubusercontent 的 ETag 并不随内容变化，
  // 一旦缓存了旧 ETag 就会永远 304，云端改了提示词永远拉不到（实测踩过）。
  // 文件只有几 KB，每轮全量拉、本地比内容，反而更可靠。
  const headers: Record<string, string> = { accept: "text/markdown, text/plain;q=0.9, */*;q=0.5", "cache-control": "no-cache" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.min(config.fetchTimeoutMs, 15_000));
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (res.status === 304) return { status: "not-modified" };
    if (!res.ok) return { status: "error", message: `HTTP ${res.status}` };
    return { status: "ok", text: await res.text(), etag: res.headers.get("etag") ?? undefined };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export async function syncPromptsNow(): Promise<PromptSyncResult> {
  const state = readSyncState();
  const slots: { slot: PromptSlot; url: string }[] = [];
  if (config.promptUrl) slots.push({ slot: "system", url: config.promptUrl });
  if (config.promptExtraUrl) slots.push({ slot: "extra", url: config.promptExtraUrl });
  if (!slots.length) return { ok: true, disabled: true, changed: [], skipped: [], failed: [], state };

  const changed: PromptSlot[] = [];
  const skipped: PromptSlot[] = [];
  const failed: PromptSlot[] = [];
  let lastError: string | null = null;

  for (const { slot, url } of slots) {
    const urlError = validatePromptUrl(url);
    if (urlError) {
      failed.push(slot);
      lastError = `${slot}: ${urlError}`;
      continue;
    }
    const res = await pull(url);
    if (res.status === "not-modified") {
      skipped.push(slot);
      continue;
    }
    if (res.status === "error") {
      failed.push(slot);
      lastError = `${slot}: ${res.message}`;
      continue;
    }
    const textError = validatePromptText(res.text);
    if (textError) {
      failed.push(slot);
      lastError = `${slot}: ${textError}`;
      continue;
    }
    const text = res.text.trim();
    const currentSettings = getAiSettings();
    const current = (slot === "system" ? currentSettings.systemPrompt : currentSettings.extraPrompt).trim();
    if (current === text) {
      skipped.push(slot);
      continue;
    }
    saveAiSettings(slot === "system" ? { systemPrompt: text } : { extraPrompt: text });
    state[slot] = { url, etag: res.etag, syncedAt: new Date().toISOString(), chars: text.length };
    changed.push(slot);
  }

  state.lastCheckAt = new Date().toISOString();
  state.lastError = lastError;
  writeSyncState(state);
  return { ok: failed.length === 0, changed, skipped, failed, state };
}

export function promptSyncConfigured(): boolean {
  return Boolean(config.promptUrl || config.promptExtraUrl);
}

/** 启动时同步一次，之后按 PROMPT_SYNC_MINUTES 轮询；未配置 URL 时完全不启动。 */
export function startPromptSync(): void {
  if (!promptSyncConfigured()) return;
  const minutes = config.promptSyncMinutes;
  void syncPromptsNow()
    .then((r) => {
      if (r.changed.length) console.log("[prompt-sync] 已更新:", r.changed.join(","), "| 跳过:", r.skipped.join(",") || "无");
      if (!r.ok) console.warn("[prompt-sync] 部分失败:", r.state.lastError);
    })
    .catch((err) => console.error("[prompt-sync] 首次同步异常:", err instanceof Error ? err.message : err));
  if (minutes > 0) {
    const timer = setInterval(() => {
      void syncPromptsNow()
        .then((r) => {
          if (r.changed.length) console.log("[prompt-sync] 定时更新:", r.changed.join(","));
          else if (!r.ok) console.warn("[prompt-sync] 定时同步失败:", r.state.lastError);
        })
        .catch((err) => console.error("[prompt-sync] 定时异常:", err instanceof Error ? err.message : err));
    }, minutes * 60_000);
    timer.unref?.();
  }
  console.log(`[prompt-sync] 已启用 system=${config.promptUrl ? "on" : "off"} extra=${config.promptExtraUrl ? "on" : "off"} 间隔=${minutes}分`);
}
