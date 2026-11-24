/**
 * Chart analysis: turns the last 24 hours of 15-minute candles into numbers that
 * describe the chart (trend, momentum, RSI, volatility, volume surges, candle shapes…).
 * The exact same code is used for training and for live decisions, so the model always
 * sees features computed the same way.
 */
import type { Candle } from "./candles.js";

export const LOOKBACK = 96; // 24 hours of 15-minute candles

export const FEATURE_NAMES = [
  "ret_15m",
  "ret_1h",
  "ret_4h",
  "ret_24h",
  "volatility_24h",
  "atr_4h_pct",
  "rsi_14",
  "ema9_21_gap",
  "ema21_96_gap",
  "range_pos_24h",
  "from_high_24h",
  "from_low_24h",
  "vol_accel_1h",
  "vol_trend_4h",
  "log_vol_24h_usd",
  "upper_wick_1h",
  "green_ratio_2h",
  "max_jump_4h",
  "vwap_dev_24h",
  "zero_vol_frac_24h",
  "age_hours",
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];

const O = 1,
  H = 2,
  L = 3,
  C = 4,
  V = 5;

function ema(values: number[], period: number): number {
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function rsi(closes: number[], period = 14): number {
  let gain = 0,
    loss = 0;
  // Wilder's smoothing over the whole window.
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = Math.max(0, d),
      l = Math.max(0, -d);
    if (i <= period) {
      gain += g / period;
      loss += l / period;
    } else {
      gain = (gain * (period - 1) + g) / period;
      loss = (loss * (period - 1) + l) / period;
    }
  }
  if (loss === 0) return gain === 0 ? 50 : 100;
  return 100 - 100 / (1 + gain / loss);
}

const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

/**
 * Features for the candle at index `i` of a gap-filled grid (see toGrid), using only
 * candles up to and including `i` (no peeking into the future).
 */
export function featuresAt(grid: Candle[], i: number, createdAtMs?: number): number[] | null {
  if (i < LOOKBACK - 1 || i >= grid.length) return null;
  const w = grid.slice(i - LOOKBACK + 1, i + 1);
  const closes = w.map((c) => c[C]);
  const c = closes[closes.length - 1];
  if (!(c > 0)) return null;
  const back = (n: number) => closes[closes.length - 1 - n];

  const logRets: number[] = [];
  for (let k = 1; k < closes.length; k++) logRets.push(Math.log(closes[k] / closes[k - 1]));
  const mean = sum(logRets) / logRets.length;
  const volatility = Math.sqrt(sum(logRets.map((r) => (r - mean) ** 2)) / logRets.length);

  const last16 = w.slice(-16);
  const atr = sum(last16.map((x) => (x[H] - x[L]) / x[C])) / last16.length;

  const high24 = Math.max(...w.map((x) => x[H]));
  const low24 = Math.min(...w.map((x) => x[L]));

  const vols = w.map((x) => x[V]);
  const vol24 = sum(vols);
  const vol1h = sum(vols.slice(-4));
  const vol4h = sum(vols.slice(-16));
  const volPrev4h = sum(vols.slice(-32, -16));

  const last4 = w.slice(-4);
  const upperWick = sum(last4.map((x) => (x[H] - Math.max(x[O], x[C])) / x[C])) / 4;
  const green = w.slice(-8).filter((x) => x[C] > x[O]).length / 8;

  let maxJump = 0;
  for (let k = closes.length - 16; k < closes.length; k++) maxJump = Math.max(maxJump, closes[k] / closes[k - 1] - 1);

  const pv = sum(w.map((x) => ((x[H] + x[L] + x[C]) / 3) * x[V]));
  const vwap = vol24 > 0 ? pv / vol24 : c;

  const ageHours = createdAtMs ? (w[w.length - 1][0] * 1000 - createdAtMs) / 3_600_000 : NaN;

  const f: Record<FeatureName, number> = {
    ret_15m: c / back(1) - 1,
    ret_1h: c / back(4) - 1,
    ret_4h: c / back(16) - 1,
    ret_24h: c / closes[0] - 1,
    volatility_24h: volatility,
    atr_4h_pct: atr,
    rsi_14: rsi(closes),
    ema9_21_gap: ema(closes, 9) / ema(closes, 21) - 1,
    ema21_96_gap: ema(closes, 21) / ema(closes, 96) - 1,
    range_pos_24h: high24 > low24 ? (c - low24) / (high24 - low24) : 0.5,
    from_high_24h: c / high24 - 1,
    from_low_24h: c / low24 - 1,
    vol_accel_1h: vol24 > 0 ? vol1h / (vol24 / 24) : 0,
    vol_trend_4h: volPrev4h > 0 ? Math.min(20, vol4h / volPrev4h) : vol4h > 0 ? 20 : 1,
    log_vol_24h_usd: Math.log10(1 + vol24),
    upper_wick_1h: upperWick,
    green_ratio_2h: green,
    max_jump_4h: maxJump,
    vwap_dev_24h: c / vwap - 1,
    zero_vol_frac_24h: vols.filter((v) => v === 0).length / vols.length,
    age_hours: Number.isFinite(ageHours) && ageHours >= 0 ? Math.min(ageHours, 24 * 365) : NaN,
  };
  return FEATURE_NAMES.map((n) => f[n]);
}

export interface Outcome {
  /** 1 if take-profit was hit before stop-loss within the horizon. */
  win: 0 | 1;
  /** Trade return before fees: +tp, −sl, or the return at the horizon. */
  ret: number;
  /** Candles until the trade closed. */
  bars: number;
}

/**
 * What would have happened if the bot bought at candle i's close: did the price
 * reach +tp before −sl within `horizon` candles? If both happen inside the same
 * candle we can't know the order, so we count it as a loss (conservative).
 */
export function outcomeAt(grid: Candle[], i: number, tpPct: number, slPct: number, horizon: number): Outcome | null {
  if (i + horizon >= grid.length) return null;
  const entry = grid[i][C];
  const tp = entry * (1 + tpPct / 100);
  const sl = entry * (1 - slPct / 100);
  for (let k = i + 1; k <= i + horizon; k++) {
    if (grid[k][L] <= sl) return { win: 0, ret: -slPct / 100, bars: k - i };
    if (grid[k][H] >= tp) return { win: 1, ret: tpPct / 100, bars: k - i };
  }
  return { win: 0, ret: grid[i + horizon][C] / entry - 1, bars: horizon };
}

/** Human-readable chart summary (for the app and for the AI brains). */
export function describeChart(x: number[]) {
  const g = (n: FeatureName) => x[FEATURE_NAMES.indexOf(n)];
  const r = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
  const trend = g("ema9_21_gap") > 0.005 && g("ema21_96_gap") > 0 ? "up" : g("ema9_21_gap") < -0.005 && g("ema21_96_gap") < 0 ? "down" : "sideways";
  return {
    trend,
    rsi: r(g("rsi_14"), 0),
    change_1h_pct: r(g("ret_1h") * 100),
    change_4h_pct: r(g("ret_4h") * 100),
    change_24h_pct: r(g("ret_24h") * 100),
    below_24h_high_pct: r(-g("from_high_24h") * 100),
    position_in_24h_range_pct: r(g("range_pos_24h") * 100, 0),
    volume_vs_avg_1h: r(g("vol_accel_1h"), 2),
    volatility_15m_pct: r(g("volatility_24h") * 100, 2),
    green_candles_last_2h: Math.round(g("green_ratio_2h") * 8),
    upper_wicks_1h_pct: r(g("upper_wick_1h") * 100, 2),
    vs_vwap_24h_pct: r(g("vwap_dev_24h") * 100),
  };
}
