import type { AppEnv } from "../types.js";

type Env = AppEnv["Bindings"];

export async function cleanupChatLogsKeepRecentDays(env: Env, keepDays: number) {
  const days = Math.max(1, Math.floor(keepDays));
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const cutoff = new Date(cutoffMs).toISOString();

  // 先删子表，避免外键约束问题
  await env.db.query(
    "DELETE FROM chat_io WHERE log_id IN (SELECT id FROM chat_logs WHERE created_at < $1)",
    [cutoff]
  );

  await env.db.query(
    "DELETE FROM chat_logs WHERE created_at < $1",
    [cutoff]
  );
}
