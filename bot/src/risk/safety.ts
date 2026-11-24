import type { Candidate, SafetyReport, Settings } from "../types.js";
import { getRugSummary } from "../market/rugcheck.js";
import { WATCHLIST } from "../market/discovery.js";
import { errMsg } from "../util/log.js";

/**
 * Fast filter using only market data. Anything failing here is never bought,
 * no matter what the AI thinks. Returns the list of reasons it failed (empty = pass).
 */
export function marketFilter(c: Candidate, s: Settings): string[] {
  const reasons: string[] = [];
  const known = c.mint in WATCHLIST;
  if (c.priceUsd <= 0) reasons.push("no price");
  if (c.liquidityUsd < s.minLiquidityUsd) reasons.push(`liquidity $${Math.round(c.liquidityUsd)} < $${s.minLiquidityUsd}`);
  if (c.volume.h24 < s.minVolume24hUsd) reasons.push(`24h volume $${Math.round(c.volume.h24)} < $${s.minVolume24hUsd}`);
  if (!known && c.ageHours < s.minPairAgeHours) reasons.push(`too new (${c.ageHours.toFixed(1)}h < ${s.minPairAgeHours}h)`);
  if (c.marketCapUsd < s.minMarketCapUsd) reasons.push(`market cap $${Math.round(c.marketCapUsd)} too small`);
  if (c.marketCapUsd > s.maxMarketCapUsd) reasons.push("market cap above limit");
  if (c.priceChange.h24 > s.maxPump24hPct) reasons.push(`already pumped +${Math.round(c.priceChange.h24)}% in 24h`);
  if (c.priceChange.h1 < -25) reasons.push(`dumping (${Math.round(c.priceChange.h1)}% in 1h)`);
  const { buys, sells } = c.txns.h1;
  if (sells > 30 && sells > buys * 3) reasons.push("heavy selling (3x more sells than buys in 1h)");
  return reasons;
}

const ALWAYS_REJECT = [/freeze authority/i, /mint authority/i, /copycat/i, /rugged/i, /honeypot/i];

/** Deep rug-pull check via RugCheck.xyz. */
export async function rugCheck(c: Candidate, s: Settings): Promise<SafetyReport> {
  const known = c.mint in WATCHLIST;
  try {
    const r = await getRugSummary(c.mint);
    const risks = (r.risks ?? []).map((x) => ({ name: x.name, level: x.level, description: x.description }));
    const reasons: string[] = [];
    for (const risk of risks) {
      if (risk.level === "danger") reasons.push(`RugCheck danger: ${risk.name}`);
      else if (ALWAYS_REJECT.some((re) => re.test(risk.name))) reasons.push(`RugCheck: ${risk.name}`);
    }
    const score = r.score_normalised;
    if (typeof score === "number" && score > s.maxRugScore) reasons.push(`risk score ${score} > ${s.maxRugScore}`);
    const hasWarn = risks.some((x) => x.level === "warn");
    return {
      ok: reasons.length === 0,
      level: reasons.length ? "danger" : hasWarn ? "warn" : "good",
      rugScore: score,
      lpLockedPct: r.lpLockedPct,
      risks,
      reasons,
      checkedAt: Date.now(),
    };
  } catch (e) {
    // Fail safe: unknown coins without a safety report are not bought.
    return {
      ok: known,
      level: "unknown",
      risks: [],
      reasons: known ? [] : [`safety check unavailable (${errMsg(e).slice(0, 60)})`],
      checkedAt: Date.now(),
    };
  }
}
