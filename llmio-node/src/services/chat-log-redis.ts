import type { AppEnv } from "../types.js";
import type { ChatIO, ChatLogBase, ChatLogFinalize } from "./chat-log-events.js";
import { redisCommand, redisEnabled, redisPrefix } from "./cache.js";

type Env = AppEnv["Bindings"];

function logIndexKey(env: Env) {
  return `${redisPrefix(env)}:idx:chat_logs`;
}

function logKey(env: Env, uuid: string) {
  return `${redisPrefix(env)}:log:${uuid}`;
}

function logIOKey(env: Env, uuid: string) {
  return `${redisPrefix(env)}:logio:${uuid}`;
}

function userAgentsKey(env: Env) {
  return `${redisPrefix(env)}:set:user_agents`;
}

function modelCallsKey(env: Env) {
  return `${redisPrefix(env)}:metrics:model_calls`;
}

function projectCallsKey(env: Env) {
  return `${redisPrefix(env)}:metrics:project_calls`;
}

function useDayKey(env: Env, day: string) {
  return `${redisPrefix(env)}:metrics:use:${day}`; // hash: reqs/tokens
}

function dayFromISO(iso: string) {
  // 取 UTC 日期：YYYY-MM-DD
  return String(iso).slice(0, 10);
}

export function redisLogsEnabled(env: Env) {
  return redisEnabled(env);
}

export async function upsertRedisChatLogBase(env: Env, base: ChatLogBase) {
  if (!redisEnabled(env)) return;

  const createdAtMs = Date.parse(base.created_at);
  const score = Number.isFinite(createdAtMs) ? Math.floor(createdAtMs) : Date.now();

  await redisCommand(env, ["ZADD", logIndexKey(env), score, base.uuid]);
  await redisCommand(env, ["SET", logKey(env, base.uuid), JSON.stringify(base)]);

  const ua = String(base.user_agent ?? "").trim();
  if (ua) await redisCommand(env, ["SADD", userAgentsKey(env), ua]);

  // 指标：按请求计数（与 D1 统计一致：chat_logs 行数）
  await redisCommand(env, ["HINCRBY", modelCallsKey(env), String(base.name ?? ""), 1]);
  await redisCommand(env, ["HINCRBY", projectCallsKey(env), String(base.auth_key_id ?? 0), 1]);
  const day = dayFromISO(base.created_at);
  await redisCommand(env, ["HINCRBY", useDayKey(env, day), "reqs", 1]);
}

export async function upsertRedisChatLogFinalize(env: Env, base: ChatLogBase, fin: ChatLogFinalize, io?: ChatIO) {
  if (!redisEnabled(env)) return;

  const merged = { ...base, ...fin, uuid: base.uuid };
  await redisCommand(env, ["SET", logKey(env, base.uuid), JSON.stringify(merged)]);
  if (io) await redisCommand(env, ["SET", logIOKey(env, base.uuid), JSON.stringify(io)]);

  const day = dayFromISO(base.created_at);
  const tokens = Number(fin.total_tokens ?? 0);
  if (Number.isFinite(tokens) && tokens !== 0) await redisCommand(env, ["HINCRBY", useDayKey(env, day), "tokens", Math.floor(tokens)]);
}

export async function getRedisChatLog(env: Env, uuid: string) {
  const raw = await redisCommand<string | null>(env, ["GET", logKey(env, uuid)]);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as any;
  } catch {
    return null;
  }
}

export async function getRedisChatIO(env: Env, uuid: string) {
  const raw = await redisCommand<string | null>(env, ["GET", logIOKey(env, uuid)]);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as any;
  } catch {
    return null;
  }
}

export async function listRedisChatLogs(env: Env, offset: number, limit: number) {
  const start = Math.max(0, Math.floor(offset));
  const stop = start + Math.max(0, Math.floor(limit)) - 1;
  if (stop < start) return { total: 0, items: [] as any[] };

  const total = Number((await redisCommand(env, ["ZCARD", logIndexKey(env)])) ?? 0);
  const uuids = (await redisCommand<unknown>(env, ["ZREVRANGE", logIndexKey(env), start, stop])) as unknown;
  const members = Array.isArray(uuids) ? (uuids as any[]).map((x) => String(x)) : [];
  if (members.length === 0) return { total, items: [] as any[] };

  const keys = members.map((u) => logKey(env, u));
  const rawList = (await redisCommand<unknown>(env, ["MGET", ...keys])) as unknown;
  const raws = Array.isArray(rawList) ? (rawList as any[]) : [];

  const items: any[] = [];
  for (const raw of raws) {
    if (!raw) continue;
    try {
      items.push(JSON.parse(String(raw)));
    } catch {
      // ignore bad item
    }
  }
  return { total, items };
}

export async function listRedisUserAgents(env: Env) {
  const raw = await redisCommand<unknown>(env, ["SMEMBERS", userAgentsKey(env)]);
  return Array.isArray(raw) ? (raw as any[]).map((x) => String(x)).filter(Boolean) : [];
}

export async function getRedisModelCalls(env: Env) {
  const raw = await redisCommand<unknown>(env, ["HGETALL", modelCallsKey(env)]);
  if (!Array.isArray(raw)) return new Map<string, number>();
  const entries = raw as any[];
  const out = new Map<string, number>();
  for (let i = 0; i + 1 < entries.length; i += 2) {
    out.set(String(entries[i]), Number(entries[i + 1] ?? 0));
  }
  return out;
}

export async function getRedisProjectCalls(env: Env) {
  const raw = await redisCommand<unknown>(env, ["HGETALL", projectCallsKey(env)]);
  if (!Array.isArray(raw)) return new Map<number, number>();
  const entries = raw as any[];
  const out = new Map<number, number>();
  for (let i = 0; i + 1 < entries.length; i += 2) {
    out.set(Number(entries[i]), Number(entries[i + 1] ?? 0));
  }
  return out;
}

export async function getRedisUseForDays(env: Env, days: number) {
  const keepDays = Math.max(1, Math.floor(days));
  const now = new Date();
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));

  let reqs = 0;
  let tokens = 0;
  for (let i = 0; i < keepDays; i++) {
    const d = new Date(startOfToday.getTime() - i * 24 * 60 * 60 * 1000);
    const day = d.toISOString().slice(0, 10);
    const raw = await redisCommand<unknown>(env, ["HMGET", useDayKey(env, day), "reqs", "tokens"]);
    if (Array.isArray(raw)) {
      reqs += Number(raw[0] ?? 0);
      tokens += Number(raw[1] ?? 0);
    }
  }
  return { reqs, tokens };
}
