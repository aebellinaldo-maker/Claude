/**
 * Trains the own model: (1) make sure there are enough charts in the archive,
 * (2) build the dataset with the bot's current take-profit / stop-loss settings,
 * (3) run ml/train.py (LightGBM) in a separate process, (4) load the new model.
 * Runs in the background; the bot keeps trading meanwhile.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { state } from "../store.js";
import { fetchJson } from "../util/http.js";
import { log, errMsg } from "../util/log.js";
import { discoverCandidates } from "../market/discovery.js";
import { listArchives, updateArchive } from "./candles.js";
import { buildDataset } from "./dataset.js";
import { FEATURE_NAMES } from "./features.js";
import { getModel, loadModel } from "./model.js";

export interface TrainingStatus {
  running: boolean;
  phase: "idle" | "collecting" | "dataset" | "training" | "done" | "failed";
  startedAt?: number;
  finishedAt?: number;
  progress?: string;
  log: string[];
  error?: string;
}

export const training: TrainingStatus = { running: false, phase: "idle", log: [] };

function note(msg: string) {
  training.log.push(`${new Date().toISOString().slice(11, 19)} ${msg}`);
  if (training.log.length > 60) training.log.splice(0, training.log.length - 60);
  log.info(`[own model] ${msg}`);
}

export function pythonPath(): string {
  const venv = path.resolve("ml/.venv/bin/python");
  return fs.existsSync(venv) ? venv : "python3";
}

export function trainerAvailable(): boolean {
  return fs.existsSync(path.resolve("ml/train.py"));
}

const SKIP_SYMBOLS = /^(SOL|WSOL|USDC|USDT|USDG|PYUSD|USDS|USD1|EURC|FDUSD|USDE|MSOL|JITOSOL|BSOL|JUPSOL|INF|BNSOL|DSOL|HSOL|JSOL|STSOL|LST)$/i;
const QUOTES = new Set([
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qJxyKBUuBWT3Z7xL3oPrEXTt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
]);

interface GeckoPool {
  attributes: { address: string; name: string; pool_created_at?: string; reserve_in_usd?: string };
  relationships: { base_token: { data: { id: string } }; quote_token: { data: { id: string } } };
}

/** Pools worth learning from: the most traded and trending Solana pools, plus the bot's own candidates. */
async function poolsToCollect(topPages = 5): Promise<{ pool: string; mint: string; symbol: string; createdAt?: number }[]> {
  const out = new Map<string, { pool: string; mint: string; symbol: string; createdAt?: number }>();
  const urls = [
    ...Array.from({ length: topPages }, (_, i) => `https://api.geckoterminal.com/api/v2/networks/solana/pools?page=${i + 1}&sort=h24_volume_usd_desc`),
    ...[1, 2, 3].map((p) => `https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?page=${p}`),
  ];
  for (const url of urls) {
    try {
      let r: { data?: GeckoPool[] } | null = null;
      // The free API allows ~30 calls/minute: wait out "too many requests" instead of skipping the page.
      for (let attempt = 0; attempt < 4 && !r; attempt++) {
        try {
          r = await fetchJson<{ data?: GeckoPool[] }>(url, { retries: 0 });
        } catch (e) {
          if (attempt === 3 || !/HTTP 429/.test(errMsg(e))) throw e;
          await new Promise((res) => setTimeout(res, 20_000 * (attempt + 1)));
        }
      }
      for (const p of r?.data ?? []) {
        const base = p.relationships.base_token.data.id.replace(/^solana_/, "");
        const quote = p.relationships.quote_token.data.id.replace(/^solana_/, "");
        const symbol = p.attributes.name.split("/")[0].trim();
        if (!QUOTES.has(quote) || QUOTES.has(base) || SKIP_SYMBOLS.test(symbol)) continue;
        if (Number(p.attributes.reserve_in_usd ?? 0) < 30_000) continue;
        if (!out.has(base)) {
          out.set(base, {
            pool: p.attributes.address,
            mint: base,
            symbol,
            createdAt: p.attributes.pool_created_at ? Date.parse(p.attributes.pool_created_at) : undefined,
          });
        }
      }
    } catch (e) {
      note(`Pool list unavailable (${errMsg(e).slice(0, 80)})`);
    }
  }
  try {
    for (const c of await discoverCandidates()) {
      if (!out.has(c.mint) && c.liquidityUsd >= 30_000) {
        out.set(c.mint, { pool: c.pairAddress, mint: c.mint, symbol: c.symbol, createdAt: c.pairCreatedAt || undefined });
      }
    }
  } catch {
    /* optional */
  }
  return [...out.values()];
}

/** Adds charts of many active coins to the archive (first training run or a thin archive). */
export async function collectCharts(maxNew = 120, pages = 2, topPages = 5): Promise<number> {
  const known = new Set(listArchives());
  const pools = (await poolsToCollect(topPages)).filter((p) => !known.has(p.pool.replace(/[^A-Za-z0-9]/g, ""))).slice(0, maxNew);
  note(`Collecting ~20 days of charts for ${pools.length} coins (free API, takes a few minutes)…`);
  let done = 0;
  for (const p of pools) {
    await updateArchive(p, pages);
    done++;
    training.progress = `${done}/${pools.length} charts`;
    if (done % 20 === 0) note(`${done}/${pools.length} charts collected`);
  }
  return done;
}

function runPython(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath(), [path.resolve("ml/train.py"), ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let errTail = "";
    child.stdout.on("data", (b: Buffer) => b.toString().split("\n").filter(Boolean).forEach((l) => note(l)));
    child.stderr.on("data", (b: Buffer) => {
      errTail = (errTail + b.toString()).slice(-1500);
    });
    child.on("error", (e) => reject(new Error(`Python not available (${e.message}). Run the setup script or: pip install -r ml/requirements.txt`)));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else if (/No module named/.test(errTail)) reject(new Error("The ML tools aren't installed on the server. In the bot folder run: npm run ml:setup"));
      else reject(new Error(errTail.trim().split("\n").filter(Boolean).pop() ?? `trainer exited with code ${code}`));
    });
  });
}

/** Builds the dataset for one strategy (take-profit / stop-loss / hold time) and trains on it. */
export async function trainOnce(p: { tpPct: number; slPct: number; holdHours: number; minVolume24hUsd: number; outFile?: string }) {
  const horizonBars = Math.round(p.holdHours * 4);
  const ds = await buildDataset({ tpPct: p.tpPct, slPct: p.slPct, horizonBars, minVolume24hUsd: p.minVolume24hUsd, every: 4 });
  await runPython([
    config.dataDir,
    JSON.stringify({ featureNames: FEATURE_NAMES, tpPct: p.tpPct, slPct: p.slPct, horizonBars, feePct: 1.0, outFile: p.outFile }),
  ]);
  return ds;
}

/** Full training run. Safe to call anytime; returns immediately if one is already running. */
export async function trainModel(opts: { collect?: boolean } = {}): Promise<void> {
  if (training.running) return;
  Object.assign(training, { running: true, phase: "collecting", startedAt: Date.now(), finishedAt: undefined, error: undefined, progress: undefined, log: [] });
  try {
    const s = state.settings;
    // Broaden the archive while it's small (unless told otherwise).
    if (opts.collect ?? listArchives().length < 150) await collectCharts();
    training.phase = "dataset";
    const horizonBars = Math.round(s.maxHoldHours * 4);
    const ds = await buildDataset({
      tpPct: s.takeProfitPct,
      slPct: s.stopLossPct,
      horizonBars,
      minVolume24hUsd: s.minVolume24hUsd,
      every: 4,
    });
    note(`Dataset: ${ds.samples} moments from ${ds.coins} coins (${ds.wins} reached +${s.takeProfitPct}% before −${s.stopLossPct}%)`);
    training.phase = "training";
    await runPython([
      config.dataDir,
      JSON.stringify({ featureNames: FEATURE_NAMES, tpPct: s.takeProfitPct, slPct: s.stopLossPct, horizonBars, feePct: 1.0 }),
    ]);
    const m = loadModel();
    if (!m) throw new Error("The new model could not be loaded");
    training.phase = "done";
    note(
      m.metrics.tradeReady
        ? "New model is active for paper and real money ✓"
        : m.metrics.useful
          ? "New model is active for paper trading; real money waits for the forward check"
          : "New model saved, but it does not beat simple rules on unseen coins — the bot will not trade on it.",
    );
  } catch (e) {
    training.phase = "failed";
    training.error = errMsg(e);
    note(`Training failed: ${training.error}`);
  } finally {
    training.running = false;
    training.finishedAt = Date.now();
    training.progress = undefined;
  }
}

/** Weekly automatic retraining (and a first training once enough charts exist). */
export function retrainDue(): boolean {
  if (training.running || !trainerAvailable()) return false;
  // Hosts that wipe files (Render free, Hugging Face) can't build up a chart archive:
  // they use the model shipped with the code instead of retraining on a tiny CPU.
  if (config.ephemeral && getModel()) return false;
  if (training.finishedAt && Date.now() - training.finishedAt < 6 * 3_600_000) return false; // don't retry failures too often
  const m = getModel();
  if (!m) return true;
  return Date.now() - Date.parse(m.createdAt) > 7 * 24 * 3_600_000;
}
