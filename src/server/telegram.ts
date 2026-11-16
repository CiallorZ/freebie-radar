import { config } from "./config.ts";

export type TelegramTarget = {
  botToken: string;
  chatId: string;
  apiBase?: string;
  proxy?: string;
};

/**
 * 统一发送入口：全局 Bot 与个人 Bot 共用一套实现，
 * 区别只在 token / chat_id 从哪来（config 还是 user_push_configs 解密出来的）。
 */
export async function sendTelegramWith(target: TelegramTarget, text: string): Promise<void> {
  const base = (target.apiBase ?? config.telegramApiBase).replace(/\/+$/, "");
  const url = base + "/bot" + target.botToken + "/sendMessage";
  const init: RequestInit & { dispatcher?: unknown } = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: target.chatId,
      text,
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(15_000),
  };
  const proxy = target.proxy ?? config.telegramProxy;
  if (proxy) {
    const { ProxyAgent } = await import("undici");
    init.dispatcher = new ProxyAgent(proxy);
  }
  const res = await fetch(url, init);
  if (!res.ok) throw new Error("Telegram HTTP " + res.status + " " + (await res.text()).slice(0, 150));
}

export async function sendTelegram(text: string): Promise<void> {
  await sendTelegramWith(
    { botToken: config.telegramBotToken, chatId: config.telegramChatId },
    text,
  );
}

export type DetectedChat = { chatId: string; title: string; type: string };

/**
 * 让用户少踩「chat_id 填什么」的坑：调 getUpdates 把他最近跟这个 Bot 说过话的会话列出来。
 * 用户只需要先给自己的 Bot 发一句 /start。
 */
export async function detectTelegramChatIds(botToken: string): Promise<DetectedChat[]> {
  const base = config.telegramApiBase.replace(/\/+$/, "");
  const url = base + "/bot" + botToken + "/getUpdates?limit=20&allowed_updates=" + encodeURIComponent('["message","channel_post"]');
  const init: RequestInit & { dispatcher?: unknown } = {
    method: "GET",
    signal: AbortSignal.timeout(12_000),
  };
  if (config.telegramProxy) {
    const { ProxyAgent } = await import("undici");
    init.dispatcher = new ProxyAgent(config.telegramProxy);
  }
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    description?: string;
    result?: Array<{
      message?: { chat?: { id?: number; title?: string; username?: string; type?: string } };
      channel_post?: { chat?: { id?: number; title?: string; username?: string; type?: string } };
    }>;
  };
  if (!res.ok || body.ok === false) {
    throw new Error(body.description ?? "Telegram getUpdates 失败（HTTP " + res.status + "）");
  }
  const seen = new Map<string, DetectedChat>();
  for (const upd of body.result ?? []) {
    const chat = upd.message?.chat ?? upd.channel_post?.chat;
    if (!chat?.id) continue;
    const chatId = String(chat.id);
    if (seen.has(chatId)) continue;
    seen.set(chatId, {
      chatId,
      title: chat.title ?? (chat.username ? "@" + chat.username : chatId),
      type: chat.type ?? "private",
    });
  }
  return [...seen.values()];
}