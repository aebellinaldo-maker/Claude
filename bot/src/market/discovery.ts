import type { Candidate } from "../types.js";
import { getBestPairs, getLatestBoosts, getLatestProfiles, getTopBoosts, type DexPair } from "./dexscreener.js";
import { getTrendingMints } from "./gecko.js";
import { log, errMsg } from "../util/log.js";

/**
 * Well-known, liquid Solana coins (verified mints). Always considered, so the bot
 * has solid options even on days where trending lists are full of junk.
 */
export const WATCHLIST: Record<string, string> = {
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: "BONK",
  EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm: "WIF",
  "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr": "POPCAT",
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: "JUP",
  "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump": "FARTCOIN",
  "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv": "PENGU",
  "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN": "TRUMP",
  ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82: "BOME",
};

/** Never trade these (stablecoins, wrapped SOL). */
const EXCLUDE = new Set([
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qJxyKBUuBWT3Z7xL3oPrEXTt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
]);

interface SourceInfo {
  sources: Set<string>;
  boost: number;
  trendingRank?: number;
}

export function pairToCandidate(p: DexPair, meta?: Partial<SourceInfo>): Candidate {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const created = n(p.pairCreatedAt);
  return {
    mint: p.baseToken.address,
    symbol: p.baseToken.symbol?.trim() || "?",
    name: p.baseToken.name?.trim() || "?",
    imageUrl: p.info?.imageUrl,
    pairAddress: p.pairAddress,
    dexId: p.dexId,
    url: p.url,
    priceUsd: Number(p.priceUsd ?? 0),
    liquidityUsd: n(p.liquidity?.usd),
    volume: { m5: n(p.volume?.m5), h1: n(p.volume?.h1), h6: n(p.volume?.h6), h24: n(p.volume?.h24) },
    priceChange: {
      m5: n(p.priceChange?.m5),
      h1: n(p.priceChange?.h1),
      h6: n(p.priceChange?.h6),
      h24: n(p.priceChange?.h24),
    },
    txns: {
      h1: { buys: n(p.txns?.h1?.buys), sells: n(p.txns?.h1?.sells) },
      h24: { buys: n(p.txns?.h24?.buys), sells: n(p.txns?.h24?.sells) },
    },
    marketCapUsd: n(p.marketCap) || n(p.fdv),
    fdvUsd: n(p.fdv),
    pairCreatedAt: created,
    ageHours: created ? (Date.now() - created) / 3_600_000 : 0,
    socials: (p.info?.socials ?? []).map((s) => s.type),
    websites: (p.info?.websites ?? []).length,
    boostAmount: Math.max(meta?.boost ?? 0, n(p.boosts?.active)),
    sources: [...(meta?.sources ?? [])],
    trendingRank: meta?.trendingRank,
  };
}

/**
 * Collects trending / hyped / well-known coins from several free sources and
 * returns market data for each (one most-liquid pair per coin).
 */
export async function discoverCandidates(extra: { mint: string; source: string }[] = []): Promise<Candidate[]> {
  const info = new Map<string, SourceInfo>();
  const add = (mint: string, source: string, boost = 0, rank?: number) => {
    if (!mint || EXCLUDE.has(mint)) return;
    const cur = info.get(mint) ?? { sources: new Set<string>(), boost: 0 };
    cur.sources.add(source);
    cur.boost = Math.max(cur.boost, boost);
    if (rank !== undefined) cur.trendingRank = Math.min(cur.trendingRank ?? rank, rank);
    info.set(mint, cur);
  };

  const [top, latest, profiles, trending] = await Promise.allSettled([
    getTopBoosts(),
    getLatestBoosts(),
    getLatestProfiles(),
    getTrendingMints(),
  ]);
  if (top.status === "fulfilled") top.value.forEach((b) => add(b.tokenAddress, "boost_top", b.totalAmount ?? 0));
  else log.warn(`DexScreener top boosts failed: ${errMsg(top.reason)}`);
  if (latest.status === "fulfilled")
    latest.value.forEach((b) => add(b.tokenAddress, "boost_new", b.totalAmount ?? b.amount ?? 0));
  if (profiles.status === "fulfilled") profiles.value.forEach((p) => add(p.tokenAddress, "new_profile"));
  if (trending.status === "fulfilled") trending.value.forEach((m, i) => add(m, "trending", 0, i + 1));
  for (const mint of Object.keys(WATCHLIST)) add(mint, "watchlist");
  for (const e of extra) add(e.mint, e.source);

  const pairs = await getBestPairs([...info.keys()]);
  const out: Candidate[] = [];
  for (const [mint, pair] of pairs) out.push(pairToCandidate(pair, info.get(mint)));
  return out;
}
