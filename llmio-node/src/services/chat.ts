import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import type { AppEnv, Style } from "../types.js";
import { internalServerError, errorWithHttpStatus } from "../common/response.js";
import { beforeAnthropic, beforeGemini, beforeOpenAI, beforeOpenAIRes } from "./before.js";
import { buildHeaders } from "./headers.js";
import { applyProviderAuthHeaders, buildProviderRequest } from "./providers.js";
import { newBalancer } from "./balancers.js";
import { processAnthropic, processGemini, processOpenAI, processOpenAIRes } from "./process.js";
import type { ChatLogBase } from "./chat-log-events.js";
import { enqueueChatLogEvent } from "./chat-log-queue.js";
import { recordProviderRequest, recordError, recordRetry, recordTokenUsage } from "./metrics.js";
import { recordProviderHealth } from "./health.js";
import { checkRpmLimit, recordRpmRequest } from "./rpm-limiter.js";

type ProvidersWithMeta = {
  modelWithProviderMap: Map<number, any>;
  weightItems: Map<number, number>;
  providerMap: Map<number, any>;
  maxRetry: number;
  timeOut: number;
  ioLog: boolean;
  strategy: string;
  breaker: boolean;
};

export async function chatProxy(c: Context<AppEnv>, style: Style) {
  try {
    const raw = new Uint8Array(await c.req.arrayBuffer());
    const before =
      style === "openai"
        ? beforeOpenAI(raw)
        : style === "openai-res"
          ? beforeOpenAIRes(raw)
          : style === "anthropic"
            ? beforeAnthropic(raw)
            : (() => {
                throw new Error("unsupported style");
              })();

    const valid = validateAuthKey(c, before.model);
    if (!valid) return errorWithHttpStatus(c, 403, 403, "auth key has no permission to use this model");

    const providersWithMeta = await providersWithMetaByModelName(c, style, before);
    const startedAtMs = Date.now();
    const { res, logUUID, ioLog, logBase } = await balanceChat(c, startedAtMs, style, before, providersWithMeta);

    const outHeaders = new Headers(res.headers);

    // 透传头；流式时强制为 SSE
    if (before.stream) {
      outHeaders.set("Content-Type", "text/event-stream");
      outHeaders.set("Cache-Control", "no-cache");
      outHeaders.set("Connection", "keep-alive");
      outHeaders.set("X-Accel-Buffering", "no");
    } else if (!outHeaders.get("Content-Type")) {
      // 部分上游网关未返回 Content-Type，Claude Code/SDK 可能无法正确识别
      outHeaders.set("Content-Type", "application/json; charset=utf-8");
    }

    if (!res.body) return new Response(null, { status: res.status, headers: outHeaders });

    const [toClient, toRecorder] = res.body.tee();
    // 异步记录日志，不阻塞响应
    recordLog(c, style, before.stream, startedAtMs, toRecorder, logUUID, logBase, before.raw, ioLog).catch(console.error);
    return new Response(toClient, { status: res.status, headers: outHeaders });
  } catch (e) {
    return internalServerError(c, (e as Error).message);
  }
}

export async function chatProxyGemini(c: Context<AppEnv>, stream: boolean, model: string) {
  try {
    const raw = new Uint8Array(await c.req.arrayBuffer());
    const before = beforeGemini(raw, model, stream);

    const valid = validateAuthKey(c, before.model);
    if (!valid) return errorWithHttpStatus(c, 403, 403, "auth key has no permission to use this model");

    const providersWithMeta = await providersWithMetaByModelName(c, "gemini", before);
    const startedAtMs = Date.now();
    const { res, logUUID, ioLog, logBase } = await balanceChat(c, startedAtMs, "gemini", before, providersWithMeta);

    const headers = new Headers(res.headers);
    if (before.stream) {
      headers.set("Content-Type", "text/event-stream");
      headers.set("Cache-Control", "no-cache");
      headers.set("Connection", "keep-alive");
      headers.set("X-Accel-Buffering", "no");
    } else if (!headers.get("Content-Type")) {
      headers.set("Content-Type", "application/json; charset=utf-8");
    }

    if (!res.body) return c.body(null, res.status as 200, Object.fromEntries(headers.entries()));
    const [toClient, toRecorder] = res.body.tee();
    // 异步记录日志，不阻塞响应
    recordLog(c, "gemini", before.stream, startedAtMs, toRecorder, logUUID, logBase, before.raw, ioLog).catch(console.error);
    return new Response(toClient, { status: res.status, headers });
  } catch (e) {
    return internalServerError(c, (e as Error).message);
  }
}

export async function countTokensProxy(c: Context<AppEnv>) {
  const result = await c.env.db.query<{ value: string }>(
    "SELECT value FROM config WHERE key = $1 AND deleted_at IS NULL",
    ["anthropic_count_tokens"]
  );
  if (result.rows.length === 0) return notFoundLikeGo(c, "Anthropic count tokens config not found");
  const cfg = JSON.parse(result.rows[0].value) as { base_url: string; api_key: string; version: string };
  if (!cfg.base_url || !cfg.api_key || !cfg.version) return internalServerError(c, "Failed to parse Anthropic count tokens config");

  const url = `${String(cfg.base_url).replace(/\/$/, "")}/messages/count_tokens`;
  const res = await fetch(url, {
    method: "POST",
    headers: (() => {
      const h = new Headers(c.req.raw.headers);
      h.set("content-type", "application/json");
      h.set("x-api-key", cfg.api_key);
      h.set("anthropic-version", cfg.version);
      return h;
    })(),
    body: c.req.raw.body,
  });

  const headers = new Headers(res.headers);
  return c.body(res.body, res.status as 200, Object.fromEntries(headers.entries()));
}

function notFoundLikeGo(c: Context<AppEnv>, message: string) {
  return c.json({ code: 404, message }, 200);
}

function validateAuthKey(c: Context<AppEnv>, model: string) {
  const allowAll = c.get("allowAllModel");
  console.log("[validateAuthKey] model:", model, "allowAll:", allowAll, "allowModels:", c.get("allowModels"));
  if (allowAll) return true;
  const allowed = c.get("allowModels");
  return Array.isArray(allowed) && allowed.includes(model);
}

async function providersWithMetaByModelName(c: Context<AppEnv>, style: Style, before: ReturnType<typeof beforeOpenAI>) {
  const modelResult = await c.env.db.query<any>(
    "SELECT * FROM models WHERE name = $1 AND deleted_at IS NULL",
    [before.model]
  );
  const model = modelResult.rows[0];

  if (!model) {
    const now = new Date().toISOString();
    const base: ChatLogBase = {
      uuid: randomUUID(),
      name: before.model,
      provider_model: "",
      provider_name: "",
      status: "error",
      style,
      user_agent: c.req.header("User-Agent") ?? "",
      remote_ip: c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ?? "",
      auth_key_id: Number(c.get("authKeyId") ?? 0),
      chat_io: 0,
      error: "record not found",
      retry: 0,
      proxy_time_ms: 0,
      created_at: now,
      updated_at: now,
    };
    enqueueChatLogEvent(c.env, { type: "insert", base }).catch(console.error);
    throw new Error(`not found model ${before.model}`);
  }

  let where = "model_id = $1 AND deleted_at IS NULL AND status = 1";
  const args: unknown[] = [Number(model.id)];
  let paramIndex = 2;
  if (before.toolCall) where += " AND tool_call = 1";
  if (before.structuredOutput) where += " AND structured_output = 1";
  if (before.image) where += " AND image = 1";

  const mpsResult = await c.env.db.query<any>(
    `SELECT * FROM model_with_providers WHERE ${where}`,
    args
  );
  const mps = mpsResult.rows;
  if (!mps || mps.length === 0) throw new Error(`not provider for model ${before.model}`);

  const mpMap = new Map<number, any>(mps.map((mp: any) => [Number(mp.id), mp]));

  const providerIds = [...new Set(mps.map((mp: any) => Number(mp.provider_id)))];
  const placeholders = providerIds.map((_, i) => `$${i + 1}`).join(",");
  const providersResult = await c.env.db.query<any>(
    `SELECT * FROM providers WHERE id IN (${placeholders}) AND type = $${providerIds.length + 1} AND deleted_at IS NULL`,
    [...providerIds, style]
  );
  const providerMap = new Map<number, any>((providersResult.rows ?? []).map((p: any) => [Number(p.id), p]));

  const weightItems = new Map<number, number>();
  for (const mp of mps) {
    if (!providerMap.has(Number(mp.provider_id))) continue;
    weightItems.set(Number(mp.id), Number(mp.weight ?? 0));
  }
  if (weightItems.size === 0) {
    throw new Error(`no providers matched style=${style} for model=${before.model} (openai: /v1/chat/completions, anthropic: /v1/messages, gemini: /v1beta/models/*)`);
  }

  return {
    modelWithProviderMap: mpMap,
    providerMap,
    weightItems,
    maxRetry: Number(model.max_retry ?? 0),
    timeOut: Number(model.time_out ?? 0),
    ioLog: Number(model.io_log ?? 0) === 1,
    strategy: String(model.strategy ?? "lottery"),
    breaker: Number(model.breaker ?? 0) === 1,
  } satisfies ProvidersWithMeta;
}

async function balanceChat(c: Context<AppEnv>, startedAtMs: number, style: Style, before: any, providersWithMeta: ProvidersWithMeta) {
  const balancer = newBalancer(providersWithMeta.strategy, providersWithMeta.weightItems, providersWithMeta.breaker);
  const authKeyId = c.get("authKeyId") ?? 0;

  const totalRetries = Math.max(0, providersWithMeta.maxRetry);
  const timeOutSeconds = Math.max(0, providersWithMeta.timeOut);
  const responseHeaderTimeoutMs = before.stream ? Math.floor((timeOutSeconds * 1000) / 3) : timeOutSeconds * 1000;

  const timerEndMs = Date.now() + timeOutSeconds * 1000;
  let lastError = "";

  // 记录因 RPM 限制被跳过的供应商
  const rpmLimitedProviders = new Set<number>();

  for (let retry = 0; retry < totalRetries; retry++) {
    if (Date.now() > timerEndMs) throw new Error("retry time out");

    let id = 0;
    try {
      id = balancer.pop();
    } catch (e) {
      const msg = (e as Error).message || "no providers available";

      // 如果所有供应商都因 RPM 限制被跳过，返回特定错误
      if (rpmLimitedProviders.size > 0 && !lastError) {
        lastError = "所有供应商已达到 RPM 限制，请一分钟后再尝试";
        break;
      }

      // balancer 为空时，如果之前已有更具体的失败原因（例如配置解析失败/上游返回码），优先保留
      if (!lastError) {
        // 这里的报错多半是：没有任何"该 style 的可用渠道"匹配到该模型（或全被禁用/权重为 0）
        if (msg.includes("no provide items")) {
          lastError = `no providers available for style=${style} model=${String(before?.model ?? "")}; please check model_with_providers.status/weight and provider.type (openai: /v1/chat/completions, anthropic: /v1/messages, gemini: /v1beta/models/*)`;
        } else {
          lastError = msg;
        }
      }
      break;
    }
    const mp = providersWithMeta.modelWithProviderMap.get(id);
    if (!mp) {
      balancer.delete(id);
      continue;
    }
    const provider = providersWithMeta.providerMap.get(Number(mp.provider_id));
    if (!provider) {
      balancer.delete(id);
      continue;
    }

    // 检查供应商的 RPM 限制
    const providerId = Number(provider.id);
    const rpmLimit = Number(provider.rpm_limit ?? 0);

    if (rpmLimit > 0) {
      const canProceed = await checkRpmLimit(providerId, rpmLimit);
      if (!canProceed) {
        console.log(`[chat] Provider ${provider.name} (ID: ${providerId}) reached RPM limit (${rpmLimit}), trying next provider`);
        rpmLimitedProviders.add(providerId);
        balancer.reduce(id); // 降低权重，但不完全删除
        continue;
      }
    }

    const logBase = {
      uuid: randomUUID(),
      name: before.model,
      provider_model: String(mp.provider_model ?? ""),
      provider_name: String(provider.name ?? ""),
      status: "success",
      style,
      user_agent: c.req.header("User-Agent") ?? "",
      remote_ip: c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ?? "",
      auth_key_id: Number(authKeyId ?? 0),
      chat_io: providersWithMeta.ioLog ? 1 : 0,
      retry,
      proxy_time_ms: Math.max(0, Math.floor(Date.now() - startedAtMs)),
    };

    const withHeader = Number(mp.with_header ?? 0) === 1;
    const customHeaders = safeParseJsonObject(String(mp.customer_headers ?? "{}")) ?? {};
    const headers = buildHeaders(c.req.raw.headers, withHeader, customHeaders, Boolean(before.stream));
    headers.set("Content-Type", "application/json");

    let controller: AbortController | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      controller = new AbortController();
      timeout = setTimeout(() => controller!.abort("timeout"), responseHeaderTimeoutMs);

      const providerConfig = String(provider.config ?? "");
      applyProviderAuthHeaders(style, providerConfig, headers, Boolean(before.stream));
      const cfg = JSON.parse(providerConfig) as { base_url: string };
      const baseUrl = String(cfg.base_url ?? "").replace(/\/$/, "");

      const built = buildProviderRequest({
        style,
        headers,
        providerModel: String(mp.provider_model ?? ""),
        rawBody: before.raw,
        geminiStream: style === "gemini" ? Boolean(before.stream) : undefined,
      });

      const fullUrl = `${baseUrl}${built.path}`;
      console.log("[chat] Fetching:", fullUrl);
      console.log("[chat] Headers:", Object.fromEntries(headers.entries()));
      console.log("[chat] Body:", built.body.substring(0, 200));

      const startTime = Date.now();
      const res = await fetch(fullUrl, {
        method: "POST",
        headers: Object.fromEntries(headers.entries()),
        body: built.body,
        signal: controller.signal,
      });
      const durationMs = Date.now() - startTime;

      console.log("[chat] Response status:", res.status);

      if (res.status !== 200) {
        const bodyText = await res.text().catch(() => "");
        lastError = `upstream status: ${res.status}, provider: ${String(provider.name ?? "")}, model: ${String(mp.provider_model ?? "")}, body: ${bodyText}`;
        await saveRetryLog(c, { ...logBase, status: "error", error: lastError });

        // 记录失败的 Provider 请求指标和健康状态
        const providerName = String(provider.name ?? "unknown");
        const providerModel = String(mp.provider_model ?? "unknown");
        recordProviderRequest(providerName, providerModel, false, durationMs);
        recordProviderHealth(providerName, false, durationMs, lastError);
        recordError("provider_error", providerName, providerModel);

        if (res.status === 429) balancer.reduce(id);
        else balancer.delete(id);
        continue;
      }

      // 请求成功，记录 RPM 计数
      await recordRpmRequest(providerId);

      balancer.success(id);
      const baseLog = toChatLogBase(logBase);
      enqueueChatLogEvent(c.env, { type: "insert", base: baseLog }).catch(console.error);

      // 记录成功的 Provider 请求指标和健康状态
      const providerName = String(provider.name ?? "unknown");
      const providerModel = String(mp.provider_model ?? "unknown");
      recordProviderRequest(providerName, providerModel, true, durationMs);
      recordProviderHealth(providerName, true, durationMs);

      return { res, logUUID: baseLog.uuid, logBase: baseLog, ioLog: providersWithMeta.ioLog };
    } catch (e) {
      const err = e as Error;
      console.error("[chat] Fetch error:", err.message, err.cause ?? "");
      lastError = err.message;
      await saveRetryLog(c, { ...logBase, status: "error", error: lastError });

      // 记录异常的 Provider 请求
      const providerName = String(provider.name ?? "unknown");
      const providerModel = String(mp.provider_model ?? "unknown");
      recordProviderRequest(providerName, providerModel, false, 0);
      recordProviderHealth(providerName, false, 0, err.message);
      recordError("provider_exception", providerName, providerModel);

      balancer.delete(id);
      continue;
    } finally {
      if (timeout !== null) clearTimeout(timeout);
    }
  }

  // 如果所有供应商都因 RPM 限制被跳过
  if (rpmLimitedProviders.size > 0 && (!lastError || lastError.includes("no provide items"))) {
    throw new Error("所有供应商已达到 RPM 限制，请一分钟后再尝试");
  }

  throw new Error(lastError || "maximum retry attempts reached");
}

function toChatLogBase(log: any): ChatLogBase {
  const now = new Date().toISOString();
  return {
    uuid: String(log.uuid || randomUUID()),
    name: String(log.name ?? ""),
    provider_model: String(log.provider_model ?? ""),
    provider_name: String(log.provider_name ?? ""),
    status: String(log.status ?? ""),
    style: log.style as any,
    user_agent: String(log.user_agent ?? ""),
    remote_ip: String(log.remote_ip ?? ""),
    auth_key_id: Number(log.auth_key_id ?? 0),
    chat_io: Number(log.chat_io ?? 0),
    error: String(log.error ?? ""),
    retry: Number(log.retry ?? 0),
    proxy_time_ms: Number(log.proxy_time_ms ?? 0),
    created_at: now,
    updated_at: now,
  };
}

async function saveRetryLog(c: Context<AppEnv>, log: any) {
  // 失败日志也落库（与 Go 版一致）；优先写入 Redis 队列（未配置 Redis 则直接落 D1）
  const base = toChatLogBase(log);
  enqueueChatLogEvent(c.env, { type: "insert", base }).catch(console.error);
}

async function recordLog(
  c: Context<AppEnv>,
  style: Style,
  stream: boolean,
  startedAtMs: number,
  body: ReadableStream<Uint8Array>,
  logUUID: string,
  logBase: ChatLogBase,
  inputRaw: Uint8Array,
  ioLog: boolean,
) {
  try {
    const processed =
      style === "openai"
        ? await processOpenAI({ stream, startedAtMs, body })
        : style === "openai-res"
          ? await processOpenAIRes({ stream, startedAtMs, body })
          : style === "anthropic"
            ? await processAnthropic({ stream, startedAtMs, body })
            : style === "gemini"
              ? await processGemini({ stream, startedAtMs, body })
              : (() => {
                  throw new Error("unknown style");
                })();

    // 记录 token 使用情况到 metrics
    if (processed.log.usage.prompt_tokens > 0 || processed.log.usage.completion_tokens > 0) {
      recordTokenUsage(
        logBase.provider_name,
        logBase.provider_model,
        processed.log.usage.prompt_tokens,
        processed.log.usage.completion_tokens
      );
    }

    // 记录重试次数（如果有重试）
    if (logBase.retry > 0) {
      recordRetry(logBase.provider_name, logBase.provider_model, logBase.retry);
    }

    const now = new Date().toISOString();
    await enqueueChatLogEvent(c.env, {
      type: "finalize",
      base: { ...logBase, uuid: logUUID, updated_at: now },
      finalize: {
        uuid: logUUID,
        first_chunk_time_ms: processed.log.first_chunk_time_ms,
        chunk_time_ms: processed.log.chunk_time_ms,
        tps: processed.log.tps,
        size: processed.log.size,
        prompt_tokens: processed.log.usage.prompt_tokens,
        completion_tokens: processed.log.usage.completion_tokens,
        total_tokens: processed.log.usage.total_tokens,
        prompt_tokens_details: JSON.stringify(processed.log.usage.prompt_tokens_details),
        updated_at: now,
      },
      io: ioLog
        ? {
            input: new TextDecoder().decode(inputRaw),
            output_string: processed.output.ofString,
            output_string_array: JSON.stringify(processed.output.ofStringArray),
            created_at: logBase.created_at,
            updated_at: now,
          }
        : undefined,
    });
  } catch (e) {
    // 不影响主响应；日志落库失败可在后续排查
  }
}

function safeParseJsonObject(raw: string): Record<string, string> | null {
  try {
    const obj = JSON.parse(raw) as unknown;
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) out[k] = String(v);
    return out;
  } catch {
    return null;
  }
}
