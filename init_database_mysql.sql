-- LLMIO 生产环境数据库初始化脚本
-- MySQL 版本（InnoDB + utf8mb4）
-- 使用方法示例:
--   mysql -u root -p llmio < init_database_mysql.sql

-- 注意：本脚本仅创建表结构，不包含示例数据
-- 适用于生产环境部署

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- providers
CREATE TABLE IF NOT EXISTS providers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(100) NOT NULL,
  config TEXT NOT NULL,
  console VARCHAR(500) NOT NULL,
  rpm_limit INT NOT NULL DEFAULT 0,
  ip_lock_minutes INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_providers_deleted_at (deleted_at),
  KEY idx_providers_type (type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- models
CREATE TABLE IF NOT EXISTS models (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  remark TEXT NOT NULL,
  max_retry INT NOT NULL DEFAULT 10,
  time_out INT NOT NULL DEFAULT 60,
  io_log INT NOT NULL DEFAULT 0,
  strategy VARCHAR(50) NOT NULL DEFAULT 'lottery',
  breaker INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_models_name (name),
  KEY idx_models_deleted_at (deleted_at),
  KEY idx_models_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- model_with_providers
CREATE TABLE IF NOT EXISTS model_with_providers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  model_id BIGINT UNSIGNED NOT NULL,
  provider_id BIGINT UNSIGNED NOT NULL,
  provider_model VARCHAR(255) NOT NULL,
  tool_call INT NOT NULL DEFAULT 0,
  structured_output INT NOT NULL DEFAULT 0,
  image INT NOT NULL DEFAULT 0,
  with_header INT NOT NULL DEFAULT 0,
  status INT NOT NULL DEFAULT 1,
  customer_headers TEXT NOT NULL,
  weight INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_model_with_providers_model_id (model_id),
  KEY idx_model_with_providers_provider_id (provider_id),
  KEY idx_model_with_providers_status (status),
  KEY idx_model_with_providers_deleted_at (deleted_at),
  CONSTRAINT fk_mwpp_model FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE,
  CONSTRAINT fk_mwpp_provider FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- auth_keys
CREATE TABLE IF NOT EXISTS auth_keys (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  `key` VARCHAR(255) NOT NULL,
  status INT NOT NULL DEFAULT 1,
  allow_all INT NOT NULL DEFAULT 1,
  models TEXT NOT NULL,
  expires_at DATETIME(3) NULL,
  usage_count BIGINT NOT NULL DEFAULT 0,
  last_used_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_auth_keys_key (`key`),
  KEY idx_auth_keys_key (`key`),
  KEY idx_auth_keys_status (status),
  KEY idx_auth_keys_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- configs
CREATE TABLE IF NOT EXISTS configs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `key` VARCHAR(255) NOT NULL,
  value TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_configs_key (`key`),
  KEY idx_configs_key (`key`),
  KEY idx_configs_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- chat_logs
CREATE TABLE IF NOT EXISTS chat_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  provider_model VARCHAR(255) NOT NULL,
  provider_name VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL,
  style VARCHAR(100) NOT NULL,
  user_agent TEXT NOT NULL,
  remote_ip VARCHAR(45) NOT NULL,
  auth_key_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  chat_io INT NOT NULL DEFAULT 0,
  error TEXT NOT NULL,
  retry INT NOT NULL DEFAULT 0,
  proxy_time_ms INT NOT NULL DEFAULT 0,
  first_chunk_time_ms INT NOT NULL DEFAULT 0,
  chunk_time_ms INT NOT NULL DEFAULT 0,
  tps DOUBLE NOT NULL DEFAULT 0,
  size INT NOT NULL DEFAULT 0,
  prompt_tokens BIGINT NOT NULL DEFAULT 0,
  completion_tokens BIGINT NOT NULL DEFAULT 0,
  total_tokens BIGINT NOT NULL DEFAULT 0,
  prompt_tokens_details TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_chat_logs_uuid (uuid),
  KEY idx_chat_logs_uuid (uuid),
  KEY idx_chat_logs_name (name),
  KEY idx_chat_logs_provider_name (provider_name),
  KEY idx_chat_logs_status (status),
  KEY idx_chat_logs_user_agent (user_agent(128)),
  KEY idx_chat_logs_auth_key_id (auth_key_id),
  KEY idx_chat_logs_created_at (created_at),
  KEY idx_chat_logs_provider_created (provider_name, created_at),
  KEY idx_chat_logs_deleted_at (deleted_at),
  KEY idx_chat_logs_health_window (provider_name, name, provider_model, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- chat_io
CREATE TABLE IF NOT EXISTS chat_io (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  log_id BIGINT UNSIGNED NOT NULL,
  input LONGTEXT NOT NULL,
  output_string LONGTEXT NOT NULL,
  output_string_array LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_chat_io_log_id (log_id),
  KEY idx_chat_io_log_id (log_id),
  KEY idx_chat_io_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
