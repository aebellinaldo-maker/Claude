import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { listArchives, loadArchive, toGrid } from "./candles.js";
import { FEATURE_NAMES, featuresAt, LOOKBACK, outcomeAt } from "./features.js";

export const ML_DIR = path.join(config.dataDir, "ml");
export const DATASET_FILE = path.join(ML_DIR, "dataset.jsonl");

export interface DatasetOptions {
  tpPct: number;
  slPct: number;
  horizonBars: number;
  /** Only learn from moments the bot could actually trade (enough volume). */
  minVolume24hUsd: number;
  /** One sample every N candles (1 hour = 4) to limit near-duplicate rows. */
  every: number;
}

export interface DatasetSummary {
  samples: number;
  coins: number;
  wins: number;
  firstTs: number;
  lastTs: number;
  options: DatasetOptions;
}

/**
 * Replays every archived chart: at each sampled moment, record the chart features
 * (what the bot would have seen) and the outcome (what happened next).
 */
export async function buildDataset(opts: DatasetOptions): Promise<DatasetSummary> {
  const minLogVol = Math.log10(1 + opts.minVolume24hUsd);
  const volIdx = FEATURE_NAMES.indexOf("log_vol_24h_usd");
  const zeroIdx = FEATURE_NAMES.indexOf("zero_vol_frac_24h");
  const out = fs.createWriteStream(DATASET_FILE + ".tmp");
  let samples = 0,
    wins = 0,
    coins = 0,
    firstTs = Infinity,
    lastTs = 0;

  const lines: string[] = [];
  for (const name of listArchives()) {
    const a = loadArchive(name);
    if (!a || a.candles.length < LOOKBACK + opts.horizonBars + 10) continue;
    const grid = toGrid(a.candles);
    let used = false;
    for (let i = LOOKBACK - 1; i + opts.horizonBars < grid.length; i += opts.every) {
      const x = featuresAt(grid, i, a.createdAt);
      if (!x || x[volIdx] < minLogVol || x[zeroIdx] > 0.5) continue;
      const o = outcomeAt(grid, i, opts.tpPct, opts.slPct, opts.horizonBars);
      if (!o) continue;
      const ts = grid[i][0];
      lines.push(JSON.stringify({ t: ts, c: a.mint, x: x.map((v) => (Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : null)), y: o.win, r: Math.round(o.ret * 1e5) / 1e5 }));
      samples++;
      wins += o.win;
      firstTs = Math.min(firstTs, ts);
      lastTs = Math.max(lastTs, ts);
      used = true;
      if (lines.length >= 2000) out.write(lines.splice(0).join("\n") + "\n");
    }
    if (used) coins++;
  }
  if (lines.length) out.write(lines.join("\n") + "\n");
  await new Promise<void>((resolve, reject) => {
    out.on("error", reject);
    out.end(() => resolve());
  });
  fs.renameSync(DATASET_FILE + ".tmp", DATASET_FILE);
  return { samples, coins, wins, firstTs: samples ? firstTs : 0, lastTs, options: opts };
}
