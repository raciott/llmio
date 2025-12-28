import type { AppEnv } from "../types.js";
import type Redis from "ioredis";

type Env = AppEnv["Bindings"];

const localVersionCache = new Map<string, { value: number; cachedAt: number }>();
const LOCAL_VERSION_TTL_MS = 1_000;

function enabled(env: Env) {
  return Boolean(env.redis);
}

function prefix(env: Env) {
  return (env.REDIS_PREFIX && env.REDIS_PREFIX.trim()) || "llmio";
}

function defaultTtlSeconds(env: Env) {
  const raw = env.REDIS_DEFAULT_TTL_SECONDS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 10;
}

export function redisEnabled(env: Env) {
  return enabled(env);
}

export function redisPrefix(env: Env) {
  return prefix(env);
}

export async function redisCommand<T>(env: Env, command: unknown[]): Promise<T | null> {
  if (!enabled(env)) return null;
  try {
    const redis = env.redis;
    const [cmd, ...args] = command;
    // 使用 ioredis 的 call 方法执行命令
    const result = await (redis as any).call(String(cmd).toLowerCase(), ...args);
    return result as T;
  } catch {
    return null;
  }
}

function nsKey(env: Env, ns: string, key: string) {
  return `${prefix(env)}:${ns}:${key}`;
}

export async function getNamespaceVersion(env: Env, ns: string): Promise<number> {
  if (!enabled(env)) return 0;

  const cached = localVersionCache.get(ns);
  const now = Date.now();
  if (cached && now - cached.cachedAt < LOCAL_VERSION_TTL_MS) return cached.value;

  const key = nsKey(env, "ver", ns);
  const raw = await redisCommand<unknown>(env, ["GET", key]);
  const v = raw === null ? 0 : Number(raw);
  const value = Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
  localVersionCache.set(ns, { value, cachedAt: now });
  return value;
}

export async function bumpNamespaceVersion(env: Env, ns: string): Promise<void> {
  if (!enabled(env)) return;
  const key = nsKey(env, "ver", ns);
  await redisCommand(env, ["INCR", key]);
  localVersionCache.delete(ns);
}

export async function cacheGetJson<T>(env: Env, ns: string, key: string): Promise<T | null> {
  const v = await getNamespaceVersion(env, ns);
  const fullKey = nsKey(env, "cache", `${ns}:v${v}:${key}`);
  const raw = await redisCommand<string | null>(env, ["GET", fullKey]);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function cacheSetJson(env: Env, ns: string, key: string, value: unknown): Promise<void> {
  const v = await getNamespaceVersion(env, ns);
  const fullKey = nsKey(env, "cache", `${ns}:v${v}:${key}`);
  // TTL 统一由 REDIS_DEFAULT_TTL_SECONDS 控制
  const ttl = defaultTtlSeconds(env);
  await redisCommand(env, ["SET", fullKey, JSON.stringify(value), "EX", ttl]);
}
