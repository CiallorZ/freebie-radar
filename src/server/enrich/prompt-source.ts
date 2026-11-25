/**
 * 云端提示词的纯校验层：URL 与内容是否可接受。
 * 不碰网络与数据库，方便单测；真正拉取与落库在 prompt-sync.ts。
 */

export const PROMPT_MAX_CHARS = 20_000;

export type PromptSlot = "system" | "extra";

/** 只放行 https；本机回环地址例外，方便本地联调。 */
export function validatePromptUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return "地址为空";
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return "不是合法 URL";
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !loopback) return "只允许 https（本机调试可例外）";
  return null;
}

export function validatePromptText(raw: unknown): string | null {
  if (typeof raw !== "string") return "内容不是文本";
  const text = raw.trim();
  if (!text) return "内容为空";
  if (text.length > PROMPT_MAX_CHARS) return `内容超过 ${PROMPT_MAX_CHARS} 字`;
  return null;
}
