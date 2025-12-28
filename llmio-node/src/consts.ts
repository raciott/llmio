import type { Style } from "./types.js";

export const Version = "dev";

export const DefaultPort = "7070";

export const KeyPrefix = "sk-llmio-";

export const BalancerLottery = "lottery";
export const BalancerRotor = "rotor";
export const BalancerDefault = BalancerLottery;

export const StyleOpenAI: Style = "openai";
export const StyleOpenAIRes: Style = "openai-res";
export const StyleAnthropic: Style = "anthropic";
export const StyleGemini: Style = "gemini";
