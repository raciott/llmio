import type { AppEnv } from "../types.js";
import { redisCommand, redisEnabled, redisPrefix } from "./cache.js";

type Env = AppEnv["Bindings"];

export async function cleanupChatLogsKeepRecentDays(env: Env, keepDays: number) {
  const days = Math.max(1, Math.floor(keepDays));
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const cutoff = new Date(cutoffMs).toISOString();

  // 先删子表，避免外键约束问题
  await env.db.query(
    "DELETE FROM chat_io WHERE log_id IN (SELECT id FROM chat_logs WHERE created_at < $1 AND deleted_at IS NULL)",
    [cutoff]
  );

  await env.db.query(
    "DELETE FROM chat_logs WHERE created_at < $1 AND deleted_at IS NULL",
    [cutoff]
  );
}

function logIndexKey(env: Env) {
  return `${redisPrefix(env)}:idx:chat_logs`;
}

function logKey(env: Env, uuid: string) {
  return `${redisPrefix(env)}:log:${uuid}`;
}

function logIOKey(env: Env, uuid: string) {
  return `${redisPrefix(env)}:logio:${uuid}`;
}

export async function cleanupRedisChatLogsKeepRecentDays(env: Env, keepDays: number, maxDelete: number) {
  if (!redisEnabled(env)) return { deleted: 0, skipped: true };

  const days = Math.max(1, Math.floor(keepDays));
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const max = Math.max(1, Math.floor(maxDelete));

  let deleted = 0;
  while (deleted < max) {
    const batch = Math.min(200, max - deleted);
    const uuids = (await redisCommand<unknown>(env, ["ZRANGEBYSCORE", logIndexKey(env), "-inf", cutoffMs, "LIMIT", 0, batch])) as unknown;
    if (!Array.isArray(uuids) || uuids.length === 0) break;
    const members = (uuids as any[]).map((x) => String(x)).filter(Boolean);
    if (members.length === 0) break;

    const delKeys: string[] = [];
    for (const u of members) {
      delKeys.push(logKey(env, u), logIOKey(env, u));
    }

    await redisCommand(env, ["DEL", ...delKeys]);
    await redisCommand(env, ["ZREM", logIndexKey(env), ...members]);
    deleted += members.length;
  }

  return { deleted, skipped: false };
}
