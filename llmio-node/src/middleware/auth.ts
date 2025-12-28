import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types.js";
import { findAuthKeyByKey, touchAuthKeyUsage } from "../db/repo.js";
import { unauthorized } from "../common/response.js";
import { cacheGetJson, cacheSetJson } from "../services/cache.js";

function parseBearer(authHeader: string | null) {
  if (!authHeader) return "";
  const [scheme, token] = authHeader.split(" ", 2);
  if (scheme !== "Bearer" || !token) return "";
  return token;
}

export function adminAuth(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = c.env.TOKEN ?? "";
    if (!token) return next();

    const bearer = parseBearer(c.req.header("Authorization") ?? null);
    if (!bearer) return unauthorized(c, "Authorization header is missing");
    if (bearer !== token) return unauthorized(c, "Invalid token");
    await next();
  };
}

export function authOpenAI(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const adminToken = c.env.TOKEN ?? "";
    const key = parseBearer(c.req.header("Authorization") ?? null);
    const res = await checkAuthKey(c, key, adminToken);
    if (res) return res;
    await next();
  };
}

export function authAnthropic(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const adminToken = c.env.TOKEN ?? "";
    const key = c.req.header("x-api-key") ?? "";
    const res = await checkAuthKey(c, key, adminToken);
    if (res) return res;
    await next();
  };
}

export function authGemini(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const adminToken = c.env.TOKEN ?? "";
    const key = c.req.header("x-goog-api-key") ?? "";
    const res = await checkAuthKey(c, key, adminToken);
    if (res) return res;
    await next();
  };
}

async function checkAuthKey(c: Parameters<MiddlewareHandler<AppEnv>>[0], key: string, adminToken: string) {
  // 与 Go 版一致：未配置 TOKEN 或使用管理员 token 时，允许访问所有模型
  if (!adminToken || key === adminToken) {
    c.set("authKeyId", 0);
    c.set("allowAllModel", true);
    c.set("allowModels", []);
    return null;
  }

  if (!key) return unauthorized(c, "Authorization key is missing");

  const cached = await cacheGetJson<any>(c.env, "auth_keys", `key:${key}`);
  const authKey = cached ?? await findAuthKeyByKey(c.env.db, key);

  // 调试日志
  console.log("[auth] key:", key);
  console.log("[auth] authKey:", JSON.stringify(authKey));

  if (!authKey) return unauthorized(c, "Invalid token");

  if (!cached) {
    await cacheSetJson(c.env, "auth_keys", `key:${key}`, authKey);
  }

  if (authKey.expires_at) {
    const expiresAtMs = Date.parse(authKey.expires_at);
    if (Number.isFinite(expiresAtMs) && expiresAtMs < Date.now()) return unauthorized(c, "Token has expired");
  }

  // 统计用量（不阻塞响应）- Node.js 中使用 setImmediate 或 Promise
  setImmediate(() => {
    touchAuthKeyUsage(c.env.db, authKey.id).catch(console.error);
  });

  // 兼容多种格式：1, true, "1", "true"
  const allowAll = authKey.allow_all === 1 || authKey.allow_all === true || String(authKey.allow_all) === "1" || String(authKey.allow_all) === "true";
  console.log("[auth] allow_all raw:", authKey.allow_all, "parsed:", allowAll);

  c.set("authKeyId", authKey.id);
  c.set("allowAllModel", allowAll);
  c.set("allowModels", allowAll ? [] : safeParseModels(authKey.models));
  return null;
}

function safeParseModels(raw: string): string[] {
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => String(x).trim()).filter(Boolean);
  } catch {
    return [];
  }
}
