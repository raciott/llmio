-- llmio-node PostgreSQL 初始化结构
-- 注意：本文件会 DROP 现有表，请仅在本地/可控环境执行

-- 先删子表，再删父表
DROP TABLE IF EXISTS chat_io CASCADE;
DROP TABLE IF EXISTS chat_logs CASCADE;
DROP TABLE IF EXISTS model_with_providers CASCADE;
DROP TABLE IF EXISTS models CASCADE;
DROP TABLE IF EXISTS providers CASCADE;
DROP TABLE IF EXISTS auth_keys CASCADE;
DROP TABLE IF EXISTS config CASCADE;

-- 统一使用 ISO 8601（UTC）字符串，便于与 JS 的 toISOString() 做比较
-- 形如：2025-12-28T05:42:44.850Z
CREATE TABLE providers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',
  console TEXT NOT NULL DEFAULT '',
  rpm_limit INTEGER NOT NULL DEFAULT 0, -- 每分钟请求数限制，0 表示无限制
  ip_lock_minutes INTEGER NOT NULL DEFAULT 0, -- IP 锁定时间（分钟），0 表示不锁定
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE models (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  remark TEXT NOT NULL DEFAULT '',
  max_retry INTEGER NOT NULL DEFAULT 10,
  time_out INTEGER NOT NULL DEFAULT 60,
  io_log INTEGER NOT NULL DEFAULT 0,
  strategy TEXT NOT NULL DEFAULT 'lottery', -- lottery | rotor
  breaker INTEGER NOT NULL DEFAULT 0,       -- 0/1
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE model_with_providers (
  id SERIAL PRIMARY KEY,
  model_id INTEGER NOT NULL REFERENCES models(id),
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  provider_model TEXT NOT NULL,
  tool_call INTEGER NOT NULL DEFAULT 0,
  structured_output INTEGER NOT NULL DEFAULT 0,
  image INTEGER NOT NULL DEFAULT 0,
  with_header INTEGER NOT NULL DEFAULT 0,
  status INTEGER NOT NULL DEFAULT 1,
  customer_headers TEXT NOT NULL DEFAULT '{}',
  weight INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE auth_keys (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  key TEXT NOT NULL UNIQUE,
  status INTEGER NOT NULL DEFAULT 1,
  allow_all INTEGER NOT NULL DEFAULT 1,
  models TEXT NOT NULL DEFAULT '[]', -- JSON 数组字符串
  expires_at TIMESTAMPTZ,
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE config (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE chat_logs (
  id SERIAL PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,

  name TEXT NOT NULL,
  provider_model TEXT NOT NULL DEFAULT '',
  provider_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  style TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  remote_ip TEXT NOT NULL DEFAULT '',
  auth_key_id INTEGER NOT NULL DEFAULT 0,
  chat_io INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT '',
  retry INTEGER NOT NULL DEFAULT 0,
  proxy_time_ms INTEGER NOT NULL DEFAULT 0,
  first_chunk_time_ms INTEGER NOT NULL DEFAULT 0,
  chunk_time_ms INTEGER NOT NULL DEFAULT 0,
  tps REAL NOT NULL DEFAULT 0,
  size INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  prompt_tokens_details TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE chat_io (
  id SERIAL PRIMARY KEY,
  log_id INTEGER NOT NULL UNIQUE REFERENCES chat_logs(id),
  input TEXT NOT NULL DEFAULT '',
  output_string TEXT NOT NULL DEFAULT '',
  output_string_array TEXT NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- 创建索引以提高查询性能
CREATE INDEX idx_chat_logs_created_at ON chat_logs(created_at);
CREATE INDEX idx_chat_logs_name ON chat_logs(name);
CREATE INDEX idx_chat_logs_auth_key_id ON chat_logs(auth_key_id);
CREATE INDEX idx_chat_logs_provider_name ON chat_logs(provider_name);
CREATE INDEX idx_chat_logs_status ON chat_logs(status);
CREATE INDEX idx_chat_logs_provider_created ON chat_logs(provider_name, created_at);
CREATE INDEX idx_providers_deleted_at ON providers(deleted_at);
CREATE INDEX idx_models_deleted_at ON models(deleted_at);
CREATE INDEX idx_auth_keys_key ON auth_keys(key);
