export type Before = {
  model: string;
  stream: boolean;
  toolCall: boolean;
  structuredOutput: boolean;
  image: boolean;
  raw: Uint8Array;
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function getArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function beforeOpenAI(raw: Uint8Array): Before {
  const json = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>;
  const model = String(json["model"] ?? "");
  if (!model) throw new Error("model is empty");

  const stream = Boolean(json["stream"]);
  if (stream) {
    const so = isObject(json["stream_options"]) ? json["stream_options"] : {};
    json["stream_options"] = { ...(so as object), include_usage: true };
    raw = new TextEncoder().encode(JSON.stringify(json));
  }

  const tools = getArray(json["tools"]);
  const toolCall = tools.length > 0;
  const structuredOutput = json["response_format"] !== undefined;

  let image = false;
  for (const msg of getArray(json["messages"])) {
    if (!isObject(msg)) continue;
    if (String(msg["role"] ?? "") !== "user") continue;
    const content = msg["content"];
    for (const part of getArray(content)) {
      if (isObject(part) && String(part["type"] ?? "") === "image_url") {
        image = true;
        break;
      }
    }
    if (image) break;
  }

  return { model, stream, toolCall, structuredOutput, image, raw };
}

export function beforeOpenAIRes(raw: Uint8Array): Before {
  const json = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>;
  const model = String(json["model"] ?? "");
  if (!model) throw new Error("model is empty");

  const stream = Boolean(json["stream"]);
  const tools = getArray(json["tools"]);
  const toolCall = tools.length > 0;

  const text = isObject(json["text"]) ? json["text"] : undefined;
  const format = text && isObject((text as Record<string, unknown>)["format"]) ? (text as Record<string, unknown>)["format"] : undefined;
  const structuredOutput = Boolean(format && isObject(format) && String((format as Record<string, unknown>)["type"] ?? "") === "json_schema");

  let image = false;
  for (const input of getArray(json["input"])) {
    if (!isObject(input)) continue;
    if (String(input["role"] ?? "") !== "user") continue;
    for (const part of getArray(input["content"])) {
      if (isObject(part) && String(part["type"] ?? "") === "input_image") {
        image = true;
        break;
      }
    }
    if (image) break;
  }

  return { model, stream, toolCall, structuredOutput, image, raw };
}

export function beforeAnthropic(raw: Uint8Array): Before {
  const json = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>;
  const model = String(json["model"] ?? "");
  if (!model) throw new Error("model is empty");

  const stream = Boolean(json["stream"]);
  const tools = getArray(json["tools"]);
  const toolCall = tools.length > 0;

  let image = false;
  for (const msg of getArray(json["messages"])) {
    if (!isObject(msg)) continue;
    if (String(msg["role"] ?? "") !== "user") continue;
    for (const part of getArray(msg["content"])) {
      if (isObject(part) && String(part["type"] ?? "") === "image") {
        image = true;
        break;
      }
    }
    if (image) break;
  }

  return { model, stream, toolCall, structuredOutput: toolCall, image, raw };
}

export function beforeGemini(raw: Uint8Array, model: string, stream: boolean): Before {
  if (!model) throw new Error("model is empty");
  const json = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>;

  const tools = getArray(json["tools"]);
  let toolCall = tools.length > 0;
  if (!toolCall && (json["toolConfig"] !== undefined || json["tool_config"] !== undefined)) toolCall = true;

  let structuredOutput = false;
  const generationConfig = isObject(json["generationConfig"])
    ? (json["generationConfig"] as Record<string, unknown>)
    : isObject(json["generation_config"])
      ? (json["generation_config"] as Record<string, unknown>)
      : undefined;
  const config = isObject(json["config"]) ? (json["config"] as Record<string, unknown>) : undefined;

  const responseJsonSchema =
    generationConfig?.["responseJsonSchema"] ??
    generationConfig?.["response_json_schema"] ??
    config?.["responseJsonSchema"] ??
    config?.["response_json_schema"];
  if (responseJsonSchema !== undefined) structuredOutput = true;

  const responseMimeType =
    generationConfig?.["responseMimeType"] ??
    generationConfig?.["response_mime_type"] ??
    config?.["responseMimeType"] ??
    config?.["response_mime_type"];
  if (String(responseMimeType ?? "").toLowerCase() === "application/json") structuredOutput = true;

  let image = false;
  for (const content of getArray(json["contents"])) {
    if (!isObject(content)) continue;
    for (const part of getArray(content["parts"])) {
      if (!isObject(part)) continue;
      const inlineData = isObject(part["inlineData"])
        ? (part["inlineData"] as Record<string, unknown>)
        : isObject(part["inline_data"])
          ? (part["inline_data"] as Record<string, unknown>)
          : undefined;
      const fileData = isObject(part["fileData"])
        ? (part["fileData"] as Record<string, unknown>)
        : isObject(part["file_data"])
          ? (part["file_data"] as Record<string, unknown>)
          : undefined;

      const mimeType = String(inlineData?.["mimeType"] ?? inlineData?.["mime_type"] ?? fileData?.["mimeType"] ?? fileData?.["mime_type"] ?? "");
      if (mimeType.startsWith("image/")) {
        image = true;
        break;
      }
    }
    if (image) break;
  }

  // 兼容 Go 版：Gemini 模型来自 URL 路径，不写回 body
  return { model, stream, toolCall, structuredOutput, image, raw };
}
