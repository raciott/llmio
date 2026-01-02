import type { Style } from "../types.js";
import { StyleAnthropic, StyleGemini, StyleOpenAI, StyleOpenAIRes } from "../consts.js";

export type ProviderModel = {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
};

export type ProviderModelList = {
  object: string;
  data: ProviderModel[];
};

type OpenAIConfig = { base_url: string; api_key: string };
type OpenAIResConfig = { base_url: string; api_key: string };
type AnthropicConfig = { base_url: string; api_key: string; version: string };
type GeminiConfig = { base_url: string; api_key: string };

export function parseProviderConfig(style: Style, raw: string): OpenAIConfig | OpenAIResConfig | AnthropicConfig | GeminiConfig {
  const obj = JSON.parse(raw) as Record<string, unknown>;
  const base_url = String(obj["base_url"] ?? "");
  const api_key = String(obj["api_key"] ?? "");
  if (!base_url || !api_key) throw new Error(`invalid ${style} config`);
  if (style === StyleAnthropic) {
    const version = String(obj["version"] ?? "");
    if (!version) throw new Error("invalid anthropic config");
    return { base_url, api_key, version };
  }
  return { base_url, api_key } as OpenAIConfig;
}

export function buildProviderRequest(params: {
  style: Style;
  headers: Headers;
  providerModel: string;
  rawBody: Uint8Array;
  geminiStream?: boolean;
}) {
  const { style, headers, providerModel, rawBody } = params;

  const json = JSON.parse(new TextDecoder().decode(rawBody)) as Record<string, unknown>;

  switch (style) {
    case StyleOpenAI: {
      json["model"] = providerModel;
      // 过滤空文本内容块，避免 Bedrock API 报错
      sanitizeMessages(json, "messages");
      const body = JSON.stringify(json);
      return { path: "/chat/completions", body, contentType: "application/json" };
    }
    case StyleOpenAIRes: {
      json["model"] = providerModel;
      // 过滤空文本内容块
      sanitizeMessages(json, "input");
      const body = JSON.stringify(json);
      return { path: "/responses", body, contentType: "application/json" };
    }
    case StyleAnthropic: {
      json["model"] = providerModel;
      // 过滤空文本内容块，避免 Bedrock API 报错
      sanitizeMessages(json, "messages");
      const body = JSON.stringify(json);
      return { path: "/messages", body, contentType: "application/json" };
    }
    case StyleGemini: {
      const model = providerModel.replace(/^models\//, "");
      const action = params.geminiStream ? "streamGenerateContent" : "generateContent";
      const suffix = params.geminiStream ? "?alt=sse" : "";
      // 过滤空文本内容块
      sanitizeGeminiContents(json);
      return { path: `/models/${encodeURIComponent(model)}:${action}${suffix}`, body: JSON.stringify(json), contentType: "application/json" };
    }
    default:
      throw new Error("unknown provider");
  }
}

/**
 * 过滤消息中的空文本内容块，避免 AWS Bedrock 等 API 报错
 * "text content blocks must be non-empty"
 */
function sanitizeMessages(json: Record<string, unknown>, field: string) {
  const messages = json[field];
  if (!Array.isArray(messages)) return;

  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const content = (msg as Record<string, unknown>)["content"];

    // 如果 content 是字符串且为空，设为单个空格（保持结构有效）
    if (typeof content === "string") {
      if (content.trim() === "") {
        (msg as Record<string, unknown>)["content"] = " ";
      }
      continue;
    }

    // 如果 content 是数组，过滤空的 text 块
    if (Array.isArray(content)) {
      const filtered = content.filter((part) => {
        if (!part || typeof part !== "object") return true;
        const p = part as Record<string, unknown>;
        // 过滤空的 text 类型块
        if (p["type"] === "text" && typeof p["text"] === "string") {
          return p["text"].trim() !== "";
        }
        return true;
      });
      // 如果过滤后为空数组，添加一个占位文本
      if (filtered.length === 0) {
        (msg as Record<string, unknown>)["content"] = [{ type: "text", text: " " }];
      } else {
        (msg as Record<string, unknown>)["content"] = filtered;
      }
    }
  }
}

/**
 * 过滤 Gemini 格式的空文本内容块
 */
function sanitizeGeminiContents(json: Record<string, unknown>) {
  const contents = json["contents"];
  if (!Array.isArray(contents)) return;

  for (const content of contents) {
    if (!content || typeof content !== "object") continue;
    const parts = (content as Record<string, unknown>)["parts"];
    if (!Array.isArray(parts)) continue;

    const filtered = parts.filter((part) => {
      if (!part || typeof part !== "object") return true;
      const p = part as Record<string, unknown>;
      // 过滤只有空 text 的块
      if ("text" in p && typeof p["text"] === "string" && Object.keys(p).length === 1) {
        return p["text"].trim() !== "";
      }
      return true;
    });

    // 如果过滤后为空数组，添加一个占位文本
    if (filtered.length === 0) {
      (content as Record<string, unknown>)["parts"] = [{ text: " " }];
    } else {
      (content as Record<string, unknown>)["parts"] = filtered;
    }
  }
}

export async function fetchProviderModels(style: Style, providerConfigRaw: string): Promise<ProviderModel[]> {
  const cfg = parseProviderConfig(style, providerConfigRaw);
  const base = (cfg as { base_url: string }).base_url.replace(/\/$/, "");

  if (style === StyleGemini) {
    const { api_key } = cfg as GeminiConfig;
    const res = await fetch(`${base}/models`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": api_key,
      },
    });
    if (!res.ok) throw new Error(`status code: ${res.status}`);
    const data = (await res.json()) as { models?: { name: string }[] };
    return (data.models ?? []).map((m) => ({ id: m.name, object: "model", owned_by: "google" }));
  }

  if (style === StyleAnthropic) {
    const { api_key, version } = cfg as AnthropicConfig;
    const res = await fetch(`${base}/models`, {
      method: "GET",
      headers: { "content-type": "application/json", "x-api-key": api_key, "anthropic-version": version },
    });
    if (!res.ok) throw new Error(`status code: ${res.status}`);
    const data = (await res.json()) as { data?: { id: string; created_at: string }[] };
    return (data.data ?? []).map((m) => ({ id: m.id, created: Math.floor(new Date(m.created_at).getTime() / 1000) }));
  }

  const { api_key } = cfg as OpenAIConfig;
  const res = await fetch(`${base}/models`, { method: "GET", headers: { Authorization: `Bearer ${api_key}` } });
  if (!res.ok) throw new Error(`status code: ${res.status}`);
  const data = (await res.json()) as ProviderModelList;
  return data.data ?? [];
}

export function applyProviderAuthHeaders(style: Style, providerConfigRaw: string, headers: Headers, stream: boolean) {
  const cfg = parseProviderConfig(style, providerConfigRaw);
  switch (style) {
    case StyleOpenAI:
    case StyleOpenAIRes: {
      headers.set("Content-Type", "application/json");
      headers.set("Authorization", `Bearer ${(cfg as OpenAIConfig).api_key}`);
      return headers;
    }
    case StyleAnthropic: {
      const a = cfg as AnthropicConfig;
      headers.set("content-type", "application/json");
      headers.set("x-api-key", a.api_key);
      headers.set("anthropic-version", a.version);
      return headers;
    }
    case StyleGemini: {
      headers.set("Content-Type", "application/json");
      headers.set("x-goog-api-key", (cfg as GeminiConfig).api_key);
      if (stream) headers.set("Accept", "text/event-stream");
      return headers;
    }
    default:
      throw new Error("unknown provider");
  }
}
