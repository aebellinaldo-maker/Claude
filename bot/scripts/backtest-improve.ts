/**
 * Do two extra rules make the bot better on days it never saw?
 *   - Break-even stop: once up X %, sell if it falls back to about the entry price.
 *   - Market mood: don't buy while the typical coin the bot sees is down over 24 h.
 * For each mode × strategy, every combination is scored on the EARLIER 60 % of the days;
 * the best one is reported on the later 40 % next to today's setup.
 *   npx tsx scripts/backtest-improve.ts [--save]
 */
import fs from "node:fs";
import path from "node:path";
import { listArchives, loadArchive, toGrid } from "../src/ml/candles.ts";
import { describeChart, FEATURE_NAMES, featuresAt, LOOKBACK } from "../src/ml/features.ts";
import { exitStats, simulateExit, type ExitParams } from "../src/backtest/exits.ts";
import { dipEntry, STRATEGIES } from "../src/strategies/squad.ts";
import { WINRATE, WINRATE_MIN_24H_PCT } from "../src/risk/profiles.ts";
import { DEFAULT_SETTINGS } from "../src/store.ts";

const g = (x: number[], n: (typeof FEATURE_NAMES)[number]) => x[FEATURE_NAMES.indexOf(n)];
const minLogVol = Math.log10(1 + DEFAULT_SETTINGS.minVolume24hUsd);
const HOUR = 3600;

type E = { grid: ReturnType<typeof toGrid>; i: number; ts: number; kind: "dip" | "momentum"; c24: number };
const entries: E[] = [];
// Market mood: the median 24 h change of all tradeable coins in the archive, per hour.
const moodSamples = new Map<number, number[]>();
for (const id of listArchives()) {
  const a = loadArchive(id);
  if (!a || a.candles.length < LOOKBACK + 200) continue;
  const grid = toGrid(a.candles);
  let skip = 0;
  for (let i = LOOKBACK - 1; i + 8 < grid.length; i++) {
    const x = featuresAt(grid, i);
    if (!x || g(x, "log_vol_24h_usd") < minLogVol || g(x, "zero_vol_frac_24h") > 0.5) continue;
    const ts = grid[i][0];
    const c24 = g(x, "ret_24h") * 100;
    if (ts % HOUR === 0) {
      const list = moodSamples.get(ts) ?? [];
      list.push(c24);
      moodSamples.set(ts, list);
    }
    if (g(x, "ret_24h") > 3) continue;
    const ch = describeChart(x);
    if (
      i >= skip &&
      dipEntry({ trend: String(ch.trend), rsi: Number(ch.rsi), belowHighPct: Number(ch.below_24h_high_pct), change15mPct: Number(ch.change_15m_pct), change1hPct: Number(ch.change_1h_pct), change24hPct: c24 }) !== null
    ) {
      entries.push({ grid, i, ts, kind: "dip", c24 });
      skip = i + 8;
    }
    if (i % 4 === 0 && g(x, "ret_1h") > 0.03 && g(x, "ema9_21_gap") > 0 && g(x, "vol_accel_1h") > 1.2 && g(x, "rsi_14") < 80) entries.push({ grid, i, ts, kind: "momentum", c24 });
  }
}
const mood = new Map<number, number>();
for (const [ts, list] of moodSamples) {
  if (list.length < 8) continue;
  const s = [...list].sort((a, b) => a - b);
  mood.set(ts, s[Math.floor(s.length / 2)]);
}
const moodAt = (ts: number) => mood.get(ts - (ts % HOUR));
entries.sort((a, b) => a.ts - b.ts);
const cut = entries[Math.floor(entries.length * 0.6)].ts;
const day = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);
console.log(`choose on ${day(entries[0].ts)}…${day(cut)}, report on ${day(cut)}…${day(entries[entries.length - 1].ts)}; mood known for ${mood.size} hours`);

const NORMAL_EXITS: Record<E["kind"], ExitParams> = {
  dip: STRATEGIES.dip.exits as ExitParams,
  momentum: { stopLossPct: 15, takeProfitPct: 40, takeProfitSellPct: 50, trailingStopPct: 20, maxHoldHours: 24 },
};
const MOODS: (number | null)[] = [null, -10, -5, 0, 5];
const BREAKEVEN = [0, 3, 5, 7];

const out: Record<string, unknown> = { createdAt: Date.now() };
for (const mode of ["winrate", "normal"] as const) {
  for (const kind of ["dip", "momentum"] as const) {
    const base: ExitParams = mode === "winrate" ? { ...WINRATE } : NORMAL_EXITS[kind];
    const pool = (set: E[]) => set.filter((e) => e.kind === kind && (mode !== "winrate" || e.c24 >= WINRATE_MIN_24H_PCT));
    const run = (set: E[], be: number, minMood: number | null) =>
      pool(set)
        .filter((e) => minMood === null || (moodAt(e.ts) ?? -1e9) >= minMood)
        .flatMap((e) => {
          const r = simulateExit(e.grid, e.i, { ...base, breakevenAfterPct: be }, DEFAULT_SETTINGS);
          return r ? [r.ret] : [];
        });
    const valid = entries.filter((e) => e.ts < cut),
      test = entries.filter((e) => e.ts >= cut);
    const fmt = (rs: number[]) => {
      const st = exitStats(rs);
      return `win ${String(Math.round(st.winRate * 100)).padStart(2)}% avg ${String(st.avgPct).padStart(5)}% n=${String(st.trades).padStart(3)}`;
    };
    const rows = BREAKEVEN.flatMap((be) => MOODS.map((m) => ({ be, m, v: exitStats(run(valid, be, m)) }))).filter((r) => r.v.trades >= 30);
    rows.sort((a, b) => b.v.avgPct - a.v.avgPct);
    const best = rows[0];
    console.log(`\n=== ${mode} / ${kind}`);
    console.log(`  today's setup          | valid ${fmt(run(valid, 0, null))} | TEST ${fmt(run(test, 0, null))}`);
    for (const r of rows.slice(0, 4)) {
      console.log(`  breakeven ${String(r.be).padStart(2)}% mood ${r.m === null ? " off" : String(r.m).padStart(4)} | valid ${fmt(run(valid, r.be, r.m))} | TEST ${fmt(run(test, r.be, r.m))}`);
    }
    out[`${mode}_${kind}`] = {
      chosen: { breakevenAfterPct: best.be, minMoodPct: best.m },
      today: { valid: exitStats(run(valid, 0, null)), test: exitStats(run(test, 0, null)) },
      improved: { valid: exitStats(run(valid, best.be, best.m)), test: exitStats(run(test, best.be, best.m)) },
    };
  }
}
if (process.argv.includes("--save")) {
  const file = path.resolve("ml/improve-backtest.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log(`Saved ${file}`);
}
process.exit(0);
