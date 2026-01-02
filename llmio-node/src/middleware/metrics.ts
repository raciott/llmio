/**
 * HTTP 请求监控中间件
 * 记录每个请求的响应时间和状态码
 */

import type { Context, Next } from "hono";
import type { AppEnv } from "../types.js";
import { recordHttpRequest, setActiveConnections } from "../services/metrics.js";

// 活跃连接计数
let activeConnections = 0;

/**
 * 监控中间件：记录请求指标
 */
export function metricsMiddleware() {
  return async (c: Context<AppEnv>, next: Next) => {
    const start = Date.now();
    const method = c.req.method;
    const path = normalizePath(c.req.path);

    // 增加活跃连接数
    activeConnections++;
    setActiveConnections(activeConnections);

    try {
      await next();
    } finally {
      // 减少活跃连接数
      activeConnections--;
      setActiveConnections(activeConnections);

      // 记录请求指标
      const durationMs = Date.now() - start;
      const status = c.res.status;
      recordHttpRequest(method, path, status, durationMs);
    }
  };
}

/**
 * 规范化路径：移除动态参数，避免高基数标签
 * 例如：/v1/models/gpt-4 -> /v1/models/:model
 */
function normalizePath(path: string): string {
  // API 路径规范化
  const patterns = [
    // /gemini/models/gemini-pro:generateContent -> /gemini/models/:model
    { regex: /^\/gemini\/models\/[^/]+.*$/, replacement: "/gemini/models/:model" },
    // /openai/models/gpt-4 -> /openai/models (通常是列表端点)
    { regex: /^\/openai\/models\/[^/]+$/, replacement: "/openai/models/:model" },
    // /api/xxx/:id 类型的路径
    { regex: /^(\/api\/\w+)\/\d+$/, replacement: "$1/:id" },
    // UUID 路径
    { regex: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, replacement: ":uuid" },
  ];

  let normalized = path;
  for (const { regex, replacement } of patterns) {
    normalized = normalized.replace(regex, replacement);
  }

  return normalized;
}
