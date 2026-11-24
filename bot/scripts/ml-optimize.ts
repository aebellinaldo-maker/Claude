/**
 * Strategy optimizer: trains the own model for many take-profit / stop-loss / hold-time
 * combinations, picks the best one on the VALIDATION period only, and reports how that
 * choice did on the untouched TEST period (later days, coins never seen in training).
 *   npm run ml:optimize
 */
import fs from "node:fs";
import path from "node:path";
import { trainOnce } from "../src/ml/trainer.ts";
import { ML_DIR } from "../src/ml/dataset.ts";
import { MODEL_FILE, loadModel, type PilotModel } from "../src/ml/model.ts";
import { DEFAULT_SETTINGS } from "../src/store.ts";

const OUT = path.join(ML_DIR, "opt");
fs.mkdirSync(OUT, { recursive: true });

const combos: { tpPct: number; slPct: number; holdHours: number }[] = [];
for (const tpPct of [15, 25, 40]) for (const slPct of [8, 15]) for (const holdHours of [6, 12, 24]) combos.push({ tpPct, slPct, holdHours });

const rows: { c: (typeof combos)[number]; m: PilotModel; file: string }[] = [];
for (const c of combos) {
  const file = path.join(OUT, `tp${c.tpPct}_sl${c.slPct}_h${c.holdHours}.json`);
  try {
    await trainOnce({ ...c, minVolume24hUsd: DEFAULT_SETTINGS.minVolume24hUsd, outFile: file });
    rows.push({ c, m: JSON.parse(fs.readFileSync(file, "utf8")) as PilotModel, file });
  } catch (e) {
    console.log(`skip ${JSON.stringify(c)}: ${(e as Error).message}`);
  }
}

const v = (m: PilotModel) => (m.metrics as unknown as { validation: { trades: number; avgReturnPct: number | null } }).validation;
const fmt = (x: number | null | undefined) => (x === null || x === undefined ? "   –  " : `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`.padStart(7));
console.log("\nTP   SL  hold | valid avg (n) | TEST picks: win  avg     t    | buy-all avg | useful");
for (const { c, m } of rows) {
  const t = m.metrics.model;
  console.log(
    `${String(c.tpPct).padStart(2)}% ${String(c.slPct).padStart(2)}% ${String(c.holdHours).padStart(3)}h | ${fmt(v(m).avgReturnPct)} (${String(v(m).trades).padStart(4)}) | ${String(t.trades).padStart(4)} ${t.winRate === null ? "  –  " : `${Math.round(t.winRate * 100)}%`.padStart(4)} ${fmt(t.avgReturnPct)} ${String(t.tStat ?? "–").padStart(5)} | ${fmt(m.metrics.buyEverything.avgReturnPct)}     | ${m.metrics.useful ? "YES" : "no"}`,
  );
}

const eligible = rows.filter((r) => (v(r.m).trades ?? 0) >= 40 && v(r.m).avgReturnPct !== null);
eligible.sort((a, b) => (v(b.m).avgReturnPct ?? -1e9) - (v(a.m).avgReturnPct ?? -1e9));
const best = eligible[0];
if (!best) {
  console.log("\nNo strategy had enough validation trades.");
  process.exit(1);
}
fs.copyFileSync(best.file, MODEL_FILE);
loadModel();
const t = best.m.metrics.model;
console.log(
  `\nChosen on validation: TP +${best.c.tpPct}% / SL −${best.c.slPct}% / hold ${best.c.holdHours}h` +
    `\nIts honest TEST result: ${t.trades} trades, win ${t.winRate === null ? "–" : Math.round(t.winRate * 100) + "%"}, avg ${fmt(t.avgReturnPct)} per trade (t=${t.tStat}), useful=${best.m.metrics.useful}` +
    `\nSaved as ${MODEL_FILE}`,
);
process.exit(0);
