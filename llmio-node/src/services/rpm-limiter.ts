/**
 * RPM（每分钟请求数）限流服务
 * 使用滑动窗口算法实现精确的分钟级限流
 */

import type { Redis } from "ioredis";

// 内存存储（当 Redis 不可用时使用）
const memoryStore: Map<string, number[]> = new Map();

// Redis 实例（可选）
let redisClient: Redis | null = null;

/**
 * 初始化 RPM 限流器
 * @param redis Redis 客户端（可选）
 */
export function initRpmLimiter(redis: Redis | null) {
  redisClient = redis;
}

/**
 * 获取供应商的 RPM 计数键
 */
function getRpmKey(providerId: number): string {
  return `rpm:provider:${providerId}`;
}

/**
 * 检查供应商是否达到 RPM 限制
 * @param providerId 供应商 ID
 * @param rpmLimit RPM 限制（0 表示无限制）
 * @returns 是否允许请求
 */
export async function checkRpmLimit(
  providerId: number,
  rpmLimit: number
): Promise<boolean> {
  // 0 表示无限制
  if (rpmLimit <= 0) {
    return true;
  }

  const now = Date.now();
  const windowStart = now - 60 * 1000; // 1分钟前

  if (redisClient) {
    return await checkRpmLimitRedis(providerId, rpmLimit, now, windowStart);
  } else {
    return checkRpmLimitMemory(providerId, rpmLimit, now, windowStart);
  }
}

/**
 * 记录一次请求（增加计数）
 * @param providerId 供应商 ID
 */
export async function recordRpmRequest(providerId: number): Promise<void> {
  const now = Date.now();

  if (redisClient) {
    await recordRpmRequestRedis(providerId, now);
  } else {
    recordRpmRequestMemory(providerId, now);
  }
}

/**
 * 获取供应商当前的 RPM 计数
 * @param providerId 供应商 ID
 * @returns 当前分钟内的请求数
 */
export async function getCurrentRpmCount(providerId: number): Promise<number> {
  const now = Date.now();
  const windowStart = now - 60 * 1000;

  if (redisClient) {
    return await getCurrentRpmCountRedis(providerId, windowStart, now);
  } else {
    return getCurrentRpmCountMemory(providerId, windowStart);
  }
}

// ==================== Redis 实现 ====================

async function checkRpmLimitRedis(
  providerId: number,
  rpmLimit: number,
  now: number,
  windowStart: number
): Promise<boolean> {
  const key = getRpmKey(providerId);

  try {
    // 移除过期的请求记录
    await redisClient!.zremrangebyscore(key, 0, windowStart);

    // 获取当前窗口内的请求数
    const count = await redisClient!.zcard(key);

    return count < rpmLimit;
  } catch (e) {
    console.error(`[rpm-limiter] Redis check failed for provider ${providerId}:`, e);
    // Redis 出错时降级为允许
    return true;
  }
}

async function recordRpmRequestRedis(
  providerId: number,
  now: number
): Promise<void> {
  const key = getRpmKey(providerId);

  try {
    // 使用有序集合存储请求时间戳
    // score 和 member 都使用时间戳，确保唯一性
    await redisClient!.zadd(key, now, `${now}-${Math.random()}`);

    // 设置过期时间为 2 分钟（确保数据能被清理）
    await redisClient!.expire(key, 120);
  } catch (e) {
    console.error(`[rpm-limiter] Redis record failed for provider ${providerId}:`, e);
  }
}

async function getCurrentRpmCountRedis(
  providerId: number,
  windowStart: number,
  now: number
): Promise<number> {
  const key = getRpmKey(providerId);

  try {
    // 移除过期的请求记录
    await redisClient!.zremrangebyscore(key, 0, windowStart);

    // 获取当前窗口内的请求数
    return await redisClient!.zcard(key);
  } catch (e) {
    console.error(`[rpm-limiter] Redis count failed for provider ${providerId}:`, e);
    return 0;
  }
}

// ==================== 内存实现 ====================

function checkRpmLimitMemory(
  providerId: number,
  rpmLimit: number,
  _now: number,
  windowStart: number
): boolean {
  const key = getRpmKey(providerId);
  const timestamps = memoryStore.get(key) || [];

  // 过滤出窗口内的请求
  const validTimestamps = timestamps.filter((t) => t > windowStart);

  // 更新存储
  memoryStore.set(key, validTimestamps);

  return validTimestamps.length < rpmLimit;
}

function recordRpmRequestMemory(providerId: number, now: number): void {
  const key = getRpmKey(providerId);
  const timestamps = memoryStore.get(key) || [];

  // 添加新的时间戳
  timestamps.push(now);

  // 清理过期数据（保留最近2分钟的）
  const windowStart = now - 120 * 1000;
  const validTimestamps = timestamps.filter((t) => t > windowStart);

  memoryStore.set(key, validTimestamps);
}

function getCurrentRpmCountMemory(
  providerId: number,
  windowStart: number
): number {
  const key = getRpmKey(providerId);
  const timestamps = memoryStore.get(key) || [];

  // 过滤出窗口内的请求
  const validTimestamps = timestamps.filter((t) => t > windowStart);

  return validTimestamps.length;
}

/**
 * 清理所有内存中的 RPM 数据（用于测试）
 */
export function clearRpmData(): void {
  memoryStore.clear();
}
