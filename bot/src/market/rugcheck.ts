import { fetchJson, TtlCache } from "../util/http.js";
import type { HolderInfo } from "../types.js";

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

interface RugReport {
  mintAuthority?: string | null;
  freezeAuthority?: string | null;
  totalHolders?: number;
  graphInsidersDetected?: number;
  creatorBalance?: number;
  rugged?: boolean;
  token?: { supply?: number; decimals?: number };
  topHolders?: { owner?: string; address?: string; pct?: number; insider?: boolean }[];
  knownAccounts?: Record<string, { name?: string; type?: string }>;
  markets?: { lp?: { lpLockedPct?: number } }[];
  launchpad?: { name?: string } | null;
}

const reportCache = new TtlCache<HolderInfo>(20 * 60_000);

/**
 * Full RugCheck report boiled down to what matters for young coins: who holds the supply
 * (pools and lockers excluded), insiders, the creator's share, and whether the developer
 * can still mint new tokens or freeze wallets.
 */
export async function getHolderInfo(mint: string): Promise<HolderInfo> {
  const hit = reportCache.get(mint);
  if (hit) return hit;
  const r = await fetchJson<RugReport>(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`, { retries: 1, timeoutMs: 20_000 });
  const info = holderInfoFromReport(r ?? {});
  reportCache.set(mint, info);
  return info;
}

export function holderInfoFromReport(r: RugReport): HolderInfo {
  const known = r.knownAccounts ?? {};
  const real = (r.topHolders ?? []).filter((h) => {
    const k = known[h.owner ?? ""] ?? known[h.address ?? ""];
    return !(k && (k.type === "AMM" || k.type === "LOCKER"));
  });
  const pcts = real.map((h) => h.pct ?? 0).sort((a, b) => b - a);
  const supply = r.token?.supply ?? 0;
  const lp = (r.markets ?? []).map((m) => m.lp?.lpLockedPct ?? 0);
  return {
    holders: r.totalHolders,
    top10Pct: pcts.length ? Math.round(pcts.slice(0, 10).reduce((a, b) => a + b, 0) * 10) / 10 : undefined,
    maxHolderPct: pcts.length ? Math.round(pcts[0] * 10) / 10 : undefined,
    insiders: r.graphInsidersDetected,
    creatorPct: supply > 0 && typeof r.creatorBalance === "number" ? Math.round((r.creatorBalance / supply) * 1000) / 10 : undefined,
    mintRevoked: !r.mintAuthority,
    freezeRevoked: !r.freezeAuthority,
    lpLockedPct: lp.length ? Math.max(...lp) : undefined,
    launchpad: r.launchpad?.name,
    rugged: r.rugged,
  };
}
