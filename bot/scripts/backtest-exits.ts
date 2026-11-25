/**
 * Compares the normal exit rules with "Moonshot" variants on archived charts.
 * Moonshot settings are chosen on the EARLIER 60% of the time range only, then reported
 * on the later 40% they never saw. Prints the odds of doubling a trade and of €10 → €100.
 *   npx tsx scripts/backtest-exits.ts
 */
import fs from "node:fs";
import { listArchives, loadArchive, toGrid } from "../src/ml/candles.ts";
import { FEATURE_NAMES, featuresAt, LOOKBACK } from "../src/ml/features.ts";
import { exitStats, monteCarlo, simulateExit, type ExitParams } from "../src/backtest/exits.ts";
import { DEFAULT_SETTINGS } from "../src/store.ts";
import { BACKTEST_FILE, MOONSHOT, type StrategyBacktest } from "../src/risk/profiles.ts";

const g = (x: number[], n: (typeof FEATURE_NAMES)[number]) => x[FEATURE_NAMES.indexOf(n)];
const minLogVol = Math.log10(1 + DEFAULT_SETTINGS.minVolume24hUsd);

type Entry = { grid: ReturnType<typeof toGrid>; i: number; ts: number; momentum: boolean };
const entries: Entry[] = [];
let coins = 0;
for (const id of listArchives()) {
  const a = loadArchive(id);
  if (!a || a.candles.length < LOOKBACK + 200) continue;
  const grid = toGrid(a.candles);
  coins++;
  for (let i = LOOKBACK - 1; i + 8 < grid.length; i += 4) {
    const x = featuresAt(grid, i);
    if (!x || g(x, "log_vol_24h_usd") < minLogVol || g(x, "zero_vol_frac_24h") > 0.5 || g(x, "ret_24h") > 3) continue;
    // Rough copy of what the bot looks for: rising now, short-term trend up, volume picking up.
    const momentum = g(x, "ret_1h") > 0.03 && g(x, "ema9_21_gap") > 0 && g(x, "vol_accel_1h") > 1.2 && g(x, "rsi_14") < 80;
    entries.push({ grid, i, ts: grid[i][0], momentum });
  }
}
entries.sort((a, b) => a.ts - b.ts);
const cut = entries[Math.floor(entries.length * 0.6)]?.ts ?? 0;
const valid = entries.filter((e) => e.ts < cut);
const test = entries.filter((e) => e.ts >= cut);
const day = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);
console.log(`${coins} coins, ${entries.length} hourly entry points (${entries.filter((e) => e.momentum).length} momentum)`);
console.log(`choose on ${day(entries[0].ts)}…${day(cut)}, report on ${day(cut)}…${day(entries[entries.length - 1].ts)}\n`);

const NORMAL: ExitParams = {
  stopLossPct: DEFAULT_SETTINGS.stopLossPct,
  takeProfitPct: DEFAULT_SETTINGS.takeProfitPct,
  takeProfitSellPct: DEFAULT_SETTINGS.takeProfitSellPct,
  trailingStopPct: DEFAULT_SETTINGS.trailingStopPct,
  maxHoldHours: DEFAULT_SETTINGS.maxHoldHours,
};
const run = (set: Entry[], p: ExitParams, momentumOnly: boolean) =>
  set.filter((e) => !momentumOnly || e.momentum).flatMap((e) => {
    const r = simulateExit(e.grid, e.i, p, DEFAULT_SETTINGS);
    return r ? [r.ret] : [];
  });

const grid: ExitParams[] = [];
for (const stopLossPct of [20, 25, 30])
  for (const trailingStopPct of [25, 35, 45])
    for (const maxHoldHours of [24, 48, 72])
      for (const [takeProfitPct, takeProfitSellPct] of [[100, 50], [200, 35], [1000, 50]] as const)
        grid.push({ stopLossPct, trailingStopPct, maxHoldHours, takeProfitPct, takeProfitSellPct });

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const line = (label: string, rs: number[]) => {
  const st = exitStats(rs);
  return `${label.padEnd(44)} n=${String(st.trades).padStart(5)}  avg ${String(st.avgPct).padStart(6)}%  median ${String(st.medianPct).padStart(6)}%  win ${pct(st.winRate).padStart(6)}  ≥2x ${pct(st.doubled).padStart(5)}  ≥5x ${pct(st.fiveX).padStart(5)}  best +${st.bestPct}%`;
};

let saved: StrategyBacktest | null = null;
for (const momentumOnly of [true, false]) {
  console.log(momentumOnly ? "=== Entries: momentum (like the bot) ===" : "=== Entries: every coin, every hour (no skill) ===");
  // Pick the moonshot variant with the best VALIDATION chance of a ≥2x trade, among those
  // whose average isn't worse than the normal rules by more than 1 point.
  const normV = exitStats(run(valid, NORMAL, momentumOnly));
  const scored = grid
    .map((p) => ({ p, v: exitStats(run(valid, p, momentumOnly)) }))
    .filter((r) => r.v.avgPct >= normV.avgPct - 1)
    .sort((a, b) => b.v.doubled - a.v.doubled || b.v.avgPct - a.v.avgPct);
  const best = scored[0];
  const fmtP = (p: ExitParams) => `SL ${p.stopLossPct} / TP ${p.takeProfitPct >= 1000 ? "none" : `+${p.takeProfitPct} sell ${p.takeProfitSellPct}%`} / trail ${p.trailingStopPct} / ${p.maxHoldHours}h`;
  console.log(line("normal (valid)", run(valid, NORMAL, momentumOnly)));
  if (best) console.log(line(`best moonshot (valid): ${fmtP(best.p)}`, run(valid, best.p, momentumOnly)));
  const normT = run(test, NORMAL, momentumOnly);
  const moonT = run(test, MOONSHOT, momentumOnly);
  console.log(line("normal (TEST)", normT));
  console.log(line(`app MOONSHOT (TEST): ${fmtP(MOONSHOT)}`, moonT));
  if (best) console.log(line(`best moonshot (TEST)`, run(test, best.p, momentumOnly)));
  if (momentumOnly) {
    const testDays = Math.round((entries[entries.length - 1].ts - cut) / 86400);
    saved = {
      createdAt: Date.now(),
      coins,
      testDays,
      trades: normT.length,
      normal: { ...exitStats(normT), tenXChance: monteCarlo(normT, 0.28, 60).reach10x, halfChance: monteCarlo(normT, 0.28, 60).lostHalf },
      moonshot: { ...exitStats(moonT), tenXChance: monteCarlo(moonT, 0.5, 60).reach10x, halfChance: monteCarlo(moonT, 0.5, 60).lostHalf },
    };
  }
  for (const [label, rs, stake] of [
    ["normal, ~28% per trade", normT, 0.28],
    ["moonshot, ~50% per trade", moonT, 0.5],
    ["moonshot, all-in each trade", moonT, 1],
  ] as const) {
    const mc = monteCarlo(rs, stake, 60);
    console.log(
      `  €10 over 60 trades, ${label.padEnd(28)} → reach €30: ${pct(mc.reach3x).padStart(6)}  reach €100: ${pct(mc.reach10x).padStart(6)}  drop to €5: ${pct(mc.lostHalf).padStart(6)}  typical end: €${(mc.medianEnd * 10).toFixed(2)}`,
    );
  }
  console.log("");
}
if (saved && process.argv.includes("--save")) {
  fs.writeFileSync(BACKTEST_FILE, JSON.stringify(saved, null, 2) + "\n");
  console.log(`Saved ${BACKTEST_FILE}`);
}
process.exit(0);
