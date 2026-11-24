import { chunk, fetchJson } from "../util/http.js";

const BASE = "https://api.dexscreener.com";

export interface DexPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceNative?: string;
  priceUsd?: string;
  txns?: Record<string, { buys: number; sells: number }>;
  volume?: Record<string, number>;
  priceChange?: Record<string, number>;
  liquidity?: { usd?: number; base?: number; quote?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: {
    imageUrl?: string;
    websites?: { url: string; label?: string }[];
    socials?: { url: string; type: string }[];
  };
  boosts?: { active?: number };
}

export interface DexBoost {
  chainId: string;
  tokenAddress: string;
  totalAmount?: number;
  amount?: number;
  links?: { type?: string; url: string }[];
}

export interface DexProfile {
  chainId: string;
  tokenAddress: string;
  description?: string;
  links?: { type?: string; label?: string; url: string }[];
}

/** Tokens that paid for DexScreener "boosts" (a direct marketing/hype signal). */
export async function getTopBoosts(): Promise<DexBoost[]> {
  const r = await fetchJson<DexBoost[]>(`${BASE}/token-boosts/top/v1`);
  return (r ?? []).filter((b) => b.chainId === "solana");
}

export async function getLatestBoosts(): Promise<DexBoost[]> {
  const r = await fetchJson<DexBoost[]>(`${BASE}/token-boosts/latest/v1`);
  return (r ?? []).filter((b) => b.chainId === "solana");
}

/** Tokens whose teams just paid for a DexScreener profile (another marketing signal). */
export async function getLatestProfiles(): Promise<DexProfile[]> {
  const r = await fetchJson<DexProfile[]>(`${BASE}/token-profiles/latest/v1`);
  return (r ?? []).filter((p) => p.chainId === "solana");
}

const QUOTES = new Set([
  "So11111111111111111111111111111111111111112", // SOL
  "EPjFWdd5AufqSSqeM2qJxyKBUuBWT3Z7xL3oPrEXTt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);

/**
 * Pair data for many tokens (30 per request). Returns the most liquid
 * SOL/USDC/USDT pair for each token mint.
 */
export async function getBestPairs(mints: string[]): Promise<Map<string, DexPair>> {
  const best = new Map<string, DexPair>();
  for (const group of chunk([...new Set(mints)], 30)) {
    const pairs = await fetchJson<DexPair[]>(`${BASE}/tokens/v1/solana/${group.join(",")}`);
    for (const p of pairs ?? []) {
      if (p.chainId !== "solana") continue;
      if (!QUOTES.has(p.quoteToken.address)) continue;
      const mint = p.baseToken.address;
      const cur = best.get(mint);
      if (!cur || (p.liquidity?.usd ?? 0) > (cur.liquidity?.usd ?? 0)) best.set(mint, p);
    }
  }
  return best;
}

export async function searchPairs(query: string): Promise<DexPair[]> {
  const r = await fetchJson<{ pairs: DexPair[] }>(`${BASE}/latest/dex/search?q=${encodeURIComponent(query)}`);
  return (r?.pairs ?? []).filter((p) => p.chainId === "solana" && QUOTES.has(p.quoteToken.address));
}
