-- LLMIO 生产环境数据库初始化脚本
-- PostgreSQL 版本
-- 使用方法: psql -d llmio -f init_pg_db.sql

-- 注意：本脚本仅创建表结构，不包含示例数据
-- 适用于生产环境部署

BEGIN;

-- 创建 providers 表
CREATE TABLE IF NOT EXISTS providers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(100) NOT NULL,
    config TEXT NOT NULL DEFAULT '{}',
    console VARCHAR(500) NOT NULL DEFAULT '',
    rpm_limit INTEGER NOT NULL DEFAULT 0,
    ip_lock_minutes INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 创建 models 表
CREATE TABLE IF NOT EXISTS models (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    remark TEXT NOT NULL DEFAULT '',
    max_retry INTEGER NOT NULL DEFAULT 10,
    time_out INTEGER NOT NULL DEFAULT 60,
    io_log INTEGER NOT NULL DEFAULT 0,
    strategy VARCHAR(50) NOT NULL DEFAULT 'lottery',
    breaker INTEGER NOT NULL DEFAULT 0,
    status INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
ALTER TABLE models ADD COLUMN IF NOT EXISTS status INTEGER NOT NULL DEFAULT 1;

-- 创建 model_with_providers 表
CREATE TABLE IF NOT EXISTS model_with_providers (
    id SERIAL PRIMARY KEY,
    model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    provider_model VARCHAR(255) NOT NULL,
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

-- 创建 auth_keys 表
CREATE TABLE IF NOT EXISTS auth_keys (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    key VARCHAR(255) NOT NULL UNIQUE,
    status INTEGER NOT NULL DEFAULT 1,
    allow_all INTEGER NOT NULL DEFAULT 1,
    models TEXT NOT NULL DEFAULT '[]',
    expires_at TIMESTAMPTZ,
    usage_count BIGINT NOT NULL DEFAULT 0,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 创建 configs 表
CREATE TABLE IF NOT EXISTS configs (
    id SERIAL PRIMARY KEY,
    key VARCHAR(255) NOT NULL UNIQUE,
    value TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 创建 model_prices 表
CREATE TABLE IF NOT EXISTS model_prices (
    id SERIAL PRIMARY KEY,
    model_id VARCHAR(255) NOT NULL UNIQUE,
    provider VARCHAR(100) NOT NULL DEFAULT '',
    input DOUBLE PRECISION NOT NULL DEFAULT 0,
    output DOUBLE PRECISION NOT NULL DEFAULT 0,
    cache_read DOUBLE PRECISION NOT NULL DEFAULT 0,
    cache_write DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 创建 chat_logs 表
CREATE TABLE IF NOT EXISTS chat_logs (
    id SERIAL PRIMARY KEY,
    uuid VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    provider_model VARCHAR(255) NOT NULL DEFAULT '',
    provider_name VARCHAR(255) NOT NULL DEFAULT '',
    status VARCHAR(50) NOT NULL DEFAULT '',
    style VARCHAR(100) NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    remote_ip VARCHAR(45) NOT NULL DEFAULT '',
    auth_key_id INTEGER NOT NULL DEFAULT 0,
    chat_io INTEGER NOT NULL DEFAULT 0,
    error TEXT NOT NULL DEFAULT '',
    retry INTEGER NOT NULL DEFAULT 0,
    proxy_time_ms INTEGER NOT NULL DEFAULT 0,
    first_chunk_time_ms INTEGER NOT NULL DEFAULT 0,
    chunk_time_ms INTEGER NOT NULL DEFAULT 0,
    tps REAL NOT NULL DEFAULT 0,
    size INTEGER NOT NULL DEFAULT 0,
    prompt_tokens BIGINT NOT NULL DEFAULT 0,
    completion_tokens BIGINT NOT NULL DEFAULT 0,
    total_tokens BIGINT NOT NULL DEFAULT 0,
    prompt_tokens_details TEXT NOT NULL DEFAULT '{}',
    total_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
ALTER TABLE chat_logs ADD COLUMN IF NOT EXISTS total_cost DOUBLE PRECISION NOT NULL DEFAULT 0;

-- 创建 chat_io 表
CREATE TABLE IF NOT EXISTS chat_io (
    id SERIAL PRIMARY KEY,
    log_id INTEGER NOT NULL UNIQUE REFERENCES chat_logs(id) ON DELETE CASCADE,
    input TEXT NOT NULL DEFAULT '',
    output_string TEXT NOT NULL DEFAULT '',
    output_string_array TEXT NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 创建索引（如果不存在）
CREATE INDEX IF NOT EXISTS idx_providers_deleted_at ON providers(deleted_at);
CREATE INDEX IF NOT EXISTS idx_providers_type ON providers(type);

CREATE INDEX IF NOT EXISTS idx_models_deleted_at ON models(deleted_at);
CREATE INDEX IF NOT EXISTS idx_models_name ON models(name);
CREATE INDEX IF NOT EXISTS idx_models_status ON models(status);

CREATE INDEX IF NOT EXISTS idx_model_with_providers_model_id ON model_with_providers(model_id);
CREATE INDEX IF NOT EXISTS idx_model_with_providers_provider_id ON model_with_providers(provider_id);
CREATE INDEX IF NOT EXISTS idx_model_with_providers_status ON model_with_providers(status);
CREATE INDEX IF NOT EXISTS idx_model_with_providers_deleted_at ON model_with_providers(deleted_at);

CREATE INDEX IF NOT EXISTS idx_auth_keys_key ON auth_keys(key);
CREATE INDEX IF NOT EXISTS idx_auth_keys_status ON auth_keys(status);

CREATE INDEX IF NOT EXISTS idx_model_prices_model_id ON model_prices(model_id);
CREATE INDEX IF NOT EXISTS idx_auth_keys_deleted_at ON auth_keys(deleted_at);

CREATE INDEX IF NOT EXISTS idx_configs_key ON configs(key);
CREATE INDEX IF NOT EXISTS idx_configs_deleted_at ON configs(deleted_at);

CREATE INDEX IF NOT EXISTS idx_chat_logs_uuid ON chat_logs(uuid);
CREATE INDEX IF NOT EXISTS idx_chat_logs_name ON chat_logs(name);
CREATE INDEX IF NOT EXISTS idx_chat_logs_provider_name ON chat_logs(provider_name);
CREATE INDEX IF NOT EXISTS idx_chat_logs_status ON chat_logs(status);
CREATE INDEX IF NOT EXISTS idx_chat_logs_user_agent ON chat_logs(user_agent);
CREATE INDEX IF NOT EXISTS idx_chat_logs_auth_key_id ON chat_logs(auth_key_id);
CREATE INDEX IF NOT EXISTS idx_chat_logs_created_at ON chat_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_chat_logs_provider_created ON chat_logs(provider_name, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_logs_deleted_at ON chat_logs(deleted_at);
-- 健康监控窗口函数查询优化：按 provider_name + name + provider_model 分组取最近 N 条
CREATE INDEX IF NOT EXISTS idx_chat_logs_health_window
ON chat_logs (provider_name, name, provider_model, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_chat_io_log_id ON chat_io(log_id);
CREATE INDEX IF NOT EXISTS idx_chat_io_deleted_at ON chat_io(deleted_at);

COMMIT;

\echo '生产环境数据库初始化完成！'
\echo '已创建所有必要的表和索引。'
\echo '请通过管理界面或API添加服务提供商、模型和认证密钥。'
