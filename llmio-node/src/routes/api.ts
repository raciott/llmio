import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { badRequest, internalServerError, notFound, success, successWithMessage, errorWithHttpStatus } from "../common/response.js";
import { limitOffset, newPaginationResponse, parsePagination } from "../common/pagination.js";
import { generateAuthKey } from "../common/crypto.js";
import { Version } from "../consts.js";
import { fetchProviderModels } from "../services/providers.js";
import type { AuthKeyRow } from "../db/repo.js";
import { bumpNamespaceVersion, cacheGetJson, cacheSetJson } from "../services/cache.js";

export const apiRoutes = new Hono<AppEnv>();

function safeParseJsonObject(raw: unknown): Record<string, string> | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const obj = JSON.parse(raw) as unknown;
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return null;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[String(k)] = typeof v === "string" ? v : String(v ?? "");
    }
    return out;
  } catch {
    return null;
  }
}

function toProviderDto(row: any) {
  return {
    ID: Number(row.id),
    Name: String(row.name ?? ""),
    Type: String(row.type ?? ""),
    Config: String(row.config ?? ""),
    Console: String(row.console ?? ""),
    RpmLimit: Number(row.rpm_limit ?? 0),
  };
}

function toModelDto(row: any) {
  return {
    ID: Number(row.id),
    Name: String(row.name ?? ""),
    Remark: String(row.remark ?? ""),
    MaxRetry: Number(row.max_retry ?? 0),
    TimeOut: Number(row.time_out ?? 0),
    IOLog: Number(row.io_log ?? 0) === 1,
    Strategy: String(row.strategy ?? "lottery"),
    Breaker: row.breaker === null || row.breaker === undefined ? null : Number(row.breaker ?? 0) === 1,
  };
}

function toModelWithProviderDto(row: any) {
  return {
    ID: Number(row.id),
    ModelID: Number(row.model_id),
    ProviderModel: String(row.provider_model ?? ""),
    ProviderID: Number(row.provider_id),
    ToolCall: Number(row.tool_call ?? 0) === 1,
    StructuredOutput: Number(row.structured_output ?? 0) === 1,
    Image: Number(row.image ?? 0) === 1,
    WithHeader: Number(row.with_header ?? 0) === 1,
    CustomerHeaders: safeParseJsonObject(row.customer_headers) ?? {},
    Status: row.status === null || row.status === undefined ? null : Number(row.status ?? 0) === 1,
    Weight: Number(row.weight ?? 1) || 1,
  };
}

function safeParseStringArray(raw: unknown): string[] | null {
  if (raw === null || raw === undefined) return null;
  if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean);
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => String(x).trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function toAuthKeyDto(row: any) {
  return {
    ID: Number(row.id),
    CreatedAt: String(row.created_at ?? ""),
    UpdatedAt: String(row.updated_at ?? ""),
    DeletedAt: row.deleted_at === null || row.deleted_at === undefined ? null : String(row.deleted_at),
    Name: String(row.name ?? ""),
    Key: String(row.key ?? ""),
    Status: Number(row.status ?? 0) === 1,
    AllowAll: Number(row.allow_all ?? 0) === 1,
    Models: safeParseStringArray(row.models),
    ExpiresAt: row.expires_at === null || row.expires_at === undefined ? null : String(row.expires_at),
    UsageCount: Number(row.usage_count ?? 0),
    LastUsedAt: row.last_used_at === null || row.last_used_at === undefined ? null : String(row.last_used_at),
  };
}

// 指标接口
apiRoutes.get("/metrics/use/:days", async (c) => {
  const days = Number.parseInt(c.req.param("days") ?? "", 10);
  if (!Number.isFinite(days)) return badRequest(c, "Invalid days parameter");
  try {
    const now = new Date();
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
    const cutoff = new Date(startOfToday.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

    const reqsResult = await c.env.db.query<{ cnt: string }>(
      "SELECT COUNT(*) AS cnt FROM chat_logs WHERE created_at >= $1",
      [cutoff]
    );
    const tokensResult = await c.env.db.query<{ tokens: string }>(
      "SELECT COALESCE(SUM(total_tokens), 0) AS tokens FROM chat_logs WHERE created_at >= $1",
      [cutoff]
    );

    return success(c, {
      reqs: Number(reqsResult.rows[0]?.cnt ?? 0),
      tokens: Number(tokensResult.rows[0]?.tokens ?? 0)
    });
  } catch (e) {
    return internalServerError(c, (e as Error).message);
  }
});

apiRoutes.get("/metrics/counts", async (c) => {
  try {
    const result = await c.env.db.query<{ model: string; calls: string }>(
      `SELECT name AS model, COUNT(*) AS calls
       FROM chat_logs
       GROUP BY name
       ORDER BY calls DESC`
    );
    const topN = 5;
    const rows = result.rows ?? [];
    if (rows.length <= topN) return success(c, rows.map(r => ({ model: r.model, calls: Number(r.calls) })));
    const othersCalls = rows.slice(topN).reduce((acc, r) => acc + Number(r.calls ?? 0), 0);
    return success(c, [...rows.slice(0, topN).map(r => ({ model: r.model, calls: Number(r.calls) })), { model: "others", calls: othersCalls }]);
  } catch (e) {
    return internalServerError(c, (e as Error).message);
  }
});

apiRoutes.get("/metrics/projects", async (c) => {
  try {
    const cached = await cacheGetJson<any[]>(c.env, "metrics", "projects");
    if (cached) return success(c, cached);

    const result = await c.env.db.query<{ auth_key_id: number; calls: string }>(
      `SELECT auth_key_id, COUNT(*) AS calls
       FROM chat_logs
       GROUP BY auth_key_id
       ORDER BY calls DESC`
    );

    const rows = result.rows ?? [];
    const ids = rows.map((r) => Number(r.auth_key_id ?? 0)).filter((id) => id !== 0);
    let keyMap = new Map<number, string>();
    if (ids.length > 0) {
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
      const keysResult = await c.env.db.query<{ id: number; name: string }>(
        `SELECT id, name FROM auth_keys WHERE id IN (${placeholders})`,
        ids
      );
      keyMap = new Map((keysResult.rows ?? []).map((k) => [Number(k.id), String(k.name ?? "").trim()]));
    }

    const projectCalls = new Map<string, number>();
    for (const r of rows) {
      const id = Number(r.auth_key_id ?? 0);
      const calls = Number(r.calls ?? 0);
      const project = id === 0 ? "admin" : keyMap.get(id) || "-";
      projectCalls.set(project, (projectCalls.get(project) ?? 0) + calls);
    }

    const sorted = [...projectCalls.entries()]
      .map(([project, calls]) => ({ project, calls }))
      .sort((a, b) => b.calls - a.calls);
    const topN = 5;
    if (sorted.length <= topN) {
      await cacheSetJson(c.env, "metrics", "projects", sorted);
      return success(c, sorted);
    }
    const othersCalls = sorted.slice(topN).reduce((acc, r) => acc + r.calls, 0);
    const payload = [...sorted.slice(0, topN), { project: "others", calls: othersCalls }];
    await cacheSetJson(c.env, "metrics", "projects", payload);
    return success(c, payload);
  } catch (e) {
    return internalServerError(c, (e as Error).message);
  }
});

// Provider 模板
apiRoutes.get("/providers/template", (c) =>
  success(c, [
    { type: "openai", template: `{\n  "base_url": "https://api.openai.com/v1",\n  "api_key": "YOUR_API_KEY"\n}` },
    { type: "gemini", template: `{\n  "base_url": "https://generativelanguage.googleapis.com/v1beta",\n  "api_key": "YOUR_GEMINI_API_KEY"\n}` },
    { type: "openai-res", template: `{\n  "base_url": "https://api.openai.com/v1",\n  "api_key": "YOUR_API_KEY"\n}` },
    { type: "anthropic", template: `{\n  "base_url": "https://api.anthropic.com/v1",\n  "api_key": "YOUR_API_KEY",\n  "version": "2023-06-01"\n}` },
  ])
);

// Providers CRUD
apiRoutes.get("/providers", async (c) => {
  const name = c.req.query("name") ?? "";
  const type = c.req.query("type") ?? "";
  try {
    if (!c.env.db) {
      console.error("[/api/providers] c.env.db is undefined");
      return internalServerError(c, "Database not initialized");
    }
    const where: string[] = ["deleted_at IS NULL"];
    const args: unknown[] = [];
    let paramIndex = 1;

    if (name) {
      where.push(`name LIKE $${paramIndex++}`);
      args.push(`%${name}%`);
    }
    if (type) {
      where.push(`type = $${paramIndex++}`);
      args.push(type);
    }

    const result = await c.env.db.query(
      `SELECT id, name, type, config, console, rpm_limit FROM providers WHERE ${where.join(" AND ")} ORDER BY id DESC`,
      args
    );
    return success(c, (result.rows ?? []).map(toProviderDto));
  } catch (e) {
    console.error("[/api/providers] Error:", e);
    return internalServerError(c, (e as Error).message);
  }
});

apiRoutes.get("/providers/models/:id", async (c) => {
  const id = Number.parseInt(c.req.param("id") ?? "", 10);
  if (!Number.isFinite(id)) return badRequest(c, "Invalid ID format");
  try {
    const result = await c.env.db.query<{ id: number; type: string; config: string }>(
      "SELECT id, type, config FROM providers WHERE id = $1 AND deleted_at IS NULL",
      [id]
    );
    if (result.rows.length === 0) return notFound(c, "Provider not found");
    const provider = result.rows[0];
    const models = await fetchProviderModels(provider.type as any, provider.config);
    return success(c, models);
  } catch (e) {
    return internalServerError(c, `Failed to get models: ${(e as Error).message}`);
  }
});

apiRoutes.post("/providers", async (c) => {
  try {
    const body = (await c.req.json()) as { name?: string; type?: string; config?: string; console?: string; rpm_limit?: number };
    if (!body?.name || !body?.type || body.config === undefined) return badRequest(c, "Invalid request body");

    const existing = await c.env.db.query<{ id: number }>(
      "SELECT id FROM providers WHERE name = $1 AND deleted_at IS NULL",
      [body.name]
    );
    if (existing.rows.length > 0) return badRequest(c, "Provider already exists");

    const now = new Date().toISOString();
    const rpmLimit = Number(body.rpm_limit ?? 0);
    const result = await c.env.db.query<{ id: number }>(
      "INSERT INTO providers (name, type, config, console, rpm_limit, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
      [body.name, body.type, body.config, body.console ?? "", rpmLimit, now, now]
    );
    const id = result.rows[0]?.id ?? 0;
    await bumpNamespaceVersion(c.env, "providers");
    return success(c, toProviderDto({ id, name: body.name, type: body.type, config: body.config, console: body.console ?? "", rpm_limit: rpmLimit }));
  } catch (e) {
    return internalServerError(c, `Failed to create provider: ${(e as Error).message}`);
  }
});

apiRoutes.put("/providers/:id", async (c) => {
  const id = Number.parseInt(c.req.param("id") ?? "", 10);
  if (!Number.isFinite(id)) return badRequest(c, "Invalid ID format");
  try {
    const body = (await c.req.json()) as { name?: string; type?: string; config?: string; console?: string; rpm_limit?: number };
    if (!body?.name || !body?.type || body.config === undefined) return badRequest(c, "Invalid request body");

    const existing = await c.env.db.query<{ id: number }>(
      "SELECT id FROM providers WHERE id = $1 AND deleted_at IS NULL",
      [id]
    );
    if (existing.rows.length === 0) return notFound(c, "Provider not found");

    const now = new Date().toISOString();
    const rpmLimit = Number(body.rpm_limit ?? 0);
    await c.env.db.query(
      "UPDATE providers SET name = $1, type = $2, config = $3, console = $4, rpm_limit = $5, updated_at = $6 WHERE id = $7",
      [body.name, body.type, body.config, body.console ?? "", rpmLimit, now, id]
    );
    await bumpNamespaceVersion(c.env, "providers");
    return success(c, toProviderDto({ id, name: body.name, type: body.type, config: body.config, console: body.console ?? "", rpm_limit: rpmLimit }));
  } catch (e) {
    return internalServerError(c, `Failed to update provider: ${(e as Error).message}`);
  }
});

apiRoutes.delete("/providers/:id", async (c) => {
  const id = Number.parseInt(c.req.param("id") ?? "", 10);
  if (!Number.isFinite(id)) return badRequest(c, "Invalid ID format");
  try {
    const now = new Date().toISOString();
    const result = await c.env.db.query(
      "UPDATE providers SET deleted_at = $1, updated_at = $2 WHERE id = $3 AND deleted_at IS NULL",
      [now, now, id]
    );
    await c.env.db.query(
      "UPDATE model_with_providers SET deleted_at = $1, updated_at = $2 WHERE provider_id = $3 AND deleted_at IS NULL",
      [now, now, id]
    );
    await bumpNamespaceVersion(c.env, "providers");
    await bumpNamespaceVersion(c.env, "model_with_providers");
    return success(c, null);
  } catch (e) {
    return internalServerError(c, `Failed to delete provider: ${(e as Error).message}`);
  }
});

// Models CRUD
apiRoutes.get("/models", async (c) => {
  const params = parsePagination(c);
  if (params instanceof Error) return badRequest(c, params.message);
  const search = (c.req.query("search") ?? "").trim();
  const strategy = (c.req.query("strategy") ?? "").trim();
  const ioLog = (c.req.query("io_log") ?? "").trim();

  try {
    const where: string[] = ["deleted_at IS NULL"];
    const args: unknown[] = [];
    let paramIndex = 1;

    if (search) {
      where.push(`name LIKE $${paramIndex++}`);
      args.push(`%${search}%`);
    }
    if (strategy) {
      where.push(`strategy = $${paramIndex++}`);
      args.push(strategy);
    }
    if (ioLog) {
      if (ioLog !== "true" && ioLog !== "false") return badRequest(c, "invalid io_log filter");
      where.push(`io_log = $${paramIndex++}`);
      args.push(ioLog === "true" ? 1 : 0);
    }

    const totalResult = await c.env.db.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM models WHERE ${where.join(" AND ")}`,
      args
    );
    const total = Number(totalResult.rows[0]?.cnt ?? 0);

    const { limit, offset } = limitOffset(params);
    const result = await c.env.db.query(
      `SELECT id, created_at, name, remark, max_retry, time_out, io_log, strategy, breaker
       FROM models
       WHERE ${where.join(" AND ")}
       ORDER BY id DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      [...args, limit, offset]
    );
    return success(c, newPaginationResponse((result.rows ?? []).map(toModelDto), total, params));
  } catch (e) {
    return internalServerError(c, `Failed to query models: ${(e as Error).message}`);
  }
});

apiRoutes.get("/models/select", async (c) => {
  try {
    const result = await c.env.db.query(
      "SELECT id, name, remark, max_retry, time_out, io_log, strategy, breaker, created_at FROM models WHERE deleted_at IS NULL ORDER BY id DESC"
    );
    return success(c, (result.rows ?? []).map(toModelDto));
  } catch (e) {
    return internalServerError(c, `Failed to get models: ${(e as Error).message}`);
  }
});

apiRoutes.post("/models", async (c) => {
  try {
    const body = (await c.req.json()) as {
      name?: string;
      remark?: string;
      max_retry?: number;
      time_out?: number;
      io_log?: boolean;
      strategy?: string;
      breaker?: boolean;
    };
    if (!body?.name) return badRequest(c, "Invalid request body");

    const existing = await c.env.db.query<{ id: number }>(
      "SELECT id FROM models WHERE name = $1 AND deleted_at IS NULL",
      [body.name]
    );
    if (existing.rows.length > 0) return badRequest(c, `Model: ${body.name} already exists`);

    const now = new Date().toISOString();
    const strategy = body.strategy || "lottery";
    const result = await c.env.db.query<{ id: number }>(
      "INSERT INTO models (name, remark, max_retry, time_out, io_log, strategy, breaker, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id",
      [body.name, body.remark ?? "", Number(body.max_retry ?? 0), Number(body.time_out ?? 0), body.io_log ? 1 : 0, strategy, body.breaker ? 1 : 0, now, now]
    );
    const id = result.rows[0]?.id ?? 0;
    await bumpNamespaceVersion(c.env, "models");
    return success(c, toModelDto({
      id,
      name: body.name,
      remark: body.remark ?? "",
      max_retry: Number(body.max_retry ?? 0),
      time_out: Number(body.time_out ?? 0),
      io_log: body.io_log ? 1 : 0,
      strategy,
      breaker: body.breaker ? 1 : 0,
    }));
  } catch (e) {
    return internalServerError(c, `Failed to create model: ${(e as Error).message}`);
  }
});

apiRoutes.put("/models/:id", async (c) => {
  const id = Number.parseInt(c.req.param("id") ?? "", 10);
  if (!Number.isFinite(id)) return badRequest(c, "Invalid ID format");
  try {
    const body = (await c.req.json()) as {
      name?: string;
      remark?: string;
      max_retry?: number;
      time_out?: number;
      io_log?: boolean;
      strategy?: string;
      breaker?: boolean;
    };
    if (!body?.name) return badRequest(c, "Invalid request body");

    const existing = await c.env.db.query<{ id: number }>(
      "SELECT id FROM models WHERE id = $1 AND deleted_at IS NULL",
      [id]
    );
    if (existing.rows.length === 0) return notFound(c, "Model not found");

    const now = new Date().toISOString();
    const strategy = body.strategy || "lottery";
    await c.env.db.query(
      "UPDATE models SET name = $1, remark = $2, max_retry = $3, time_out = $4, io_log = $5, strategy = $6, breaker = $7, updated_at = $8 WHERE id = $9",
      [body.name, body.remark ?? "", Number(body.max_retry ?? 0), Number(body.time_out ?? 0), body.io_log ? 1 : 0, strategy, body.breaker ? 1 : 0, now, id]
    );
    await bumpNamespaceVersion(c.env, "models");
    return success(c, toModelDto({
      id,
      name: body.name,
      remark: body.remark ?? "",
      max_retry: Number(body.max_retry ?? 0),
      time_out: Number(body.time_out ?? 0),
      io_log: body.io_log ? 1 : 0,
      strategy,
      breaker: body.breaker ? 1 : 0,
    }));
  } catch (e) {
    return internalServerError(c, `Failed to update model: ${(e as Error).message}`);
  }
});

apiRoutes.delete("/models/:id", async (c) => {
  const id = Number.parseInt(c.req.param("id") ?? "", 10);
  if (!Number.isFinite(id)) return badRequest(c, "Invalid ID format");
  try {
    const now = new Date().toISOString();
    await c.env.db.query(
      "UPDATE models SET deleted_at = $1, updated_at = $2 WHERE id = $3 AND deleted_at IS NULL",
      [now, now, id]
    );
    await bumpNamespaceVersion(c.env, "models");
    await bumpNamespaceVersion(c.env, "model_with_providers");
    return success(c, null);
  } catch (e) {
    return internalServerError(c, `Failed to delete model: ${(e as Error).message}`);
  }
});

// Model-Providers CRUD
apiRoutes.get("/model-providers", async (c) => {
  const modelIdStr = c.req.query("model_id");
  if (!modelIdStr) return badRequest(c, "model_id query parameter is required");
  const modelId = Number.parseInt(modelIdStr, 10);
  if (!Number.isFinite(modelId)) return badRequest(c, "Invalid model_id format");
  try {
    const result = await c.env.db.query(
      "SELECT * FROM model_with_providers WHERE model_id = $1 AND deleted_at IS NULL ORDER BY id DESC",
      [modelId]
    );
    return success(c, (result.rows ?? []).map(toModelWithProviderDto));
  } catch (e) {
    return internalServerError(c, (e as Error).message);
  }
});

apiRoutes.post("/model-providers", async (c) => {
  try {
    const body = (await c.req.json()) as {
      model_id?: number;
      provider_name?: string;
      provider_id?: number;
      tool_call?: boolean;
      structured_output?: boolean;
      image?: boolean;
      with_header?: boolean;
      customer_headers?: Record<string, string>;
      weight?: number;
    };
    if (!body?.model_id || !body?.provider_id || !body.provider_name) return badRequest(c, "Invalid request body");

    const now = new Date().toISOString();
    const result = await c.env.db.query<{ id: number }>(
      `INSERT INTO model_with_providers
       (model_id, provider_id, provider_model, tool_call, structured_output, image, with_header, status, customer_headers, weight, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, $9, $10, $11) RETURNING id`,
      [
        body.model_id,
        body.provider_id,
        body.provider_name,
        body.tool_call ? 1 : 0,
        body.structured_output ? 1 : 0,
        body.image ? 1 : 0,
        body.with_header ? 1 : 0,
        JSON.stringify(body.customer_headers ?? {}),
        Number(body.weight ?? 1),
        now,
        now,
      ]
    );
    await bumpNamespaceVersion(c.env, "model_with_providers");
    const id = result.rows[0]?.id ?? 0;
    return success(c, toModelWithProviderDto({
      id,
      model_id: body.model_id,
      provider_id: body.provider_id,
      provider_model: body.provider_name,
      tool_call: body.tool_call ? 1 : 0,
      structured_output: body.structured_output ? 1 : 0,
      image: body.image ? 1 : 0,
      with_header: body.with_header ? 1 : 0,
      status: 1,
      customer_headers: JSON.stringify(body.customer_headers ?? {}),
      weight: Number(body.weight ?? 1),
    }));
  } catch (e) {
    return internalServerError(c, `Failed to create model-provider association: ${(e as Error).message}`);
  }
});

apiRoutes.put("/model-providers/:id", async (c) => {
  const id = Number.parseInt(c.req.param("id") ?? "", 10);
  if (!Number.isFinite(id)) return badRequest(c, "Invalid ID format");
  try {
    const body = (await c.req.json()) as {
      model_id?: number;
      provider_name?: string;
      provider_id?: number;
      tool_call?: boolean;
      structured_output?: boolean;
      image?: boolean;
      with_header?: boolean;
      customer_headers?: Record<string, string>;
      weight?: number;
    };
    if (!body?.model_id || !body?.provider_id || !body.provider_name) return badRequest(c, "Invalid request body");

    const existing = await c.env.db.query<{ id: number }>(
      "SELECT id FROM model_with_providers WHERE id = $1 AND deleted_at IS NULL",
      [id]
    );
    if (existing.rows.length === 0) return notFound(c, "Model-provider association not found");

    const now = new Date().toISOString();
    await c.env.db.query(
      `UPDATE model_with_providers
       SET model_id = $1, provider_id = $2, provider_model = $3, tool_call = $4, structured_output = $5, image = $6, with_header = $7, customer_headers = $8, weight = $9, updated_at = $10
       WHERE id = $11`,
      [
        body.model_id,
        body.provider_id,
        body.provider_name,
        body.tool_call ? 1 : 0,
        body.structured_output ? 1 : 0,
        body.image ? 1 : 0,
        body.with_header ? 1 : 0,
        JSON.stringify(body.customer_headers ?? {}),
        Number(body.weight ?? 1),
        now,
        id,
      ]
    );
    await bumpNamespaceVersion(c.env, "model_with_providers");
    return success(c, toModelWithProviderDto({
      id,
      model_id: body.model_id,
      provider_id: body.provider_id,
      provider_model: body.provider_name,
      tool_call: body.tool_call ? 1 : 0,
      structured_output: body.structured_output ? 1 : 0,
      image: body.image ? 1 : 0,
      with_header: body.with_header ? 1 : 0,
      status: 1,
      customer_headers: JSON.stringify(body.customer_headers ?? {}),
      weight: Number(body.weight ?? 1),
    }));
  } catch (e) {
    return internalServerError(c, `Failed to update model-provider association: ${(e as Error).message}`);
  }
});

apiRoutes.patch("/model-providers/:id/status", async (c) => {
  const id = Number.parseInt(c.req.param("id") ?? "", 10);
  if (!Number.isFinite(id)) return badRequest(c, "Invalid ID format");
  try {
    const body = (await c.req.json()) as { status?: boolean };
    if (typeof body?.status !== "boolean") return badRequest(c, "Invalid request body");

    const existing = await c.env.db.query<{ id: number }>(
      "SELECT id FROM model_with_providers WHERE id = $1 AND deleted_at IS NULL",
      [id]
    );
    if (existing.rows.length === 0) return notFound(c, "Model-provider association not found");

    const now = new Date().toISOString();
    await c.env.db.query(
      "UPDATE model_with_providers SET status = $1, updated_at = $2 WHERE id = $3",
      [body.status ? 1 : 0, now, id]
    );
    const result = await c.env.db.query(
      "SELECT * FROM model_with_providers WHERE id = $1 AND deleted_at IS NULL",
      [id]
    );
    await bumpNamespaceVersion(c.env, "model_with_providers");
    return success(c, result.rows[0] ? toModelWithProviderDto(result.rows[0]) : null);
  } catch (e) {
    return internalServerError(c, `Failed to update status: ${(e as Error).message}`);
  }
});

apiRoutes.delete("/model-providers/:id", async (c) => {
  const id = Number.parseInt(c.req.param("id") ?? "", 10);
  if (!Number.isFinite(id)) return badRequest(c, "Invalid ID format");
  try {
    const now = new Date().toISOString();
    await c.env.db.query(
      "UPDATE model_with_providers SET deleted_at = $1, updated_at = $2 WHERE id = $3 AND deleted_at IS NULL",
      [now, now, id]
    );
    await bumpNamespaceVersion(c.env, "model_with_providers");
    return success(c, null);
  } catch (e) {
    return internalServerError(c, `Failed to delete model-provider association: ${(e as Error).message}`);
  }
});

apiRoutes.get("/model-providers/status", async (c) => {
  const providerIdStr = c.req.query("provider_id");
  const modelName = c.req.query("model_name") ?? "";
  const providerModel = c.req.query("provider_model") ?? "";
  if (!providerIdStr || !modelName || !providerModel) return badRequest(c, "provider_id, model_name and provider_model query parameters are required");
  const providerId = Number.parseInt(providerIdStr, 10);
  if (!Number.isFinite(providerId)) return badRequest(c, "Invalid provider_id format");
  try {
    const providerResult = await c.env.db.query<{ id: number; name: string }>(
      "SELECT id, name FROM providers WHERE id = $1 AND deleted_at IS NULL",
      [providerId]
    );
    if (providerResult.rows.length === 0) return notFound(c, "Provider not found");
    const provider = providerResult.rows[0];

    const result = await c.env.db.query<{ status: string }>(
      `SELECT status FROM chat_logs
       WHERE provider_name = $1 AND provider_model = $2 AND name = $3 AND deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT 10`,
      [provider.name, providerModel, modelName]
    );
    const status = (result.rows ?? []).map((r) => r.status === "success").reverse();
    return success(c, status);
  } catch (e) {
    return internalServerError(c, `Failed to retrieve chat log: ${(e as Error).message}`);
  }
});

// Auth Keys CRUD
apiRoutes.get("/auth-keys", async (c) => {
  const params = parsePagination(c);
  if (params instanceof Error) return badRequest(c, params.message);
  const search = (c.req.query("search") ?? "").trim();

  try {
    const where: string[] = ["deleted_at IS NULL"];
    const args: unknown[] = [];
    let paramIndex = 1;

    if (search) {
      where.push(`(name LIKE $${paramIndex} OR key LIKE $${paramIndex + 1})`);
      args.push(`%${search}%`, `%${search}%`);
      paramIndex += 2;
    }

    const totalResult = await c.env.db.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM auth_keys WHERE ${where.join(" AND ")}`,
      args
    );
    const total = Number(totalResult.rows[0]?.cnt ?? 0);

    const { limit, offset } = limitOffset(params);
    const result = await c.env.db.query<AuthKeyRow>(
      `SELECT * FROM auth_keys WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      [...args, limit, offset]
    );
    return success(c, newPaginationResponse((result.rows ?? []).map(toAuthKeyDto), total, params));
  } catch (e) {
    return internalServerError(c, `Failed to query auth keys: ${(e as Error).message}`);
  }
});

apiRoutes.post("/auth-keys", async (c) => {
  try {
    const body = (await c.req.json()) as { name?: string; status?: boolean; allow_all?: boolean; models?: string[]; expires_at?: string | null };
    if (!body?.name) return badRequest(c, "Invalid request body");
    if (body.allow_all === false && (!body.models || body.models.length === 0)) return badRequest(c, "请至少选择一个允许的模型或启用允许全部模型");

    let expiresAt: string | null = null;
    if (body.expires_at) {
      const ms = Date.parse(body.expires_at);
      if (!Number.isFinite(ms)) return badRequest(c, "Invalid expires_at format, must be RFC3339");
      expiresAt = new Date(ms).toISOString();
    }

    const now = new Date().toISOString();
    const key = generateAuthKey();
    const models = sanitizeModels(body.models ?? []);
    const result = await c.env.db.query<{ id: number }>(
      "INSERT INTO auth_keys (name, key, status, allow_all, models, expires_at, usage_count, last_used_at, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, 0, NULL, $7, $8) RETURNING id",
      [body.name, key, body.status === false ? 0 : 1, body.allow_all ? 1 : 0, JSON.stringify(models), expiresAt, now, now]
    );
    await bumpNamespaceVersion(c.env, "auth_keys");
    const createdRow = {
      id: result.rows[0]?.id ?? 0,
      name: body.name,
      key,
      status: body.status === false ? 0 : 1,
      allow_all: body.allow_all ? 1 : 0,
      models: JSON.stringify(models),
      expires_at: expiresAt,
      usage_count: 0,
      last_used_at: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
    return success(c, toAuthKeyDto(createdRow));
  } catch (e) {
    return internalServerError(c, `Failed to create auth key: ${(e as Error).message}`);
  }
});

apiRoutes.delete("/auth-keys/:id", async (c) => {
  const id = Number.parseInt(c.req.param("id") ?? "", 10);
  if (!Number.isFinite(id)) return badRequest(c, "Invalid ID");
  try {
    const now = new Date().toISOString();
    await c.env.db.query(
      "UPDATE auth_keys SET deleted_at = $1, updated_at = $2 WHERE id = $3 AND deleted_at IS NULL",
      [now, now, id]
    );
    await bumpNamespaceVersion(c.env, "auth_keys");
    return successWithMessage(c, "Deleted", { id });
  } catch (e) {
    return internalServerError(c, `Failed to delete auth key: ${(e as Error).message}`);
  }
});

function toChatLogDto(row: any) {
  return {
    ID: row.id ?? row.ID,
    CreatedAt: row.created_at ?? row.CreatedAt ?? "",
    Name: row.name ?? row.Name ?? "",
    ProviderModel: row.provider_model ?? row.ProviderModel ?? "",
    ProviderName: row.provider_name ?? row.ProviderName ?? "",
    Status: row.status ?? row.Status ?? "",
    Style: row.style ?? row.Style ?? "",
    UserAgent: row.user_agent ?? row.UserAgent ?? "",
    RemoteIP: row.remote_ip ?? row.RemoteIP ?? "",
    Error: row.error ?? row.Error ?? "",
    Retry: Number(row.retry ?? row.Retry ?? 0),
    ProxyTime: Number(row.proxy_time_ms ?? row.ProxyTime ?? 0),
    FirstChunkTime: Number(row.first_chunk_time_ms ?? row.FirstChunkTime ?? 0),
    ChunkTime: Number(row.chunk_time_ms ?? row.ChunkTime ?? 0),
    Tps: Number(row.tps ?? row.Tps ?? 0),
    ChatIO: Number(row.chat_io ?? row.ChatIO ?? 0) === 1,
    Size: Number(row.size ?? row.Size ?? 0),
    prompt_tokens: Number(row.prompt_tokens ?? 0),
    completion_tokens: Number(row.completion_tokens ?? 0),
    total_tokens: Number(row.total_tokens ?? 0),
    prompt_tokens_details: safeParsePromptTokensDetails(row.prompt_tokens_details),
    key_name: row.key_name ?? "",
  };
}

function safeParsePromptTokensDetails(raw: unknown): { cached_tokens: number } {
  if (!raw) return { cached_tokens: 0 };
  if (typeof raw === "object" && raw !== null) {
    return { cached_tokens: Number((raw as any).cached_tokens ?? 0) };
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return { cached_tokens: Number(parsed.cached_tokens ?? 0) };
    } catch {
      return { cached_tokens: 0 };
    }
  }
  return { cached_tokens: 0 };
}

// Logs
apiRoutes.get("/logs", async (c) => {
  const params = parsePagination(c);
  if (params instanceof Error) return badRequest(c, params.message);

  try {
    const totalResult = await c.env.db.query<{ cnt: string }>(
      "SELECT COUNT(*) AS cnt FROM chat_logs"
    );
    const total = Number(totalResult.rows[0]?.cnt ?? 0);
    const { limit, offset } = limitOffset(params);
    const result = await c.env.db.query(
      "SELECT * FROM chat_logs ORDER BY id DESC LIMIT $1 OFFSET $2",
      [limit, offset]
    );
    const wrapLogs = (result.rows ?? []).map((log: any) => toChatLogDto({
      ...log,
      key_name: Number(log.auth_key_id ?? 0) === 0 ? "admin" : "",
    }));
    return success(c, newPaginationResponse(wrapLogs, total, params));
  } catch (e) {
    return internalServerError(c, `Failed to query logs: ${(e as Error).message}`);
  }
});

apiRoutes.get("/logs/:id/chat-io", async (c) => {
  const raw = c.req.param("id") ?? "";
  const id = Number.parseInt(raw, 10);
  try {
    if (!Number.isFinite(id)) return badRequest(c, "Invalid ID format");
    const result = await c.env.db.query(
      "SELECT * FROM chat_io WHERE log_id = $1",
      [id]
    );
    if (result.rows.length === 0) return notFound(c, "ChatIO not found");
    return success(c, result.rows[0]);
  } catch (e) {
    return notFound(c, "ChatIO not found");
  }
});

// 清理日志接口
apiRoutes.post("/logs/cleanup", async (c) => {
  try {
    const body = await c.req.json<{ type: "count" | "days"; value: number }>();
    const { type, value } = body;

    if (!type || !["count", "days"].includes(type)) {
      return badRequest(c, "Invalid type, must be 'count' or 'days'");
    }
    if (!Number.isFinite(value) || value <= 0) {
      return badRequest(c, "Invalid value, must be a positive number");
    }

    let deletedCount = 0;

    if (type === "days") {
      // 删除 N 天前的日志
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - value);

      // 先删除关联的 chat_io 记录
      await c.env.db.query(
        `DELETE FROM chat_io WHERE log_id IN (
          SELECT id FROM chat_logs WHERE created_at < $1
        )`,
        [cutoffDate.toISOString()]
      );

      // 再删除 chat_logs
      const result = await c.env.db.query(
        "DELETE FROM chat_logs WHERE created_at < $1",
        [cutoffDate.toISOString()]
      );
      deletedCount = result.rowCount ?? 0;
    } else {
      // 只保留最近 N 条日志
      // 获取要保留的日志 ID 列表
      const keepResult = await c.env.db.query<{ id: number }>(
        `SELECT id FROM chat_logs ORDER BY created_at DESC LIMIT $1`,
        [value]
      );
      const keepIds = keepResult.rows.map(r => r.id);
      console.log("[logs/cleanup] Keep IDs:", keepIds);

      if (keepIds.length > 0) {
        // 删除不在保留列表中的 chat_io 记录
        const placeholders = keepIds.map((_, i) => `$${i + 1}`).join(",");
        await c.env.db.query(
          `DELETE FROM chat_io WHERE log_id NOT IN (${placeholders})`,
          keepIds
        );

        // 删除不在保留列表中的 chat_logs
        const result = await c.env.db.query(
          `DELETE FROM chat_logs WHERE id NOT IN (${placeholders})`,
          keepIds
        );
        deletedCount = result.rowCount ?? 0;
      } else {
        // 如果没有要保留的，删除全部
        await c.env.db.query("DELETE FROM chat_io");
        const result = await c.env.db.query("DELETE FROM chat_logs");
        deletedCount = result.rowCount ?? 0;
      }
    }

    return success(c, { deleted_count: deletedCount });
  } catch (e) {
    console.error("[logs/cleanup] Error:", e);
    return internalServerError(c, `Failed to cleanup logs: ${(e as Error).message}`);
  }
});

apiRoutes.get("/user-agents", async (c) => {
  try {
    const result = await c.env.db.query<{ user_agent: string }>(
      "SELECT DISTINCT user_agent FROM chat_logs WHERE user_agent IS NOT NULL AND user_agent != ''"
    );
    return success(c, (result.rows ?? []).map((r) => r.user_agent));
  } catch (e) {
    return internalServerError(c, `Failed to query user agents: ${(e as Error).message}`);
  }
});

// Version
apiRoutes.get("/version", (c) => success(c, Version));

// Test 接口
apiRoutes.get("/test/:id", async (c) => {
  const id = Number.parseInt(c.req.param("id") ?? "", 10);
  if (!Number.isFinite(id)) return badRequest(c, "Invalid ID format");
  try {
    const result = await c.env.db.query<any>(
      `SELECT p.name AS provider_name, p.type AS provider_type, p.config AS provider_config,
              mwp.provider_model, mwp.with_header, mwp.customer_headers
       FROM model_with_providers mwp
       JOIN providers p ON p.id = mwp.provider_id
       WHERE mwp.id = $1 AND mwp.deleted_at IS NULL AND p.deleted_at IS NULL`,
      [id]
    );
    if (result.rows.length === 0) return notFound(c, "ModelWithProvider not found");
    const row = result.rows[0];

    // 仅做连通性测试
    const testBodyByType: Record<string, string> = {
      openai: `{"model":"gpt-4.1","messages":[{"role":"user","content":"Please reply me yes or no"}]}`,
      "openai-res": `{"model":"gpt-4.1","input":[{"role":"user","content":[{"type":"input_text","text":"Please reply me yes or no"}]}]}`,
      anthropic: `{"model":"claude-sonnet-4-5","messages":[{"role":"user","content":[{"type":"text","text":"Please reply me yes or no","cache_control":{"type":"ephemeral"}}]}]}`,
      gemini: `{"contents":[{"parts":[{"text":"Please reply me yes or no"}]}]}`,
    };

    const withHeader = Number(row.with_header ?? 0) === 1;
    const customHeaders = safeParseJsonObject(row.customer_headers) ?? {};
    const headers = withHeader ? new Headers(c.req.raw.headers) : new Headers();
    headers.delete("authorization");
    headers.delete("x-api-key");
    headers.delete("x-goog-api-key");
    for (const [k, v] of Object.entries(customHeaders)) headers.set(k, v);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort("timeout"), 30_000);
    try {
      const type = String(row.provider_type);
      const providerModel = String(row.provider_model);
      const cfg = JSON.parse(String(row.provider_config)) as { base_url: string; api_key: string; version?: string };
      const base = String(cfg.base_url ?? "").replace(/\/$/, "");
      const body = testBodyByType[type];
      if (!body) return badRequest(c, "Invalid provider type");

      let url = "";
      if (type === "openai") url = `${base}/chat/completions`;
      else if (type === "openai-res") url = `${base}/responses`;
      else if (type === "anthropic") url = `${base}/messages`;
      else if (type === "gemini") url = `${base}/models/${encodeURIComponent(providerModel.replace(/^models\//, ""))}:generateContent`;

      const json = JSON.parse(body) as any;
      if (type !== "gemini") json.model = providerModel;
      const reqBody = JSON.stringify(json);

      if (type === "openai" || type === "openai-res") headers.set("Authorization", `Bearer ${cfg.api_key}`);
      if (type === "anthropic") {
        headers.set("x-api-key", cfg.api_key);
        headers.set("anthropic-version", String(cfg.version ?? ""));
      }
      if (type === "gemini") headers.set("x-goog-api-key", cfg.api_key);
      headers.set("Content-Type", "application/json");

      const res = await fetch(url, { method: "POST", headers, body: reqBody, signal: controller.signal });
      const content = await res.text();
      if (!res.ok) return errorWithHttpStatus(c, 200, res.status, `code: ${res.status} body: ${content}`);
      return successWithMessage(c, content, null);
    } finally {
      clearTimeout(timeout);
    }
  } catch (e) {
    return internalServerError(c, "Database error");
  }
});

function sanitizeModels(list: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const trimmed = String(raw).trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
