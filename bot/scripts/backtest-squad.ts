/**
 * Back-tests the strategies that can be tested on stored 15-minute charts:
 *   - Dip Hunter: its exact entry rule (dipEntry) + a grid of exit rules
 *   - Momentum:   a breakout rule like the bot's, with the normal exits
 *   - Baseline:   buying any tradeable coin at any hour (no skill)
 * Exits are chosen on the EARLIER 60% of the days only and reported on the later 40%.
 * Sniper (needs launch-time data without survivorship bias) and Whale Tail (needs trade
 * history) can't be tested this way — they have to prove themselves in paper trading.
 *   npx tsx scripts/backtest-squad.ts [--save]
 */
import fs from "node:fs";
import path from "node:path";
import { listArchives, loadArchive, toGrid } from "../src/ml/candles.ts";
import { describeChart, FEATURE_NAMES, featuresAt, LOOKBACK } from "../src/ml/features.ts";
import { exitStats, simulateExit, type ExitParams } from "../src/backtest/exits.ts";
import { dipEntry } from "../src/strategies/squad.ts";
import { DEFAULT_SETTINGS } from "../src/store.ts";

const OUT = path.resolve("ml/squad-backtest.json");
const g = (x: number[], n: (typeof FEATURE_NAMES)[number]) => x[FEATURE_NAMES.indexOf(n)];
const minLogVol = Math.log10(1 + DEFAULT_SETTINGS.minVolume24hUsd);

type Entry = { grid: ReturnType<typeof toGrid>; i: number; ts: number; dip: boolean; momentum: boolean };
const entries: Entry[] = [];
let coins = 0;
for (const id of listArchives()) {
  const a = loadArchive(id);
  if (!a || a.candles.length < LOOKBACK + 200) continue;
  const grid = toGrid(a.candles);
  coins++;
  // Every 15 minutes for dips (they're short-lived), skipping ahead after a signal.
  let skipUntil = 0;
  for (let i = LOOKBACK - 1; i + 8 < grid.length; i++) {
    const x = featuresAt(grid, i);
    if (!x || g(x, "log_vol_24h_usd") < minLogVol || g(x, "zero_vol_frac_24h") > 0.5 || g(x, "ret_24h") > 3) continue;
    const ch = describeChart(x);
    const dip =
      i >= skipUntil &&
      dipEntry({
        trend: String(ch.trend),
        rsi: Number(ch.rsi),
        belowHighPct: Number(ch.below_24h_high_pct),
        change15mPct: Number(ch.change_15m_pct),
        change1hPct: Number(ch.change_1h_pct),
        change24hPct: Number(ch.change_24h_pct),
      }) !== null;
    if (dip) skipUntil = i + 8; // one signal per 2 hours per coin
    const hourly = i % 4 === 0;
    const momentum = hourly && g(x, "ret_1h") > 0.03 && g(x, "ema9_21_gap") > 0 && g(x, "vol_accel_1h") > 1.2 && g(x, "rsi_14") < 80;
    if (dip || hourly) entries.push({ grid, i, ts: grid[i][0], dip, momentum });
  }
}
entries.sort((a, b) => a.ts - b.ts);
const cut = entries[Math.floor(entries.length * 0.6)].ts;
const day = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);
const valid = entries.filter((e) => e.ts < cut);
const test = entries.filter((e) => e.ts >= cut);
console.log(`${coins} coins; choose on ${day(entries[0].ts)}…${day(cut)}, report on ${day(cut)}…${day(entries[entries.length - 1].ts)}`);
console.log(`dip signals: ${valid.filter((e) => e.dip).length} valid / ${test.filter((e) => e.dip).length} test; momentum: ${valid.filter((e) => e.momentum).length} / ${test.filter((e) => e.momentum).length}\n`);

const run = (set: Entry[], p: ExitParams, pick: (e: Entry) => boolean) =>
  set.filter(pick).flatMap((e) => {
    const r = simulateExit(e.grid, e.i, p, DEFAULT_SETTINGS);
    return r ? [r.ret] : [];
  });

const NORMAL: ExitParams = {
  stopLossPct: DEFAULT_SETTINGS.stopLossPct,
  takeProfitPct: DEFAULT_SETTINGS.takeProfitPct,
  takeProfitSellPct: DEFAULT_SETTINGS.takeProfitSellPct,
  trailingStopPct: DEFAULT_SETTINGS.trailingStopPct,
  maxHoldHours: DEFAULT_SETTINGS.maxHoldHours,
};
const grid: ExitParams[] = [];
for (const stopLossPct of [8, 12, 15, 20])
  for (const takeProfitPct of [20, 30, 40, 60])
    for (const trailingStopPct of [10, 15, 20])
      for (const maxHoldHours of [12, 24]) grid.push({ stopLossPct, takeProfitPct, takeProfitSellPct: 50, trailingStopPct, maxHoldHours });

const isDip = (e: Entry) => e.dip;
// Rank by the average with each trade capped at +100%, so one lucky moonshot can't pick the exits.
const capped = (rs: number[]) => (rs.length ? rs.reduce((a, r) => a + Math.min(1, r), 0) / rs.length : -1);
const scored = grid
  .map((p) => {
    const rs = run(valid, p, isDip);
    return { p, n: rs.length, score: capped(rs) };
  })
  .filter((r) => r.n >= 30)
  .sort((a, b) => b.score - a.score);
const best = scored[0];
for (const r of scored.slice(0, 5)) console.log(`  candidate ${fmtP(r.p)}: valid capped avg ${(r.score * 100).toFixed(1)}%, TEST avg ${exitStats(run(test, r.p, isDip)).avgPct}%`);
const fmt = fmtP;
function fmtP(p: ExitParams) {
  return `SL ${p.stopLossPct} / TP +${p.takeProfitPct} / trail ${p.trailingStopPct} / ${p.maxHoldHours}h`;
}
const line = (label: string, rs: number[]) => {
  const st = exitStats(rs);
  return `${label.padEnd(46)} n=${String(st.trades).padStart(5)}  avg ${String(st.avgPct).padStart(6)}%  median ${String(st.medianPct).padStart(6)}%  win ${String(Math.round(st.winRate * 100)).padStart(3)}%  best +${st.bestPct}%`;
};
console.log(line(`dip, chosen exits (valid): ${fmt(best.p)}`, run(valid, best.p, isDip)));
const dipT = run(test, best.p, isDip);
const momT = run(test, NORMAL, (e) => e.momentum);
const allT = run(test, NORMAL, (e) => e.ts % 3600 === 0);
console.log(line("dip, chosen exits (TEST)", dipT));
console.log(line("momentum rule, normal exits (TEST)", momT));
console.log(line("any coin any hour, normal exits (TEST)", allT));

if (process.argv.includes("--save")) {
  const testDays = Math.round((entries[entries.length - 1].ts - cut) / 86400);
  const pack = (rs: number[]) => {
    const st = exitStats(rs);
    return { trades: st.trades, avgPct: st.avgPct, medianPct: st.medianPct, winRate: st.winRate, bestPct: st.bestPct };
  };
  fs.writeFileSync(
    OUT,
    JSON.stringify({ createdAt: Date.now(), coins, testDays, dipExits: best.p, dip: pack(dipT), momentum: pack(momT), baseline: pack(allT) }, null, 2) + "\n",
  );
  console.log(`Saved ${OUT}`);
}
process.exit(0);
