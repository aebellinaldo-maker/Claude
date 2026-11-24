import { config } from "../config.js";
import type { Settings } from "../types.js";

export type Provider = "claude" | "ollama" | "openrouter" | "xai";

export interface ModelInfo {
  /** Stored in settings: Claude models by plain id, others as "<provider>/<model>". */
  id: string;
  label: string;
  provider: Provider;
  /** Model name as the provider's API expects it. */
  name: string;
  inUsd: number;
  outUsd: number;
  /** Server-side refusal fallback (Claude API only). */
  fallbacks: boolean;
  /** Can research the web for the market briefing. */
  webSearch: boolean;
  free: boolean;
}

const CLAUDE: Omit<ModelInfo, "provider" | "name" | "webSearch" | "free">[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (smartest)", inUsd: 4, outUsd: 20, fallbacks: true },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (balanced)", inUsd: 2, outUsd: 10, fallbacks: true },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (cheap)", inUsd: 0.1, outUsd: 0.5, fallbacks: false },
];

function other(provider: Exclude<Provider, "claude">, name: string, inUsd: number, outUsd: number, labelPrefix: string): ModelInfo {
  const free = inUsd === 0 && outUsd === 0;
  return {
    id: `${provider}/${name}`,
    label: `${labelPrefix}: ${name}${free ? " (free)" : ""}`,
    provider,
    name,
    inUsd,
    outUsd,
    fallbacks: false,
    webSearch: false,
    free,
  };
}

/** Every model the server has credentials for, in the order shown in the app. */
export function availableModels(): ModelInfo[] {
  const out: ModelInfo[] = [];
  if (config.anthropicApiKey) {
    for (const m of CLAUDE) out.push({ ...m, provider: "claude", name: m.id, webSearch: true, free: false });
  }
  const o = config.ollama;
  for (const name of o.models) out.push(other("ollama", name, o.priceInUsd, o.priceOutUsd, o.apiKey ? "Ollama Cloud" : "Ollama (this server)"));
  const r = config.openrouter;
  if (r.apiKey) for (const name of r.models) out.push(other("openrouter", name, r.priceInUsd, r.priceOutUsd, "OpenRouter"));
  const x = config.xai;
  if (x.apiKey) for (const name of x.models) out.push(other("xai", name, x.priceInUsd, x.priceOutUsd, "Grok (xAI)"));
  return out;
}

/** The model the bot should use: the one picked in Settings, or the first available one. */
export function resolveModel(s: Settings): ModelInfo | null {
  const all = availableModels();
  return all.find((m) => m.id === s.aiModel) ?? all[0] ?? null;
}

export function costUsd(m: ModelInfo, inTokens: number, outTokens: number): number {
  return (inTokens * m.inUsd + outTokens * m.outUsd) / 1_000_000;
}
