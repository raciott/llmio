import { randomUUID } from "node:crypto";
import type { AppEnv } from "../types.js";
import type { ChatLogEvent } from "./chat-log-events.js";
import { applyChatLogEventToDb } from "./chat-log-store.js";
import { redisCommand, redisEnabled, redisPrefix } from "./cache.js";
import { upsertRedisChatLogBase, upsertRedisChatLogFinalize } from "./chat-log-redis.js";

type Env = AppEnv["Bindings"];

function queueKey(env: Env) {
  return `${redisPrefix(env)}:queue:chat_logs`;
}

function deadKey(env: Env) {
  return `${redisPrefix(env)}:dead:chat_logs`;
}

function lockKey(env: Env) {
  return `${redisPrefix(env)}:lock:chat_logs_flush`;
}

export async function enqueueChatLogEvent(env: Env, event: ChatLogEvent) {
  if (!redisEnabled(env)) {
    // 未配置 Redis 时直接落库，保证功能可用
    await applyChatLogEventToDb(env.db, event);
    return;
  }

  // 先更新 Redis 的可查询索引/指标，再入队（避免接口读到"空洞"）
  if (event.type === "insert") {
    await upsertRedisChatLogBase(env, event.base);
  } else {
    await upsertRedisChatLogFinalize(env, event.base, event.finalize, event.io);
  }

  await redisCommand(env, ["RPUSH", queueKey(env), JSON.stringify(event)]);
}

type FlushResult = {
  processed: number;
  dead: number;
  skipped: boolean;
};

export async function flushChatLogEventsToDb(env: Env, maxBatch: number): Promise<FlushResult> {
  if (!redisEnabled(env)) return { processed: 0, dead: 0, skipped: true };

  const lockValue = randomUUID();
  const locked = await redisCommand<string | null>(env, ["SET", lockKey(env), lockValue, "NX", "EX", 55]);
  if (locked !== "OK") return { processed: 0, dead: 0, skipped: true };

  let processed = 0;
  let dead = 0;

  const popped = await redisCommand<unknown>(env, ["LPOP", queueKey(env), Math.max(1, Math.floor(maxBatch))]);
  const items: string[] = Array.isArray(popped) ? (popped as any[]).map((x) => String(x)) : popped ? [String(popped)] : [];

  for (const raw of items) {
    try {
      const parsed = JSON.parse(raw) as ChatLogEvent;
      if (!parsed || typeof parsed !== "object") throw new Error("invalid event");
      if ((parsed as any).type !== "insert" && (parsed as any).type !== "finalize") throw new Error("invalid event type");
      await applyChatLogEventToDb(env.db, parsed);
      processed += 1;
    } catch {
      // 落库失败/反序列化失败：丢到 dead-letter，避免数据直接丢失
      dead += 1;
      await redisCommand(env, ["RPUSH", deadKey(env), raw]);
    }
  }

  return { processed, dead, skipped: false };
}
