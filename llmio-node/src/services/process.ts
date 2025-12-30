import type { ChatLogPatch, OutputUnion } from "./types_internal.js";
import { readLines } from "../common/streams.js";

type Usage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details: { cached_tokens: number; audio_tokens: number };
};

function emptyUsage(): Usage {
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, prompt_tokens_details: { cached_tokens: 0, audio_tokens: 0 } };
}

function safeJsonParse(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * 简单的 token 估算函数
 * 英文约 4 字符 = 1 token，中文约 1.5 字符 = 1 token
 * 这是一个粗略估算，实际值可能有 10-20% 的误差
 */
function estimateTokens(text: string): number {
  if (!text) return 0;

  // 分离中文和非中文字符
  const chineseChars = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || [];
  const nonChineseLength = text.length - chineseChars.length;

  // 中文：约 1.5 字符 = 1 token
  // 英文/其他：约 4 字符 = 1 token
  const chineseTokens = Math.ceil(chineseChars.length / 1.5);
  const nonChineseTokens = Math.ceil(nonChineseLength / 4);

  return chineseTokens + nonChineseTokens;
}

/**
 * 从输出内容中提取文本用于 token 估算
 */
function extractOutputText(output: OutputUnion): string {
  if (output.ofString) {
    const obj = safeJsonParse(output.ofString);
    if (obj && typeof obj === "object") {
      // OpenAI 格式
      const choices = (obj as any).choices;
      if (Array.isArray(choices) && choices[0]?.message?.content) {
        return choices[0].message.content;
      }
      // Anthropic 格式
      const content = (obj as any).content;
      if (Array.isArray(content) && content[0]?.text) {
        return content[0].text;
      }
    }
    return output.ofString;
  }

  // 流式输出：拼接所有 chunk 中的 content
  let text = "";
  for (const chunk of output.ofStringArray) {
    const obj = safeJsonParse(chunk);
    if (obj && typeof obj === "object") {
      // OpenAI stream format
      const delta = (obj as any).choices?.[0]?.delta?.content;
      if (delta) text += delta;
      // Anthropic stream format
      const contentDelta = (obj as any).delta?.text;
      if (contentDelta) text += contentDelta;
    }
  }
  return text;
}

export async function processOpenAI(params: {
  stream: boolean;
  startedAtMs: number;
  body: ReadableStream<Uint8Array>;
  inputText?: string;
}): Promise<{ log: ChatLogPatch; output: OutputUnion }> {
  let firstChunkTimeMs = 0;
  let seenFirst = false;
  let usageText = "";
  const output: OutputUnion = { ofString: "", ofStringArray: [] };
  let size = 0;

  if (!params.stream) {
    const buf = await new Response(params.body).arrayBuffer();
    size = buf.byteLength;
    firstChunkTimeMs = Math.max(0, Math.floor(Date.now() - params.startedAtMs));
    const text = new TextDecoder().decode(buf);
    output.ofString = text;
    const obj = safeJsonParse(text);
    if (obj && typeof obj === "object" && obj !== null && "usage" in obj) usageText = JSON.stringify((obj as any).usage);
  } else {
    for await (const { line, bytes } of readLines(params.body)) {
      size += bytes;
      if (!seenFirst) {
        seenFirst = true;
        firstChunkTimeMs = Math.max(0, Math.floor(Date.now() - params.startedAtMs));
      }

      let chunk = line;
      if (chunk.startsWith("data: ")) chunk = chunk.slice("data: ".length);
      if (chunk === "[DONE]") break;
      const obj = safeJsonParse(chunk);
      if (obj && typeof obj === "object" && obj !== null && "error" in obj) throw new Error(JSON.stringify((obj as any).error));
      output.ofStringArray.push(chunk);
      const usage = obj && typeof obj === "object" && obj !== null ? (obj as any).usage : undefined;
      if (usage && Number(usage.total_tokens ?? 0) !== 0) usageText = JSON.stringify(usage);
    }
  }

  const usageObj = safeJsonParse(usageText);
  const usage = emptyUsage();
  if (usageObj && typeof usageObj === "object") {
    const u = usageObj as any;
    usage.prompt_tokens = Number(u.prompt_tokens ?? 0);
    usage.completion_tokens = Number(u.completion_tokens ?? 0);
    usage.total_tokens = Number(u.total_tokens ?? 0);
    const d = u.prompt_tokens_details ?? {};
    usage.prompt_tokens_details.cached_tokens = Number(d.cached_tokens ?? 0);
    usage.prompt_tokens_details.audio_tokens = Number(d.audio_tokens ?? 0);
  }

  // 如果上游没有返回 usage，则自动估算
  if (usage.total_tokens === 0) {
    const outputText = extractOutputText(output);
    usage.completion_tokens = estimateTokens(outputText);
    usage.prompt_tokens = params.inputText ? estimateTokens(params.inputText) : 0;
    usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
  }

  const chunkTimeMs = Math.max(0, Math.floor(Date.now() - params.startedAtMs - firstChunkTimeMs));
  const tps = chunkTimeMs > 0 ? usage.completion_tokens / (chunkTimeMs / 1000) : 0;
  return {
    log: { first_chunk_time_ms: firstChunkTimeMs, chunk_time_ms: chunkTimeMs, usage, tps, size },
    output,
  };
}

export async function processOpenAIRes(params: {
  stream: boolean;
  startedAtMs: number;
  body: ReadableStream<Uint8Array>;
  inputText?: string;
}): Promise<{ log: ChatLogPatch; output: OutputUnion }> {
  let firstChunkTimeMs = 0;
  let seenFirst = false;
  let usageText = "";
  const output: OutputUnion = { ofString: "", ofStringArray: [] };
  let size = 0;

  if (!params.stream) {
    const buf = await new Response(params.body).arrayBuffer();
    size = buf.byteLength;
    firstChunkTimeMs = Math.max(0, Math.floor(Date.now() - params.startedAtMs));
    const text = new TextDecoder().decode(buf);
    output.ofString = text;
    const obj = safeJsonParse(text);
    if (obj && typeof obj === "object" && obj !== null && "usage" in obj) usageText = JSON.stringify((obj as any).usage);
  } else {
    let event = "";
    for await (const { line, bytes } of readLines(params.body)) {
      size += bytes;
      if (!seenFirst) {
        seenFirst = true;
        firstChunkTimeMs = Math.max(0, Math.floor(Date.now() - params.startedAtMs));
      }

      if (line.startsWith("event: ")) {
        event = line.slice("event: ".length);
        continue;
      }

      let content = line;
      if (content.startsWith("data: ")) content = content.slice("data: ".length);
      if (!content) continue;
      output.ofStringArray.push(content);
      if (event === "response.completed") {
        const obj = safeJsonParse(content);
        const usage = obj && typeof obj === "object" && obj !== null ? (obj as any).response?.usage : undefined;
        if (usage) usageText = JSON.stringify(usage);
      }
    }
  }

  const usageObj = safeJsonParse(usageText);
  const usage = emptyUsage();
  if (usageObj && typeof usageObj === "object") {
    const u = usageObj as any;
    usage.prompt_tokens = Number(u.input_tokens ?? 0);
    usage.completion_tokens = Number(u.output_tokens ?? 0);
    usage.total_tokens = Number(u.total_tokens ?? 0);
    usage.prompt_tokens_details.cached_tokens = Number(u.input_tokens_details?.cached_tokens ?? 0);
  }

  // 如果上游没有返回 usage，则自动估算
  if (usage.total_tokens === 0) {
    const outputText = extractOutputText(output);
    usage.completion_tokens = estimateTokens(outputText);
    usage.prompt_tokens = params.inputText ? estimateTokens(params.inputText) : 0;
    usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
  }

  const chunkTimeMs = Math.max(0, Math.floor(Date.now() - params.startedAtMs - firstChunkTimeMs));
  const tps = chunkTimeMs > 0 ? usage.completion_tokens / (chunkTimeMs / 1000) : 0;
  return {
    log: { first_chunk_time_ms: firstChunkTimeMs, chunk_time_ms: chunkTimeMs, usage, tps, size },
    output,
  };
}

export async function processAnthropic(params: {
  stream: boolean;
  startedAtMs: number;
  body: ReadableStream<Uint8Array>;
  inputText?: string;
}): Promise<{ log: ChatLogPatch; output: OutputUnion }> {
  let firstChunkTimeMs = 0;
  let seenFirst = false;
  let usageText = "";
  const output: OutputUnion = { ofString: "", ofStringArray: [] };
  let size = 0;

  if (!params.stream) {
    const buf = await new Response(params.body).arrayBuffer();
    size = buf.byteLength;
    firstChunkTimeMs = Math.max(0, Math.floor(Date.now() - params.startedAtMs));
    const text = new TextDecoder().decode(buf);
    output.ofString = text;
    const obj = safeJsonParse(text);
    if (obj && typeof obj === "object" && obj !== null && "usage" in obj) usageText = JSON.stringify((obj as any).usage);
  } else {
    let event = "";
    for await (const { line, bytes } of readLines(params.body)) {
      size += bytes;
      if (!seenFirst) {
        seenFirst = true;
        firstChunkTimeMs = Math.max(0, Math.floor(Date.now() - params.startedAtMs));
      }

      if (line.startsWith("event: ")) {
        event = line.slice("event: ".length);
        continue;
      }

      if (!line.startsWith("data: ")) continue;
      const payload = line.slice("data: ".length);
      output.ofStringArray.push(payload);
      if (event === "message_delta") {
        const obj = safeJsonParse(payload);
        const usage = obj && typeof obj === "object" && obj !== null ? (obj as any).usage : undefined;
        if (usage) usageText = JSON.stringify(usage);
      }
    }
  }

  const usageObj = safeJsonParse(usageText);
  const usage = emptyUsage();
  if (usageObj && typeof usageObj === "object") {
    const u = usageObj as any;
    const input = Number(u.input_tokens ?? 0);
    const outputTokens = Number(u.output_tokens ?? 0);
    usage.prompt_tokens = input;
    usage.completion_tokens = outputTokens;
    usage.total_tokens = input + outputTokens;
    usage.prompt_tokens_details.cached_tokens = Number(u.cache_read_input_tokens ?? 0);
  }

  const chunkTimeMs = Math.max(0, Math.floor(Date.now() - params.startedAtMs - firstChunkTimeMs));
  const tps = chunkTimeMs > 0 ? usage.total_tokens / (chunkTimeMs / 1000) : 0;
  return {
    log: { first_chunk_time_ms: firstChunkTimeMs, chunk_time_ms: chunkTimeMs, usage, tps, size },
    output,
  };
}

export async function processGemini(params: {
  stream: boolean;
  startedAtMs: number;
  body: ReadableStream<Uint8Array>;
}): Promise<{ log: ChatLogPatch; output: OutputUnion }> {
  let firstChunkTimeMs = 0;
  let seenFirst = false;
  let usageText = "";
  const output: OutputUnion = { ofString: "", ofStringArray: [] };
  let size = 0;

  if (!params.stream) {
    const bytes = await new Response(params.body).arrayBuffer();
    size += bytes.byteLength;
    seenFirst = true;
    firstChunkTimeMs = Math.max(0, Math.floor(Date.now() - params.startedAtMs));
    const text = new TextDecoder().decode(bytes);
    output.ofString = text;
    const obj = safeJsonParse(text);
    if (obj && typeof obj === "object" && obj !== null) usageText = JSON.stringify((obj as any).usageMetadata ?? "");
  } else {
    for await (const { line, bytes } of readLines(params.body)) {
      size += bytes;
      if (!seenFirst) {
        seenFirst = true;
        firstChunkTimeMs = Math.max(0, Math.floor(Date.now() - params.startedAtMs));
      }
      if (line.startsWith("event:")) continue;

      let payload = "";
      if (line.startsWith("data: ")) payload = line.slice("data: ".length);
      else if (line.startsWith("{") || line.startsWith("[")) payload = line;
      else continue;

      if (!payload) continue;
      if (payload === "[DONE]") break;

      const obj = safeJsonParse(payload);
      if (obj && typeof obj === "object" && obj !== null && "error" in obj) throw new Error(JSON.stringify((obj as any).error));

      output.ofStringArray.push(payload);
      const usageMetadata = obj && typeof obj === "object" && obj !== null ? (obj as any).usageMetadata : undefined;
      if (usageMetadata && Number(usageMetadata.totalTokenCount ?? 0) !== 0) usageText = JSON.stringify(usageMetadata);
    }
  }

  const usageObj = safeJsonParse(usageText);
  const usage = emptyUsage();
  if (usageObj && typeof usageObj === "object") {
    const u = usageObj as any;
    usage.prompt_tokens = Number(u.promptTokenCount ?? 0);
    usage.completion_tokens = Number(u.candidatesTokenCount ?? 0) + Number(u.thoughtsTokenCount ?? 0);
    usage.total_tokens = Number(u.totalTokenCount ?? 0) || usage.prompt_tokens + usage.completion_tokens;
  }

  const chunkTimeMs = Math.max(0, Math.floor(Date.now() - params.startedAtMs - firstChunkTimeMs));
  const tps = chunkTimeMs > 0 ? usage.total_tokens / (chunkTimeMs / 1000) : 0;
  return {
    log: { first_chunk_time_ms: firstChunkTimeMs, chunk_time_ms: chunkTimeMs, usage, tps, size },
    output,
  };
}
