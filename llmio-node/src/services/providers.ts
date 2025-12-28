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
      const body = JSON.stringify(json);
      return { path: "/chat/completions", body, contentType: "application/json" };
    }
    case StyleOpenAIRes: {
      json["model"] = providerModel;
      const body = JSON.stringify(json);
      return { path: "/responses", body, contentType: "application/json" };
    }
    case StyleAnthropic: {
      json["model"] = providerModel;
      const body = JSON.stringify(json);
      return { path: "/messages", body, contentType: "application/json" };
    }
    case StyleGemini: {
      const model = providerModel.replace(/^models\//, "");
      const action = params.geminiStream ? "streamGenerateContent" : "generateContent";
      const suffix = params.geminiStream ? "?alt=sse" : "";
      return { path: `/models/${encodeURIComponent(model)}:${action}${suffix}`, body: JSON.stringify(json), contentType: "application/json" };
    }
    default:
      throw new Error("unknown provider");
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
