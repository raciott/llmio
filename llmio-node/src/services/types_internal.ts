export type OutputUnion = { ofString: string; ofStringArray: string[] };

export type Usage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details: { cached_tokens: number; audio_tokens: number };
};

export type ChatLogPatch = {
  first_chunk_time_ms: number;
  chunk_time_ms: number;
  usage: Usage;
  tps: number;
  size: number;
};
