import type { Pool } from "pg";

export type ProviderRow = {
  id: number;
  name: string;
  type: string;
  config: string;
  console: string;
};

export type ModelRow = {
  id: number;
  name: string;
  remark: string;
  max_retry: number;
  time_out: number;
  io_log: number;
  strategy: string;
  breaker: number;
  created_at: string;
};

export type ModelWithProviderRow = {
  id: number;
  model_id: number;
  provider_id: number;
  provider_model: string;
  tool_call: number;
  structured_output: number;
  image: number;
  with_header: number;
  status: number;
  customer_headers: string;
  weight: number;
};

export type ChatLogRow = {
  id: number;
  created_at: string;
  name: string;
  provider_model: string;
  provider_name: string;
  status: string;
  style: string;
  user_agent: string;
  remote_ip: string;
  auth_key_id: number;
  chat_io: number;
  error: string;
  retry: number;
  proxy_time_ms: number;
  first_chunk_time_ms: number;
  chunk_time_ms: number;
  tps: number;
  size: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details: string;
};

export type ChatIORow = {
  id: number;
  log_id: number;
  input: string;
  output_string: string;
  output_string_array: string;
};

export type AuthKeyRow = {
  id: number;
  name: string;
  key: string;
  status: number | boolean;
  allow_all: number | boolean;
  models: string;
  expires_at: string | null;
  usage_count: number;
  last_used_at: string | null;
};

export type ConfigRow = {
  id: number;
  key: string;
  value: string;
};

export async function firstOrThrow<T>(promise: Promise<T | null>, message: string): Promise<T> {
  const row = await promise;
  if (!row) throw new Error(message);
  return row;
}

export async function getConfig(db: Pool, key: string) {
  const result = await db.query<ConfigRow>(
    "SELECT id, key, value FROM config WHERE key = $1 AND deleted_at IS NULL",
    [key]
  );
  return result.rows[0] ?? null;
}

export async function upsertConfig(db: Pool, key: string, value: string) {
  const now = new Date().toISOString();
  const existing = await db.query<{ id: number }>(
    "SELECT id FROM config WHERE key = $1 AND deleted_at IS NULL",
    [key]
  );

  if (existing.rows.length === 0) {
    await db.query(
      "INSERT INTO config (key, value, created_at, updated_at) VALUES ($1, $2, $3, $4)",
      [key, value, now, now]
    );
    return;
  }

  await db.query(
    "UPDATE config SET value = $1, updated_at = $2 WHERE id = $3",
    [value, now, existing.rows[0].id]
  );
}

export async function findAuthKeyByKey(db: Pool, key: string) {
  const result = await db.query<AuthKeyRow>(
    `SELECT id, name, key, status, allow_all, models, expires_at, usage_count, last_used_at
     FROM auth_keys
     WHERE key = $1 AND status = 1 AND deleted_at IS NULL`,
    [key]
  );
  return result.rows[0] ?? null;
}

export async function touchAuthKeyUsage(db: Pool, id: number) {
  const now = new Date().toISOString();
  await db.query(
    "UPDATE auth_keys SET usage_count = usage_count + 1, last_used_at = $1, updated_at = $2 WHERE id = $3",
    [now, now, id]
  );
}
