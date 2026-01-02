/**
 * 健康检查服务（基于数据库日志统计）
 */

import type { Pool } from "pg";
import type { Redis } from "ioredis";

// 请求块状态（每个块代表一次请求）
export interface ModelHealthRequestBlock {
  success: boolean; // 请求是否成功
  timestamp: string; // 请求时间（ISO 8601）
}

// 模型健康状态
export interface ModelHealth {
  modelName: string;
  providerModel: string;
  status: "healthy" | "degraded" | "unhealthy" | "unknown";
  totalRequests: number;
  failedRequests: number;
  successRate: number; // 0-100 之间
  avgResponseTimeMs: number;
  lastCheck: string;
  lastError?: string;
  requestBlocks: ModelHealthRequestBlock[]; // 最近100次请求，从旧到新
}

// Provider 健康状态（带模型列表）
export interface ProviderHealth {
  id: number;
  name: string;
  type: string;
  status: "healthy" | "degraded" | "unhealthy" | "unknown";
  lastCheck: string;
  responseTimeMs: number;
  errorRate: number; // 0-1 之间的错误率
  totalRequests: number;
  failedRequests: number;
  lastError?: string;
  models: ModelHealth[]; // 该提供商下的模型列表
}

// 系统健康状态
export interface SystemHealth {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  uptime: number; // 总运行时间（秒），基于首次部署时间
  processUptime: number; // 当前进程运行时间（秒）
  firstDeployTime: string; // 首次部署时间（ISO 8601）
  components: {
    database: ComponentStatus;
    redis: ComponentStatus;
    providers: {
      status: "healthy" | "degraded" | "unhealthy";
      total: number;
      healthy: number;
      degraded: number;
      unhealthy: number;
      details: ProviderHealth[];
    };
  };
}

interface ComponentStatus {
  status: "healthy" | "degraded" | "unhealthy";
  message?: string;
  responseTimeMs?: number;
}

/**
 * 获取模型在指定时间窗口内的健康状态
 * @param db 数据库连接池
 * @param providerName Provider 名称
 * @param modelName 模型名称
 * @param providerModel Provider 中的模型名称
 * @param timeWindowMinutes 统计时间窗口（分钟）
 */
async function getModelHealthStatus(
  db: Pool,
  providerName: string,
  modelName: string,
  providerModel: string,
  timeWindowMinutes: number
): Promise<ModelHealth> {
  try {
    const windowStart = new Date(Date.now() - timeWindowMinutes * 60 * 1000);

    // 查询该模型在时间窗口内的统计数据
    const statsResult = await db.query<{
      total_requests: string;
      failed_requests: string;
      avg_response_time: string;
      last_check: Date | null;
    }>(
      `SELECT
        COUNT(*) as total_requests,
        COUNT(*) FILTER (WHERE status != 'success') as failed_requests,
        COALESCE(AVG(proxy_time_ms) FILTER (WHERE proxy_time_ms > 0), 0) as avg_response_time,
        MAX(created_at) as last_check
      FROM chat_logs
      WHERE provider_name = $1
        AND name = $2
        AND created_at >= $3
        AND deleted_at IS NULL`,
      [providerName, modelName, windowStart]
    );

    const stats = statsResult.rows[0];
    const totalRequests = Number.parseInt(stats?.total_requests || "0", 10);
    const failedRequests = Number.parseInt(stats?.failed_requests || "0", 10);
    const avgResponseTime = Math.round(Number.parseFloat(stats?.avg_response_time || "0"));
    const lastCheck = stats?.last_check || new Date();

    // 获取最近100次请求记录
    const requestBlocks = await generateModelRequestBlocks(
      db,
      providerName,
      modelName,
      100 // 最近100次请求
    );

    // 如果没有请求记录
    if (totalRequests === 0) {
      return {
        modelName,
        providerModel,
        status: "unknown",
        totalRequests: 0,
        failedRequests: 0,
        successRate: 0,
        avgResponseTimeMs: 0,
        lastCheck: lastCheck.toISOString(),
        requestBlocks,
      };
    }

    // 计算成功率
    const successRate = ((totalRequests - failedRequests) / totalRequests) * 100;

    // 健康状态判断逻辑
    let status: "healthy" | "degraded" | "unhealthy";
    const errorRate = failedRequests / totalRequests;
    if (errorRate > 0.5) {
      status = "unhealthy"; // 错误率超过 50%
    } else if (errorRate > 0.2 || avgResponseTime > 5000) {
      status = "degraded"; // 错误率超过 20% 或平均响应时间超过 5s
    } else {
      status = "healthy";
    }

    // 获取最近的错误信息
    const errorResult = await db.query<{ error: string }>(
      `SELECT error
      FROM chat_logs
      WHERE provider_name = $1
        AND name = $2
        AND status != 'success'
        AND error != ''
        AND created_at >= $3
        AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
      [providerName, modelName, windowStart]
    );

    const lastError = errorResult.rows[0]?.error;

    return {
      modelName,
      providerModel,
      status,
      totalRequests,
      failedRequests,
      successRate: Math.round(successRate * 10) / 10,
      avgResponseTimeMs: avgResponseTime,
      lastCheck: lastCheck.toISOString(),
      lastError,
      requestBlocks,
    };
  } catch (e) {
    console.error(
      `[health] Failed to get model health status for ${providerName}/${modelName}:`,
      e
    );
    return {
      modelName,
      providerModel,
      status: "unknown",
      totalRequests: 0,
      failedRequests: 0,
      successRate: 0,
      avgResponseTimeMs: 0,
      lastCheck: new Date().toISOString(),
      lastError: (e as Error).message,
      requestBlocks: [],
    };
  }
}

/**
 * 生成模型的请求块数据（最近N次请求）
 * @param db 数据库连接池
 * @param providerName Provider 名称
 * @param modelName 模型名称
 * @param limit 请求数量限制
 */
async function generateModelRequestBlocks(
  db: Pool,
  providerName: string,
  modelName: string,
  limit: number
): Promise<ModelHealthRequestBlock[]> {
  try {
    // 查询最近N次请求记录，按时间倒序
    const result = await db.query<{
      status: string;
      created_at: Date;
    }>(
      `SELECT status, created_at
      FROM chat_logs
      WHERE provider_name = $1
        AND name = $2
        AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT $3`,
      [providerName, modelName, limit]
    );

    // 反转数组，使其从旧到新排列
    const blocks = result.rows.reverse().map((row) => ({
      success: row.status === "success",
      timestamp: row.created_at.toISOString(),
    }));

    return blocks;
  } catch (e) {
    console.error(
      `[health] Failed to generate request blocks for ${providerName}/${modelName}:`,
      e
    );
    return [];
  }
}

/**
 * 记录 Provider 请求结果（兼容性保留，实际统计从数据库）
 */
export function recordProviderHealth(
  _providerName: string,
  _success: boolean,
  _responseTimeMs: number,
  _error?: string
) {
  // 不再使用内存统计，数据已通过 chat_logs 表持久化
  // 此函数保留仅为兼容性，可以安全移除所有调用
}

/**
 * 从数据库获取 Provider 健康状态（包含模型列表）
 * @param db 数据库连接池
 * @param providerId Provider ID
 * @param providerName Provider 名称
 * @param providerType Provider 类型
 * @param timeWindowMinutes 统计时间窗口（分钟），默认 60 分钟
 */
export async function getProviderHealthStatus(
  db: Pool,
  providerId: number,
  providerName: string,
  providerType: string,
  timeWindowMinutes = 60
): Promise<ProviderHealth> {
  try {
    // 计算时间窗口起始时间
    const windowStart = new Date(Date.now() - timeWindowMinutes * 60 * 1000);

    // 查询该 Provider 在时间窗口内的统计数据
    const statsResult = await db.query<{
      total_requests: string;
      failed_requests: string;
      avg_response_time: string;
      last_check: Date | null;
    }>(
      `SELECT
        COUNT(*) as total_requests,
        COUNT(*) FILTER (WHERE status != 'success') as failed_requests,
        COALESCE(AVG(proxy_time_ms) FILTER (WHERE proxy_time_ms > 0), 0) as avg_response_time,
        MAX(created_at) as last_check
      FROM chat_logs
      WHERE provider_name = $1
        AND created_at >= $2
        AND deleted_at IS NULL`,
      [providerName, windowStart]
    );

    const stats = statsResult.rows[0];
    const totalRequests = Number.parseInt(stats?.total_requests || "0", 10);
    const failedRequests = Number.parseInt(stats?.failed_requests || "0", 10);
    const avgResponseTime = Math.round(Number.parseFloat(stats?.avg_response_time || "0"));
    const lastCheck = stats?.last_check || new Date();

    // 查询该 Provider 下有哪些模型（从 chat_logs 中去重）
    const modelsResult = await db.query<{
      model_name: string;
      provider_model: string;
    }>(
      `SELECT DISTINCT name as model_name, provider_model
      FROM chat_logs
      WHERE provider_name = $1
        AND created_at >= $2
        AND deleted_at IS NULL
      ORDER BY model_name`,
      [providerName, windowStart]
    );

    // 并行获取每个模型的健康状态
    const modelHealthPromises = modelsResult.rows.map((row) =>
      getModelHealthStatus(
        db,
        providerName,
        row.model_name,
        row.provider_model || "",
        timeWindowMinutes
      )
    );

    const models = await Promise.all(modelHealthPromises);

    // 如果没有请求记录
    if (totalRequests === 0) {
      return {
        id: providerId,
        name: providerName,
        type: providerType,
        status: "unknown",
        lastCheck: lastCheck.toISOString(),
        responseTimeMs: 0,
        errorRate: 0,
        totalRequests: 0,
        failedRequests: 0,
        models,
      };
    }

    // 计算错误率
    const errorRate = failedRequests / totalRequests;

    // 健康状态判断逻辑
    let status: "healthy" | "degraded" | "unhealthy";
    if (errorRate > 0.5) {
      status = "unhealthy"; // 错误率超过 50%
    } else if (errorRate > 0.2 || avgResponseTime > 5000) {
      status = "degraded"; // 错误率超过 20% 或平均响应时间超过 5s
    } else {
      status = "healthy";
    }

    // 获取最近的错误信息
    const errorResult = await db.query<{ error: string }>(
      `SELECT error
      FROM chat_logs
      WHERE provider_name = $1
        AND status != 'success'
        AND error != ''
        AND created_at >= $2
        AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
      [providerName, windowStart]
    );

    const lastError = errorResult.rows[0]?.error;

    return {
      id: providerId,
      name: providerName,
      type: providerType,
      status,
      lastCheck: lastCheck.toISOString(),
      responseTimeMs: avgResponseTime,
      errorRate: Math.round(errorRate * 100) / 100,
      totalRequests,
      failedRequests,
      lastError,
      models,
    };
  } catch (e) {
    console.error(`[health] Failed to get health status for ${providerName}:`, e);
    // 出错时返回未知状态
    return {
      id: providerId,
      name: providerName,
      type: providerType,
      status: "unknown",
      lastCheck: new Date().toISOString(),
      responseTimeMs: 0,
      errorRate: 0,
      totalRequests: 0,
      failedRequests: 0,
      lastError: (e as Error).message,
      models: [],
    };
  }
}

/**
 * 检查数据库健康状态
 */
export async function checkDatabaseHealth(db: Pool): Promise<ComponentStatus> {
  const start = Date.now();
  try {
    await db.query("SELECT 1");
    const responseTimeMs = Date.now() - start;
    return {
      status: responseTimeMs < 1000 ? "healthy" : "degraded",
      responseTimeMs,
    };
  } catch (e) {
    return {
      status: "unhealthy",
      message: (e as Error).message,
      responseTimeMs: Date.now() - start,
    };
  }
}

/**
 * 检查 Redis 健康状态
 */
export async function checkRedisHealth(
  redis: Redis | null
): Promise<ComponentStatus> {
  if (!redis) {
    return { status: "healthy", message: "disabled" };
  }

  const start = Date.now();
  try {
    await redis.ping();
    const responseTimeMs = Date.now() - start;
    return {
      status: responseTimeMs < 500 ? "healthy" : "degraded",
      responseTimeMs,
    };
  } catch (e) {
    return {
      status: "unhealthy",
      message: (e as Error).message,
      responseTimeMs: Date.now() - start,
    };
  }
}

/**
 * 获取或初始化首次部署时间
 * @param db 数据库连接池
 */
async function getFirstDeployTime(db: Pool): Promise<string> {
  try {
    // 尝试获取已存储的首次部署时间
    const result = await db.query<{ value: string }>(
      "SELECT value FROM config WHERE key = 'first_deploy_time' AND deleted_at IS NULL"
    );

    if (result.rows.length > 0) {
      return result.rows[0].value;
    }

    // 如果不存在，创建并返回当前时间
    const now = new Date().toISOString();
    await db.query(
      `INSERT INTO config (key, value, created_at, updated_at)
       VALUES ('first_deploy_time', $1, NOW(), NOW())
       ON CONFLICT (key) DO NOTHING`,
      [now]
    );

    // 再次查询（可能被其他进程插入了）
    const retryResult = await db.query<{ value: string }>(
      "SELECT value FROM config WHERE key = 'first_deploy_time' AND deleted_at IS NULL"
    );

    return retryResult.rows[0]?.value || now;
  } catch (e) {
    console.error("[health] Failed to get first deploy time:", e);
    return new Date().toISOString();
  }
}

/**
 * 获取所有 Provider 的健康状态
 * @param db 数据库连接池
 * @param timeWindowMinutes 统计时间窗口（分钟），默认 60 分钟
 */
export async function getProvidersHealth(
  db: Pool,
  timeWindowMinutes = 60
): Promise<ProviderHealth[]> {
  try {
    // 获取所有未删除的 Provider
    const result = await db.query<{
      id: number;
      name: string;
      type: string;
    }>(
      "SELECT id, name, type FROM providers WHERE deleted_at IS NULL ORDER BY id"
    );

    // 并行获取每个 Provider 的健康状态
    const healthPromises = result.rows.map((provider) =>
      getProviderHealthStatus(
        db,
        Number(provider.id),
        String(provider.name),
        String(provider.type),
        timeWindowMinutes
      )
    );

    return await Promise.all(healthPromises);
  } catch (e) {
    console.error("[health] Failed to get providers health:", e);
    return [];
  }
}

/**
 * 获取系统整体健康状态
 * @param db 数据库连接池
 * @param redis Redis 连接
 * @param timeWindowMinutes 统计时间窗口（分钟），默认 60 分钟
 */
export async function getSystemHealth(
  db: Pool,
  redis: Redis | null,
  timeWindowMinutes = 60
): Promise<SystemHealth> {
  const [dbHealth, redisHealth, providersHealth, firstDeployTime] = await Promise.all([
    checkDatabaseHealth(db),
    checkRedisHealth(redis),
    getProvidersHealth(db, timeWindowMinutes),
    getFirstDeployTime(db),
  ]);

  // 计算总运行时间（从首次部署到现在）
  const firstDeployDate = new Date(firstDeployTime);
  const totalUptime = Math.floor((Date.now() - firstDeployDate.getTime()) / 1000);

  // 统计 Provider 健康状态
  const healthyCount = providersHealth.filter(
    (p) => p.status === "healthy"
  ).length;
  const degradedCount = providersHealth.filter(
    (p) => p.status === "degraded"
  ).length;
  const unhealthyCount = providersHealth.filter(
    (p) => p.status === "unhealthy"
  ).length;

  let providersStatus: "healthy" | "degraded" | "unhealthy";
  if (providersHealth.length === 0) {
    providersStatus = "healthy"; // 无 Provider 时视为健康
  } else if (unhealthyCount > providersHealth.length / 2) {
    providersStatus = "unhealthy"; // 超过一半不健康
  } else if (unhealthyCount > 0 || degradedCount > providersHealth.length / 3) {
    providersStatus = "degraded"; // 有不健康或超过 1/3 降级
  } else {
    providersStatus = "healthy";
  }

  // 系统整体状态
  let systemStatus: "healthy" | "degraded" | "unhealthy";
  if (
    dbHealth.status === "unhealthy" ||
    (redisHealth.status === "unhealthy" && redisHealth.message !== "disabled")
  ) {
    systemStatus = "unhealthy";
  } else if (
    dbHealth.status === "degraded" ||
    redisHealth.status === "degraded" ||
    providersStatus === "unhealthy"
  ) {
    systemStatus = "degraded";
  } else if (providersStatus === "degraded") {
    systemStatus = "degraded";
  } else {
    systemStatus = "healthy";
  }

  return {
    status: systemStatus,
    timestamp: new Date().toISOString(),
    uptime: totalUptime,
    processUptime: Math.floor(process.uptime()),
    firstDeployTime,
    components: {
      database: dbHealth,
      redis: redisHealth,
      providers: {
        status: providersStatus,
        total: providersHealth.length,
        healthy: healthyCount,
        degraded: degradedCount,
        unhealthy: unhealthyCount,
        details: providersHealth,
      },
    },
  };
}

/**
 * 重置所有 Provider 统计信息（已废弃，保留用于兼容）
 */
export function resetProviderStats() {
  // 不再需要，数据在数据库中
}
