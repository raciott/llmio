import type { Pool } from "pg";
import type { Redis } from "ioredis";

export type Style = "openai" | "openai-res" | "anthropic" | "gemini";

// 环境变量绑定（替代 Cloudflare Bindings）
export type Bindings = {
  db: Pool;           // PostgreSQL 连接池
  redis: Redis | null; // Redis 客户端（可选）
  TOKEN?: string;     // 管理员 token
  REDIS_PREFIX?: string;
  REDIS_DEFAULT_TTL_SECONDS?: string;
};

export type Variables = {
  authKeyId: number;
  allowAllModel: boolean;
  allowModels: string[];
  geminiStream?: boolean;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: Variables;
};

// PostgreSQL 数据库接口（替代 D1）
export interface Database {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  queryOne<T = unknown>(sql: string, params?: unknown[]): Promise<T | null>;
}
