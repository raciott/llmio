import type { AppEnv } from "../types.js";
import type { ChatLogEvent } from "./chat-log-events.js";
import { applyChatLogEventToDb } from "./chat-log-store.js";

type Env = AppEnv["Bindings"];

// 直接写入数据库
export async function enqueueChatLogEvent(env: Env, event: ChatLogEvent) {
  await applyChatLogEventToDb(env.db, event);
}

// 保留函数签名以兼容现有调用，但不再执行任何操作
export async function flushChatLogEventsToDb(_env: Env, _maxBatch: number): Promise<{ processed: number; dead: number; skipped: boolean }> {
  return { processed: 0, dead: 0, skipped: true };
}
