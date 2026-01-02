import type { Context } from "hono";
import type { AppEnv } from "../types.js";
import { internalServerError, errorWithHttpStatus } from "../common/response.js";
import { buildHeaders } from "./headers.js";
import { applyProviderAuthHeaders } from "./providers.js";
import { newBalancer } from "./balancers.js";
import { StyleOpenAI } from "../consts.js";
import { recordProviderRequest, recordError } from "./metrics.js";
import { recordProviderHealth } from "./health.js";

interface EmbeddingRequest {
  input: string | string[];
  model: string;
  encoding_format?: "float" | "base64";
  dimensions?: number;
}

type ProvidersWithMeta = {
  modelWithProviderMap: Map<number, any>;
  weightItems: Map<number, number>;
  providerMap: Map<number, any>;
  maxRetry: number;
  timeOut: number;
  strategy: string;
  breaker: boolean;
};

export async function embeddingProxy(c: Context<AppEnv>) {
  try {
    // 解析请求体
    const body = await c.req.json<EmbeddingRequest>();
    const modelName = body.model;

    if (!modelName) {
      return errorWithHttpStatus(c, 400, 400, "model is required");
    }

    // 验证 auth key 权限
    const valid = validateAuthKey(c, modelName);
    if (!valid) {
      return errorWithHttpStatus(c, 403, 403, "auth key has no permission to use this model");
    }

    // 获取模型和提供商信息
    const providersWithMeta = await getEmbeddingProvidersForModel(c, modelName);

    // 负载均衡请求
    const res = await balanceEmbedding(c, body, providersWithMeta);

    // 透传响应
    const headers = new Headers(res.headers);
    headers.set("Content-Type", "application/json");

    return new Response(res.body, { status: res.status, headers });
  } catch (e) {
    console.error("[embedding] Error:", e);
    return internalServerError(c, (e as Error).message);
  }
}

function validateAuthKey(c: Context<AppEnv>, model: string) {
  const allowAll = c.get("allowAllModel");
  if (allowAll) return true;
  const allowed = c.get("allowModels");
  return Array.isArray(allowed) && allowed.includes(model);
}

async function getEmbeddingProvidersForModel(c: Context<AppEnv>, modelName: string): Promise<ProvidersWithMeta> {
  // 查询模型
  const modelResult = await c.env.db.query<any>(
    "SELECT * FROM models WHERE name = $1 AND deleted_at IS NULL",
    [modelName]
  );
  const model = modelResult.rows[0];

  if (!model) {
    throw new Error(`not found model ${modelName}`);
  }

  // 查询模型-提供商关联（只查启用的）
  const mpsResult = await c.env.db.query<any>(
    "SELECT * FROM model_with_providers WHERE model_id = $1 AND deleted_at IS NULL AND status = 1",
    [Number(model.id)]
  );
  const mps = mpsResult.rows;

  if (!mps || mps.length === 0) {
    throw new Error(`no provider for model ${modelName}`);
  }

  const mpMap = new Map<number, any>(mps.map((mp: any) => [Number(mp.id), mp]));

  // 查询提供商（只查 openai 类型，因为 embedding 接口是 OpenAI 兼容的）
  const providerIds = [...new Set(mps.map((mp: any) => Number(mp.provider_id)))];
  const placeholders = providerIds.map((_, i) => `$${i + 1}`).join(",");
  const providersResult = await c.env.db.query<any>(
    `SELECT * FROM providers WHERE id IN (${placeholders}) AND type = $${providerIds.length + 1} AND deleted_at IS NULL`,
    [...providerIds, StyleOpenAI]
  );
  const providerMap = new Map<number, any>((providersResult.rows ?? []).map((p: any) => [Number(p.id), p]));

  // 构建权重映射
  const weightItems = new Map<number, number>();
  for (const mp of mps) {
    if (!providerMap.has(Number(mp.provider_id))) continue;
    weightItems.set(Number(mp.id), Number(mp.weight ?? 0));
  }

  if (weightItems.size === 0) {
    throw new Error(`no openai-compatible providers for embedding model ${modelName}`);
  }

  return {
    modelWithProviderMap: mpMap,
    providerMap,
    weightItems,
    maxRetry: Number(model.max_retry ?? 3),
    timeOut: Number(model.time_out ?? 60),
    strategy: String(model.strategy ?? "lottery"),
    breaker: Number(model.breaker ?? 0) === 1,
  };
}

async function balanceEmbedding(
  c: Context<AppEnv>,
  body: EmbeddingRequest,
  providersWithMeta: ProvidersWithMeta
): Promise<Response> {
  const balancer = newBalancer(providersWithMeta.strategy, providersWithMeta.weightItems, providersWithMeta.breaker);

  const totalRetries = Math.max(1, providersWithMeta.maxRetry);
  const timeOutMs = providersWithMeta.timeOut * 1000;
  const timerEndMs = Date.now() + timeOutMs;
  let lastError = "";

  for (let retry = 0; retry < totalRetries; retry++) {
    if (Date.now() > timerEndMs) {
      throw new Error("retry time out");
    }

    let id = 0;
    try {
      id = balancer.pop();
    } catch (e) {
      if (!lastError) {
        lastError = (e as Error).message || "no providers available";
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

    let controller: AbortController | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    try {
      controller = new AbortController();
      timeout = setTimeout(() => controller!.abort("timeout"), timeOutMs);

      const providerConfig = String(provider.config ?? "");
      const cfg = JSON.parse(providerConfig) as { base_url: string; api_key: string };
      const baseUrl = String(cfg.base_url ?? "").replace(/\/$/, "");

      // 构建请求体，使用提供商模型名
      const requestBody = {
        ...body,
        model: String(mp.provider_model ?? body.model),
        encoding_format: body.encoding_format || "float",
      };

      const headers = new Headers();
      headers.set("Content-Type", "application/json");
      headers.set("Authorization", `Bearer ${cfg.api_key}`);

      const fullUrl = `${baseUrl}/embeddings`;
      console.log("[embedding] Fetching:", fullUrl);
      console.log("[embedding] Model mapping:", body.model, "->", requestBody.model);

      const startTime = Date.now();
      const res = await fetch(fullUrl, {
        method: "POST",
        headers: Object.fromEntries(headers.entries()),
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      const durationMs = Date.now() - startTime;

      console.log("[embedding] Response status:", res.status);

      const providerName = String(provider.name ?? "unknown");
      const providerModel = String(mp.provider_model ?? "unknown");

      if (res.status !== 200) {
        const bodyText = await res.text().catch(() => "");
        lastError = `upstream status: ${res.status}, provider: ${providerName}, model: ${providerModel}, body: ${bodyText}`;

        // 记录失败的 Provider 请求指标和健康状态
        recordProviderRequest(providerName, providerModel, false, durationMs);
        recordProviderHealth(providerName, false, durationMs, lastError);
        recordError("provider_error", providerName, providerModel);

        if (res.status === 429) {
          balancer.reduce(id);
        } else {
          balancer.delete(id);
        }
        continue;
      }

      balancer.success(id);

      // 记录成功的 Provider 请求指标和健康状态
      recordProviderRequest(providerName, providerModel, true, durationMs);
      recordProviderHealth(providerName, true, durationMs);

      return res;
    } catch (e) {
      const err = e as Error;
      console.error("[embedding] Fetch error:", err.message);
      lastError = err.message;

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

  throw new Error(lastError || "maximum retry attempts reached");
}
