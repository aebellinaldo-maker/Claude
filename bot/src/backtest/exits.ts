/**
 * Exit-strategy back-test: replays the bot's REAL exit rules (exitSignal, the same code
 * that runs live) candle by candle on archived charts. Used to pick the "Moonshot" settings
 * from data and to show honest odds (how often a trade doubles, how often €10 → €100).
 */
import type { Candle } from "../ml/candles.js";
import { exitSignal } from "../risk/rules.js";
import type { Position, Settings } from "../types.js";

export interface ExitParams {
  stopLossPct: number;
  takeProfitPct: number;
  takeProfitSellPct: number;
  trailingStopPct: number;
  maxHoldHours: number;
}

export interface SimTrade {
  /** Net return of the whole position after fees (0.25 = +25%). */
  ret: number;
  /** Highest gain seen while holding (before fees). */
  peakRet: number;
  bars: number;
}

const BAR_MS = 15 * 60_000;

/**
 * Buys at candle i's close and applies exitSignal on every following candle.
 * Inside a candle the bad case is assumed first (low before high), and a stop that the
 * candle gaps through fills at the open, not at the stop price.
 */
export function simulateExit(grid: Candle[], i: number, p: ExitParams, base: Settings, opts: { feePct?: number; maxBars?: number } = {}): SimTrade | null {
  const fee = (opts.feePct ?? 1) / 100;
  const maxBars = opts.maxBars ?? 7 * 96;
  if (i + 4 >= grid.length) return null;
  const s: Settings = { ...base, ...p };
  const entry = grid[i][4];
  const t0 = grid[i][0] * 1000;
  const pos = {
    entryPriceUsd: entry,
    peakPriceUsd: entry,
    tookProfit: false,
    openedAt: t0,
    entryLiquidityUsd: 0,
  } as Position;
  let left = 1;
  let value = 0;
  const sell = (frac: number, price: number) => {
    const f = Math.min(left, frac);
    value += f * (price / entry);
    left -= f;
  };
  let k = i + 1;
  for (; k < grid.length && k <= i + maxBars && left > 1e-9; k++) {
    const [ts, open, high, low, close] = grid[k];
    const now = ts * 1000 + BAR_MS;
    // 1) the low of the candle: stop-loss or trailing stop (uses the peak from earlier candles)
    const down = exitSignal(pos, low, undefined, now, s);
    if (down.action === "sell" && (down.trigger === "stop_loss" || down.trigger === "trailing_stop")) {
      const level = down.trigger === "stop_loss" ? entry * (1 - s.stopLossPct / 100) : pos.peakPriceUsd * (1 - s.trailingStopPct / 100);
      sell(1, Math.min(level, open));
      break;
    }
    // 2) the high: take-profit
    const up = exitSignal(pos, high, undefined, now, s);
    if (up.action === "sell" && up.trigger === "take_profit") {
      const level = entry * (1 + s.takeProfitPct / 100);
      sell(up.pct / 100, Math.max(level, open));
      pos.tookProfit = true;
    }
    pos.peakPriceUsd = Math.max(pos.peakPriceUsd, high);
    // 3) the close: time exit
    const end = exitSignal(pos, close, undefined, now, s);
    if (end.action === "sell" && end.trigger === "time_exit") {
      sell(1, close);
      break;
    }
  }
  if (left > 1e-9) {
    // Still open at the end of the window: count it at the last close.
    const last = grid[Math.min(k, grid.length - 1)][4];
    sell(1, last);
  }
  return { ret: value * (1 - fee) - 1, peakRet: pos.peakPriceUsd / entry - 1, bars: k - i };
}

export interface ExitStats {
  trades: number;
  avgPct: number;
  medianPct: number;
  winRate: number;
  /** Share of trades that at least doubled / 5x'd (net). */
  doubled: number;
  fiveX: number;
  worstPct: number;
  bestPct: number;
}

export function exitStats(rs: number[]): ExitStats {
  const n = rs.length;
  if (!n) return { trades: 0, avgPct: 0, medianPct: 0, winRate: 0, doubled: 0, fiveX: 0, worstPct: 0, bestPct: 0 };
  const sorted = [...rs].sort((a, b) => a - b);
  const r1 = (x: number) => Math.round(x * 1000) / 10;
  return {
    trades: n,
    avgPct: r1(rs.reduce((a, b) => a + b, 0) / n),
    medianPct: r1(sorted[Math.floor(n / 2)]),
    winRate: Math.round((rs.filter((r) => r > 0).length / n) * 1000) / 1000,
    doubled: Math.round((rs.filter((r) => r >= 1).length / n) * 10000) / 10000,
    fiveX: Math.round((rs.filter((r) => r >= 4).length / n) * 10000) / 10000,
    worstPct: r1(sorted[0]),
    bestPct: r1(sorted[n - 1]),
  };
}

/**
 * "€10 → €100?" Monte Carlo: draws `tradesPerRun` trades at random from the back-test
 * results; each trade risks `stakeFrac` of the current balance. Returns the share of runs
 * that reached 3x / 10x, lost half, and the median end balance (as a multiple of the start).
 */
export function monteCarlo(rets: number[], stakeFrac: number, tradesPerRun: number, runs = 4000, seed = 42) {
  let x = seed >>> 0;
  const rnd = () => {
    // xorshift32: deterministic, so the report is reproducible
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
  const ends: number[] = [];
  let hit3 = 0,
    hit10 = 0,
    lostHalf = 0;
  for (let r = 0; r < runs; r++) {
    let eq = 1;
    let reached3 = false,
      reached10 = false,
      halved = false;
    for (let t = 0; t < tradesPerRun; t++) {
      eq *= 1 + stakeFrac * rets[Math.floor(rnd() * rets.length)];
      if (eq >= 3) reached3 = true;
      if (eq >= 10) reached10 = true;
      if (eq <= 0.5) halved = true;
      if (eq < 0.02) break; // effectively wiped out
    }
    ends.push(eq);
    if (reached3) hit3++;
    if (reached10) hit10++;
    if (halved) lostHalf++;
  }
  ends.sort((a, b) => a - b);
  return {
    reach3x: hit3 / runs,
    reach10x: hit10 / runs,
    lostHalf: lostHalf / runs,
    medianEnd: Math.round(ends[Math.floor(runs / 2)] * 100) / 100,
  };
}
