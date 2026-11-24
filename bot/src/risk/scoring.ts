import type { Candidate } from "../types.js";

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * Rule-based opportunity score (0…1). Used to rank coins before the AI looks at
 * them, and as the decision maker when the AI is off or over budget.
 */
export function scoreCandidate(c: Candidate): { score: number; breakdown: Record<string, number> } {
  // Momentum: rising over 1h and 6h is good; a vertical 1h candle is a warning sign.
  let momentum = 0.5 * clamp01((c.priceChange.h1 + 5) / 25) + 0.5 * clamp01((c.priceChange.h6 + 10) / 50);
  if (c.priceChange.h1 > 40) momentum *= 0.5;

  // Buy pressure: more buyers than sellers in the last hour.
  const ratio = c.txns.h1.buys / Math.max(1, c.txns.h1.sells);
  const buyPressure = clamp01((ratio - 0.8) / 0.8);

  // Volume acceleration: last hour's volume vs the 24h average hour.
  const avgHour = c.volume.h24 / 24;
  const accel = avgHour > 0 ? c.volume.h1 / avgHour : 0;
  const volume = clamp01((accel - 0.5) / 1.5);

  // Liquidity depth: easier to get in and out without slippage.
  const liquidity = clamp01(Math.log10(Math.max(1, c.liquidityUsd) / 50_000) / 2);

  // Hype & marketing: paid DexScreener boosts, trending rank, socials, multiple sources.
  const boost = clamp01(c.boostAmount / 500);
  const trend = c.trendingRank ? clamp01(1 - (c.trendingRank - 1) / 20) : 0;
  const social = clamp01((c.socials.length + c.websites) / 3);
  const sourceCount = clamp01((c.sources.filter((s) => s !== "watchlist").length - 1) / 2);
  const hype = 0.35 * boost + 0.35 * trend + 0.15 * social + 0.15 * sourceCount;

  const safety = c.safety ? (c.safety.level === "good" ? 1 : c.safety.level === "warn" ? 0.6 : c.safety.ok ? 0.4 : 0) : 0.5;

  const breakdown = { momentum, buyPressure, volume, liquidity, hype, safety };
  const score =
    0.25 * momentum + 0.2 * buyPressure + 0.15 * volume + 0.15 * liquidity + 0.15 * hype + 0.1 * safety;
  return { score: Math.round(score * 1000) / 1000, breakdown };
}
