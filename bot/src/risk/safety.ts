import type { Candidate, SafetyReport, Settings } from "../types.js";
import { getRugSummary } from "../market/rugcheck.js";
import { WATCHLIST } from "../market/discovery.js";
import { errMsg } from "../util/log.js";
import { L } from "../util/i18n.js";

/**
 * Fast filter using only market data. Anything failing here is never bought,
 * no matter what the AI thinks. Returns the list of reasons it failed (empty = pass).
 */
export function marketFilter(c: Candidate, s: Settings): string[] {
  const reasons: string[] = [];
  const l = (en: string, de: string) => L(s.language, en, de);
  const known = c.mint in WATCHLIST;
  if (c.priceUsd <= 0) reasons.push(l("no price", "kein Preis"));
  if (c.liquidityUsd < s.minLiquidityUsd)
    reasons.push(l(`liquidity $${Math.round(c.liquidityUsd)} < $${s.minLiquidityUsd}`, `Liquidität $${Math.round(c.liquidityUsd)} < $${s.minLiquidityUsd}`));
  if (c.volume.h24 < s.minVolume24hUsd)
    reasons.push(l(`24h volume $${Math.round(c.volume.h24)} < $${s.minVolume24hUsd}`, `24h-Volumen $${Math.round(c.volume.h24)} < $${s.minVolume24hUsd}`));
  if (!known && c.ageHours < s.minPairAgeHours)
    reasons.push(l(`too new (${c.ageHours.toFixed(1)}h < ${s.minPairAgeHours}h)`, `zu neu (${c.ageHours.toFixed(1)} Std. < ${s.minPairAgeHours} Std.)`));
  if (c.marketCapUsd < s.minMarketCapUsd)
    reasons.push(l(`market cap $${Math.round(c.marketCapUsd)} too small`, `Marktkapitalisierung $${Math.round(c.marketCapUsd)} zu klein`));
  if (c.marketCapUsd > s.maxMarketCapUsd) reasons.push(l("market cap above limit", "Marktkapitalisierung über dem Limit"));
  if (c.priceChange.h24 > s.maxPump24hPct)
    reasons.push(l(`already pumped +${Math.round(c.priceChange.h24)}% in 24h`, `schon +${Math.round(c.priceChange.h24)}% in 24 Std. gepumpt`));
  if (c.priceChange.h1 < -25) reasons.push(l(`dumping (${Math.round(c.priceChange.h1)}% in 1h)`, `stürzt ab (${Math.round(c.priceChange.h1)}% in 1 Std.)`));
  const { buys, sells } = c.txns.h1;
  if (sells > 30 && sells > buys * 3)
    reasons.push(l("heavy selling (3x more sells than buys in 1h)", "starker Verkaufsdruck (3x mehr Verkäufe als Käufe in 1 Std.)"));
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
    if (typeof score === "number" && score > s.maxRugScore)
      reasons.push(L(s.language, `risk score ${score} > ${s.maxRugScore}`, `Risikowert ${score} > ${s.maxRugScore}`));
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
      reasons: known ? [] : [L(s.language, "safety check unavailable", "Sicherheitscheck nicht verfügbar") + ` (${errMsg(e).slice(0, 60)})`],
      checkedAt: Date.now(),
    };
  }
}
