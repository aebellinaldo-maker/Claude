/**
 * "High win rate" mode back-test: Dip Hunter and Momentum, only on coins up ≥ 40 % in 24 h,
 * selling everything at a small target with a wide stop. For each strategy the exits are
 * chosen on the EARLIER 60 % of the days (win rate ≥ 75 %, then the best average) and
 * reported on the later days, with 1 % and 2 % trading costs, the worst trade and the
 * longest losing streak.
 *   npx tsx scripts/backtest-winrate.ts [--save]
 */
import fs from "node:fs";
import { listArchives, loadArchive, toGrid } from "../src/ml/candles.ts";
import { describeChart, FEATURE_NAMES, featuresAt, LOOKBACK } from "../src/ml/features.ts";
import { exitStats, simulateExit, type ExitParams } from "../src/backtest/exits.ts";
import { dipEntry } from "../src/strategies/squad.ts";
import { WINRATE, WINRATE_BACKTEST_FILE, WINRATE_MIN_24H_PCT } from "../src/risk/profiles.ts";
import { DEFAULT_SETTINGS } from "../src/store.ts";

const g = (x: number[], n: (typeof FEATURE_NAMES)[number]) => x[FEATURE_NAMES.indexOf(n)];
const minLogVol = Math.log10(1 + DEFAULT_SETTINGS.minVolume24hUsd);
type E = { grid: ReturnType<typeof toGrid>; i: number; ts: number; kind: "dip" | "momentum" };
const entries: E[] = [];
let coins = 0;
for (const id of listArchives()) {
  const a = loadArchive(id);
  if (!a || a.candles.length < LOOKBACK + 200) continue;
  const grid = toGrid(a.candles);
  coins++;
  let skip = 0;
  for (let i = LOOKBACK - 1; i + 8 < grid.length; i++) {
    const x = featuresAt(grid, i);
    if (!x || g(x, "log_vol_24h_usd") < minLogVol || g(x, "zero_vol_frac_24h") > 0.5 || g(x, "ret_24h") > 3) continue;
    if (g(x, "ret_24h") * 100 < WINRATE_MIN_24H_PCT) continue;
    const ch = describeChart(x);
    const dip = dipEntry({
      trend: String(ch.trend),
      rsi: Number(ch.rsi),
      belowHighPct: Number(ch.below_24h_high_pct),
      change15mPct: Number(ch.change_15m_pct),
      change1hPct: Number(ch.change_1h_pct),
      change24hPct: Number(ch.change_24h_pct),
    });
    if (i >= skip && dip !== null) {
      entries.push({ grid, i, ts: grid[i][0], kind: "dip" });
      skip = i + 8;
    }
    // The tested momentum rule (the live bot uses the same one in this mode).
    if (i % 4 === 0 && g(x, "ret_1h") > 0.03 && g(x, "ema9_21_gap") > 0 && g(x, "vol_accel_1h") > 1.2 && g(x, "rsi_14") < 80) {
      entries.push({ grid, i, ts: grid[i][0], kind: "momentum" });
    }
  }
}
entries.sort((a, b) => a.ts - b.ts);
const cut = entries[Math.floor(entries.length * 0.6)].ts;
const valid = entries.filter((e) => e.ts < cut);
const test = entries.filter((e) => e.ts >= cut);
const day = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);
console.log(`${coins} coins; choose on ${day(entries[0].ts)}…${day(cut)}, report on ${day(cut)}…${day(entries[entries.length - 1].ts)}`);

const streak = (rs: number[]) => {
  let m = 0,
    c = 0;
  for (const r of rs) {
    c = r <= 0 ? c + 1 : 0;
    m = Math.max(m, c);
  }
  return m;
};
const run = (set: E[], kind: E["kind"], p: ExitParams, fee: number) =>
  set
    .filter((e) => e.kind === kind)
    .flatMap((e) => {
      const r = simulateExit(e.grid, e.i, p, DEFAULT_SETTINGS, { feePct: fee });
      return r ? [r.ret] : [];
    });
const pack = (rs: number[]) => {
  const st = exitStats(rs);
  return { trades: st.trades, winRate: st.winRate, avgPct: st.avgPct, worstPct: st.worstPct, lossStreak: streak(rs) };
};

const grid: ExitParams[] = [];
for (const takeProfitPct of [6, 8, 10, 15])
  for (const stopLossPct of [20, 30])
    for (const maxHoldHours of [12, 24]) grid.push({ takeProfitPct, stopLossPct, maxHoldHours, takeProfitSellPct: 100, trailingStopPct: 90 });

const out: Record<string, unknown> = { createdAt: Date.now(), coins, testDays: Math.round((entries[entries.length - 1].ts - cut) / 86400), minChange24hPct: WINRATE_MIN_24H_PCT };
for (const kind of ["dip", "momentum"] as const) {
  const chosen = grid
    .map((p) => ({ p, v: exitStats(run(valid, kind, p, 1)) }))
    .filter((r) => r.v.trades >= 30 && r.v.winRate >= 0.75)
    .sort((a, b) => b.v.avgPct - a.v.avgPct)[0];
  if (!chosen) {
    console.log(`${kind}: no setting reached 75 % on the validation days`);
    continue;
  }
  const t1 = pack(run(test, kind, chosen.p, 1));
  const t2 = pack(run(test, kind, chosen.p, 2));
  const live = pack(run(test, kind, WINRATE, 1));
  console.log(
    `${kind.padEnd(8)} chosen TP +${chosen.p.takeProfitPct} SL −${chosen.p.stopLossPct} ${chosen.p.maxHoldHours}h | valid win ${Math.round(chosen.v.winRate * 100)}% avg ${chosen.v.avgPct}% | ` +
      `TEST win ${Math.round(t1.winRate * 100)}% avg ${t1.avgPct}% (2% fees: ${t2.avgPct}%) n=${t1.trades} worst ${t1.worstPct}% streak ${t1.lossStreak}`,
  );
  out[kind] = { chosen: chosen.p, valid: pack(run(valid, kind, chosen.p, 1)), test: t1, test2pctFees: t2, appSetting: live };
}
if (process.argv.includes("--save")) {
  fs.writeFileSync(WINRATE_BACKTEST_FILE, JSON.stringify(out, null, 2) + "\n");
  console.log(`Saved ${WINRATE_BACKTEST_FILE}`);
}
process.exit(0);
