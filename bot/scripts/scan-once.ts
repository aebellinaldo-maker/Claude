/**
 * One-off market scan: shows which coins the bot would consider right now and why
 * others were rejected. Doesn't trade and doesn't call the AI.
 *   npm run scan
 */
import { discoverCandidates } from "../src/market/discovery.ts";
import { marketFilter, rugCheck } from "../src/risk/safety.ts";
import { scoreCandidate } from "../src/risk/scoring.ts";
import { DEFAULT_SETTINGS } from "../src/store.ts";

const s = DEFAULT_SETTINGS;
const all = await discoverCandidates();
console.log(`Found ${all.length} coins from DexScreener boosts/profiles, GeckoTerminal trending and the watchlist.\n`);

const passed = [];
const rejected: Record<string, number> = {};
for (const c of all) {
  const reasons = marketFilter(c, s);
  if (reasons.length) {
    const key = reasons[0].replace(/[\d$.,]+/g, "#");
    rejected[key] = (rejected[key] ?? 0) + 1;
    continue;
  }
  const r = scoreCandidate(c);
  c.score = r.score;
  passed.push(c);
}
passed.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
console.log("Rejected by market filters:", rejected, "\n");

for (const c of passed.slice(0, 12)) {
  c.safety = await rugCheck(c, s);
  const flag = c.safety.ok ? (c.safety.level === "good" ? "✅" : "⚠️ ") : "⛔";
  console.log(
    `${flag} ${c.symbol.padEnd(10)} score ${c.score?.toFixed(2)}  1h ${c.priceChange.h1.toFixed(1).padStart(6)}%  24h ${c.priceChange.h24
      .toFixed(1)
      .padStart(7)}%  liq $${Math.round(c.liquidityUsd / 1000)}k  mcap $${(c.marketCapUsd / 1e6).toFixed(1)}M  [${c.sources.join(",")}]` +
      (c.safety.reasons.length ? `\n      ↳ ${c.safety.reasons.join("; ")}` : ""),
  );
}
