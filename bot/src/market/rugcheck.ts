import { fetchJson, TtlCache } from "../util/http.js";

export interface RugSummary {
  tokenProgram?: string;
  tokenType?: string;
  risks?: { name: string; value?: string; description: string; score: number; level: string }[];
  score?: number;
  /** 0 = clean … 100 = very risky. */
  score_normalised?: number;
  lpLockedPct?: number;
}

const cache = new TtlCache<RugSummary>(30 * 60_000);

/** RugCheck.xyz summary report (free, no key). Cached 30 minutes per token. */
export async function getRugSummary(mint: string): Promise<RugSummary> {
  const hit = cache.get(mint);
  if (hit) return hit;
  const r = await fetchJson<RugSummary>(`https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`, {
    retries: 1,
  });
  cache.set(mint, r ?? {});
  return r ?? {};
}
