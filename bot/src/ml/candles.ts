/**
 * Price history ("candles") for Solana pools, from GeckoTerminal's free API, plus a
 * local archive in data/ml/candles/. The archive is the bot's memory: every coin it
 * looks at gets its chart saved and extended over time — including coins that later
 * crash — and the own model is trained on it.
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { fetchJson, HttpError } from "../util/http.js";
import { log, errMsg } from "../util/log.js";

/** [unix seconds, open, high, low, close, volume USD] — 15-minute candles, oldest first. */
export type Candle = [number, number, number, number, number, number];

export const STEP_SEC = 15 * 60;

export interface Archive {
  pool: string;
  mint: string;
  symbol: string;
  /** Pool creation time (ms), when known. */
  createdAt?: number;
  /**
   * When the bot started watching this coin (ms). Candles after this moment were recorded
   * "forward" — free of survivorship bias — and are used for the honest live check.
   */
  firstSeenAt?: number;
  updatedAt: number;
  candles: Candle[];
}

const DIR = path.join(config.dataDir, "ml", "candles");
fs.mkdirSync(DIR, { recursive: true });

const MAX_CANDLES = 6 * 24 * 4 * 30; // keep ~180 days per coin

async function geckoGet<T>(url: string, patient: boolean): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchJson<T>(url, { retries: patient ? 1 : 0, timeoutMs: 20_000 });
    } catch (e) {
      // The free API allows ~30 calls/minute. Training waits out a 429; live scans don't
      // (they fall back to the archived chart instead of stalling).
      if (patient && e instanceof HttpError && e.status === 429 && attempt < 3) {
        await new Promise((r) => setTimeout(r, 20_000 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
}

/** Up to 1000 fifteen-minute candles ending before `beforeSec` (or now), oldest first. */
export async function fetchCandles(pool: string, opts: { limit?: number; beforeSec?: number; patient?: boolean } = {}): Promise<Candle[]> {
  const qs = new URLSearchParams({ aggregate: "15", limit: String(opts.limit ?? 1000), currency: "usd" });
  if (opts.beforeSec) qs.set("before_timestamp", String(opts.beforeSec));
  const r = await geckoGet<{ data?: { attributes?: { ohlcv_list?: number[][] } } }>(
    `https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/ohlcv/minute?${qs}`,
    opts.patient ?? true,
  );
  const list = r?.data?.attributes?.ohlcv_list ?? [];
  return list
    .filter((c) => c.length >= 6 && c.slice(1, 5).every((x) => Number.isFinite(x) && x > 0))
    .map((c) => [c[0], c[1], c[2], c[3], c[4], c[5] || 0] as Candle)
    .sort((a, b) => a[0] - b[0]);
}

function file(pool: string) {
  return path.join(DIR, `${pool.replace(/[^A-Za-z0-9]/g, "")}.json`);
}

export function loadArchive(pool: string): Archive | null {
  try {
    return JSON.parse(fs.readFileSync(file(pool), "utf8")) as Archive;
  } catch {
    return null;
  }
}

export function saveArchive(a: Archive) {
  const tmp = file(a.pool) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(a));
  fs.renameSync(tmp, file(a.pool));
}

export function listArchives(): string[] {
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5));
}

export function mergeCandles(a: Candle[], b: Candle[]): Candle[] {
  const byTs = new Map<number, Candle>();
  for (const c of a) byTs.set(c[0], c);
  for (const c of b) byTs.set(c[0], c); // newer data wins (the last candle may have been partial)
  return [...byTs.values()].sort((x, y) => x[0] - y[0]).slice(-MAX_CANDLES);
}

/**
 * Brings a coin's archive up to date and returns it. New coins get ~20 days of
 * history (two requests); known coins only fetch what's new (one small request).
 */
export async function updateArchive(
  info: { pool: string; mint: string; symbol: string; createdAt?: number },
  backfillPages = 2,
  patient = true,
): Promise<Archive | null> {
  try {
    const existing = loadArchive(info.pool);
    let candles: Candle[];
    if (existing && existing.candles.length) {
      const last = existing.candles[existing.candles.length - 1][0];
      const missing = Math.ceil((Date.now() / 1000 - last) / STEP_SEC) + 2;
      if (missing <= 1) return existing;
      const fresh = await fetchCandles(info.pool, { limit: Math.min(1000, Math.max(10, missing)), patient });
      candles = mergeCandles(existing.candles, fresh);
    } else {
      candles = await fetchCandles(info.pool, { patient });
      for (let p = 1; p < backfillPages && candles.length >= 900; p++) {
        const older = await fetchCandles(info.pool, { beforeSec: candles[0][0], patient });
        if (!older.length) break;
        candles = mergeCandles(older, candles);
      }
    }
    const a: Archive = {
      pool: info.pool,
      mint: info.mint,
      symbol: info.symbol,
      createdAt: info.createdAt ?? existing?.createdAt,
      firstSeenAt: existing ? existing.firstSeenAt : Date.now(),
      updatedAt: Date.now(),
      candles,
    };
    saveArchive(a);
    return a;
  } catch (e) {
    log.debug(`Candles for ${info.symbol} unavailable: ${errMsg(e)}`);
    return loadArchive(info.pool);
  }
}

/**
 * GeckoTerminal leaves out 15-minute periods without trades. Fill them in so every
 * row is exactly 15 minutes after the previous one (flat price, zero volume).
 */
export function toGrid(candles: Candle[]): Candle[] {
  if (!candles.length) return [];
  const out: Candle[] = [candles[0]];
  for (let i = 1; i < candles.length; i++) {
    const prev = out[out.length - 1];
    let t = prev[0] + STEP_SEC;
    // Cap long gaps (a coin with no trades for 2+ days is effectively dead; keep the gap short).
    let filled = 0;
    while (t < candles[i][0] && filled < 192) {
      out.push([t, prev[4], prev[4], prev[4], prev[4], 0]);
      t += STEP_SEC;
      filled++;
    }
    out.push(candles[i]);
  }
  return out;
}
