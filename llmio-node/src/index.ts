import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { Pool } from "pg";
import { Redis } from "ioredis";
import cron from "node-cron";

import type { AppEnv } from "./types.js";
import { adminAuth, authAnthropic, authGemini, authOpenAI } from "./middleware/auth.js";
import { openaiRoutes } from "./routes/openai.js";
import { anthropicRoutes } from "./routes/anthropic.js";
import { geminiRoutes } from "./routes/gemini.js";
import { apiRoutes } from "./routes/api.js";
import { flushChatLogEventsToDb } from "./services/chat-log-queue.js";
import { cleanupChatLogsKeepRecentDays, cleanupRedisChatLogsKeepRecentDays } from "./services/chat-log-retention.js";
import { DefaultPort, StyleOpenAI, StyleOpenAIRes, StyleAnthropic } from "./consts.js";
import { chatProxy, countTokensProxy } from "./services/chat.js";
import { modelsByTypes } from "./services/models.js";
import { successRaw } from "./common/response.js";

// 初始化数据库连接池
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  // 连接池配置
  max: 10,                        // 最大连接数
  idleTimeoutMillis: 30000,       // 空闲连接超时 30 秒
  connectionTimeoutMillis: 5000,  // 连接超时 5 秒
});

// 处理连接池错误，避免进程崩溃
db.on("error", (err) => {
  console.error("PostgreSQL pool error:", err.message);
});

// 初始化 Redis 连接（可选）
let redis: InstanceType<typeof Redis> | null = null;
if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL);
  redis.on("error", (err: Error) => console.error("Redis error:", err));
}

// 创建 Hono 应用
const app = new Hono<AppEnv>();

// 环境注入中间件（抽取为函数以便复用）
const injectEnv = async (c: any, next: any) => {
  c.env.db = db;
  c.env.redis = redis as any;
  c.env.TOKEN = process.env.API_KEY;
  c.env.REDIS_PREFIX = process.env.REDIS_PREFIX;
  c.env.REDIS_DEFAULT_TTL_SECONDS = process.env.REDIS_DEFAULT_TTL_SECONDS;
  // 初始化默认变量，避免未设置时报错
  c.set("authKeyId", 0);
  c.set("allowAllModel", false);
  c.set("allowModels", []);
  await next();
};

// 注入环境变量（主应用）
app.use("*", injectEnv);

// OpenAI 兼容路由
const openaiApp = new Hono<AppEnv>();
openaiApp.use("*", injectEnv);
openaiApp.use("*", authOpenAI());
openaiApp.route("/", openaiRoutes);
app.route("/openai", openaiApp);

// Anthropic 兼容路由
const anthropicApp = new Hono<AppEnv>();
anthropicApp.use("*", injectEnv);
anthropicApp.use("*", authAnthropic());
anthropicApp.route("/", anthropicRoutes);
app.route("/anthropic", anthropicApp);

// Gemini 兼容路由
const geminiApp = new Hono<AppEnv>();
geminiApp.use("*", injectEnv);
geminiApp.use("*", authGemini());
geminiApp.route("/", geminiRoutes);
app.route("/gemini", geminiApp);

// 兼容性路由：/v1 统一入口（与 Go 版一致）
// 注意：直接挂载路由，不使用 .fetch() 以保留 context 变量
app.get("/v1/models", authOpenAI(), async (c) => {
  try {
    const models = await modelsByTypes(c.env.db, [StyleOpenAI, StyleOpenAIRes]);
    const data = models.map((m: any) => ({
      id: m.name,
      object: "model",
      created: Math.floor(new Date(m.created_at).getTime() / 1000),
      owned_by: "llmio",
    }));
    return successRaw(c, { object: "list", data });
  } catch (e) {
    return c.json({ code: 500, message: (e as Error).message }, 500);
  }
});
app.post("/v1/chat/completions", authOpenAI(), async (c) => chatProxy(c, StyleOpenAI));
app.post("/v1/responses", authOpenAI(), async (c) => chatProxy(c, StyleOpenAIRes));
app.post("/v1/messages", authAnthropic(), async (c) => chatProxy(c, StyleAnthropic));
app.post("/v1/messages/count_tokens", authAnthropic(), async (c) => countTokensProxy(c));

// API 管理路由
const apiApp = new Hono<AppEnv>();
apiApp.use("*", injectEnv);
apiApp.use("*", adminAuth());
apiApp.route("/", apiRoutes);
app.route("/api", apiApp);

// 静态资源服务
const staticDir = process.env.STATIC_DIR || "./dist/public";
app.use("/*", serveStatic({ root: staticDir }));

// 预加载 index.html（SPA 回退用）
const indexHtmlPath = resolve(staticDir, "index.html");
let indexHtml = "<!DOCTYPE html><html><head><title>llmio</title></head><body><h1>llmio-node</h1><p>请配置 STATIC_DIR 或将前端构建产物放到 public 目录</p></body></html>";
if (existsSync(indexHtmlPath)) {
  indexHtml = readFileSync(indexHtmlPath, "utf-8");
}

// SPA 回退
app.get("*", async (c) => {
  const path = c.req.path;

  // API 路由不做 SPA 回退，直接 404
  if (
    path.startsWith("/api") ||
    path.startsWith("/openai") ||
    path.startsWith("/anthropic") ||
    path.startsWith("/gemini") ||
    path.startsWith("/v1")
  ) {
    return c.text("404 Not Found", 404);
  }

  // SPA 路由：回退到 index.html
  return c.html(indexHtml);
});

// 定时任务
const env = {
  db,
  redis: redis as any,
  REDIS_PREFIX: process.env.REDIS_PREFIX,
  REDIS_DEFAULT_TTL_SECONDS: process.env.REDIS_DEFAULT_TTL_SECONDS,
};

// 每小时：Redis 队列 -> 数据库
cron.schedule("0 * * * *", async () => {
  console.log("[cron] Flushing chat log events to database...");
  try {
    const result = await flushChatLogEventsToDb(env as any, 500);
    console.log(`[cron] Flush result: processed=${result.processed}, dead=${result.dead}, skipped=${result.skipped}`);
  } catch (e) {
    console.error("[cron] Flush error:", e);
  }
});

// 每天 00:00 UTC：落库 + 清理 30 天前日志
cron.schedule("0 0 * * *", async () => {
  console.log("[cron] Running daily cleanup...");
  try {
    await flushChatLogEventsToDb(env as any, 500);
    await cleanupChatLogsKeepRecentDays(env as any, 30);
    await cleanupRedisChatLogsKeepRecentDays(env as any, 30, 2000);
    console.log("[cron] Daily cleanup completed");
  } catch (e) {
    console.error("[cron] Cleanup error:", e);
  }
});

// 启动服务器
const port = Number(process.env.PORT) || Number(DefaultPort);
const host = process.env.HOST || "0.0.0.0";

console.log(`Starting llmio-node server on ${host}:${port}...`);

serve({
  fetch: app.fetch,
  port,
  hostname: host,
}, (info) => {
  console.log(`Server is running on http://${info.address}:${info.port}`);
});

// 优雅关闭
process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  await db.end();
  if (redis) await redis.quit();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("Shutting down...");
  await db.end();
  if (redis) await redis.quit();
  process.exit(0);
});
