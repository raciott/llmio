import type { Style } from "../types.js";

export type ChatLogBase = {
  uuid: string;
  name: string;
  provider_model: string;
  provider_name: string;
  status: string;
  style: Style;
  user_agent: string;
  remote_ip: string;
  auth_key_id: number;
  chat_io: number;
  error: string;
  retry: number;
  proxy_time_ms: number;
  created_at: string;
  updated_at: string;
};

export type ChatLogFinalize = {
  uuid: string;
  first_chunk_time_ms: number;
  chunk_time_ms: number;
  tps: number;
  size: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details: string; // JSON 字符串
  updated_at: string;
};

export type ChatIO = {
  input: string;
  output_string: string;
  output_string_array: string; // JSON 数组字符串
  created_at: string;
  updated_at: string;
};

export type ChatLogEvent =
  | { type: "insert"; base: ChatLogBase }
  | { type: "finalize"; base: ChatLogBase; finalize: ChatLogFinalize; io?: ChatIO };
