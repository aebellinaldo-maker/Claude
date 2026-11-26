/**
 * Shadow test: every strategy signal (bought or not) becomes a virtual trade that follows live
 * prices, played out three ways — Normal, High win rate and Moonshot exits. That gives the bot
 * hundreds of forward-tested results a day instead of a handful of real trades, including for
 * Sniper and Whale Tail, which can't be tested on old charts. The results steer the money
 * allocation, bench strategies that lose, and drive the Auto mode.
 */
import crypto from "node:crypto";
import type { Candidate, Position, RiskMode, Settings, StrategyId, StrategySignal } from "../types.js";
import { exitSignal } from "../risk/rules.js";
import { MOONSHOT, WINRATE } from "../risk/profiles.js";
import { exitSettings, STRATEGY_IDS, winrateEntryOk } from "../strategies/squad.js";

export const VARIANTS: RiskMode[] = ["normal", "winrate", "moonshot"];

/** Round-trip trading costs assumed for shadow results (swap fees + slippage). */
export const SHADOW_FEE = 0.01;
const MAX_AGE_MS = 72 * 3_600_000;
const DEDUPE_MS = 2 * 3_600_000;
const MAX_OPEN = 400;
const MAX_CLOSED = 3000;

interface Leg {
  peak: number;
  tookProfit: boolean;
  /** Share of the position still held (1 = all). */
  left: number;
  /** Value already sold, as a multiple of the entry (0.5 × 1.2 = 0.6 …). */
  value: number;
  ret?: number;
  exit?: string;
}

export interface ShadowTrade {
  id: string;
  mint: string;
  symbol: string;
  strategy: StrategyId;
  strength: number;
  ts: number;
  /** Would this signal be allowed in High win rate mode? */
  winrateOk: boolean;
  /** Set from the first live price after the signal (same price source as later updates). */
  entryUsd?: number;
  legs: Record<RiskMode, Leg>;
}

export interface ShadowResult {
  mint: string;
  symbol: string;
  strategy: StrategyId;
  strength: number;
  ts: number;
  closedAt: number;
  winrateOk: boolean;
  ret: Record<RiskMode, number>;
}

export interface ShadowBook {
  open: ShadowTrade[];
  closed: ShadowResult[];
}

export function emptyShadowBook(): ShadowBook {
  return { open: [], closed: [] };
}

const legSettings = (base: Settings, v: RiskMode, strategy: StrategyId): Settings =>
  v === "winrate" ? { ...base, ...WINRATE } : v === "moonshot" ? { ...base, ...MOONSHOT } : exitSettings({ ...base, riskMode: "normal" }, strategy);

/** Starts a virtual trade for a signal (unless the same coin/strategy is already being followed). */
export function openShadow(book: ShadowBook, c: Candidate, sig: StrategySignal, now: number): boolean {
  const strategy = sig.strategy;
  if (book.open.length >= MAX_OPEN) return false;
  if (book.open.some((t) => t.mint === c.mint && t.strategy === strategy && now - t.ts < DEDUPE_MS)) return false;
  const leg = (): Leg => ({ peak: 0, tookProfit: false, left: 1, value: 0 });
  book.open.push({
    id: crypto.randomUUID(),
    mint: c.mint,
    symbol: c.symbol,
    strategy,
    strength: sig.strength,
    ts: now,
    winrateOk: winrateEntryOk(c, strategy),
    legs: { normal: leg(), winrate: leg(), moonshot: leg() },
  });
  return true;
}

/** Applies one live price to a virtual trade (the same exit rules the real bot uses). */
export function stepShadow(t: ShadowTrade, priceUsd: number, now: number, base: Settings): void {
  if (!(priceUsd > 0)) return;
  if (t.entryUsd === undefined) {
    t.entryUsd = priceUsd;
    for (const v of VARIANTS) t.legs[v].peak = priceUsd;
    return;
  }
  const entry = t.entryUsd;
  for (const v of VARIANTS) {
    const leg = t.legs[v];
    if (leg.ret !== undefined) continue;
    const pos = { entryPriceUsd: entry, peakPriceUsd: leg.peak, tookProfit: leg.tookProfit, openedAt: t.ts, entryLiquidityUsd: 0 } as Position;
    const sig = exitSignal(pos, priceUsd, undefined, now, legSettings(base, v, t.strategy));
    if (sig.action === "sell") {
      const amount = leg.left * (sig.pct / 100);
      leg.value += amount * (priceUsd / entry);
      leg.left -= amount;
      if (sig.trigger === "take_profit") leg.tookProfit = true;
      if (leg.left <= 1e-6) {
        leg.ret = leg.value * (1 - SHADOW_FEE) - 1;
        leg.exit = sig.trigger;
      }
    }
    leg.peak = Math.max(leg.peak, priceUsd);
    if (leg.ret === undefined && now - t.ts >= MAX_AGE_MS) {
      leg.ret = (leg.value + leg.left * (priceUsd / entry)) * (1 - SHADOW_FEE) - 1;
      leg.exit = "time_exit";
    }
  }
}

/** Updates all open virtual trades with live prices and files the finished ones. */
export function updateShadows(book: ShadowBook, prices: Record<string, number | undefined>, now: number, base: Settings): number {
  let finished = 0;
  const keep: ShadowTrade[] = [];
  for (const t of book.open) {
    const p = prices[t.mint];
    if (p) stepShadow(t, p, now, base);
    // No price for 6 h after the signal (delisted / dead): drop it rather than guess.
    if (t.entryUsd === undefined && now - t.ts > 6 * 3_600_000) continue;
    if (VARIANTS.every((v) => t.legs[v].ret !== undefined)) {
      book.closed.push({
        mint: t.mint,
        symbol: t.symbol,
        strategy: t.strategy,
        strength: t.strength,
        ts: t.ts,
        closedAt: now,
        winrateOk: t.winrateOk,
        ret: { normal: t.legs.normal.ret!, winrate: t.legs.winrate.ret!, moonshot: t.legs.moonshot.ret! },
      });
      finished++;
    } else keep.push(t);
  }
  book.open = keep;
  if (book.closed.length > MAX_CLOSED) book.closed = book.closed.slice(-MAX_CLOSED);
  return finished;
}

export interface ShadowStat {
  n: number;
  winRate: number | null;
  avgPct: number | null;
  profitFactor: number | null;
}

export function statOf(rets: number[]): ShadowStat {
  const n = rets.length;
  if (!n) return { n: 0, winRate: null, avgPct: null, profitFactor: null };
  const won = rets.filter((r) => r > 0).reduce((a, r) => a + r, 0);
  const lost = -rets.filter((r) => r <= 0).reduce((a, r) => a + r, 0);
  return {
    n,
    winRate: Math.round((rets.filter((r) => r > 0).length / n) * 1000) / 1000,
    avgPct: Math.round((rets.reduce((a, r) => a + r, 0) / n) * 1000) / 10,
    profitFactor: lost > 0 ? Math.round((won / lost) * 100) / 100 : won > 0 ? 99 : null,
  };
}

export interface ShadowSummary {
  days: number;
  open: number;
  /** Per strategy, per exit variant. */
  byStrategy: Record<StrategyId, Record<RiskMode, ShadowStat>>;
  /** Per mode, as that mode would really trade (High win rate: only its allowed signals). */
  byMode: Record<RiskMode, ShadowStat>;
  /** The mode with the best average, once every mode has enough results. */
  bestMode: RiskMode | null;
  /** Per strategy, as it trades in the given (current) mode. */
  current: Record<StrategyId, ShadowStat>;
}

/** Minimum finished virtual trades per mode before Auto mode trusts the comparison. */
export const AUTO_MIN_RESULTS = 30;

export function shadowSummary(book: ShadowBook, now: number, enabled: Set<StrategyId>, mode: RiskMode, days = 14): ShadowSummary {
  const recent = book.closed.filter((r) => now - r.closedAt <= days * 86_400_000);
  const byStrategy = Object.fromEntries(
    STRATEGY_IDS.map((id) => {
      const mine = recent.filter((r) => r.strategy === id);
      return [id, Object.fromEntries(VARIANTS.map((v) => [v, statOf(mine.map((r) => r.ret[v]))]))];
    }),
  ) as ShadowSummary["byStrategy"];
  const on = recent.filter((r) => enabled.has(r.strategy));
  const byMode = {
    normal: statOf(on.map((r) => r.ret.normal)),
    winrate: statOf(on.filter((r) => r.winrateOk).map((r) => r.ret.winrate)),
    moonshot: statOf(on.map((r) => r.ret.moonshot)),
  };
  const ready = VARIANTS.filter((v) => byMode[v].n >= AUTO_MIN_RESULTS);
  const bestMode = ready.length === VARIANTS.length ? [...ready].sort((a, b) => (byMode[b].avgPct ?? -1e9) - (byMode[a].avgPct ?? -1e9))[0] : null;
  const current = Object.fromEntries(
    STRATEGY_IDS.map((id) => {
      const mine = recent.filter((r) => r.strategy === id && (mode !== "winrate" || r.winrateOk));
      return [id, statOf(mine.map((r) => r.ret[mode]))];
    }),
  ) as Record<StrategyId, ShadowStat>;
  return { days, open: book.open.length, byStrategy, byMode, bestMode, current };
}

export interface LearnedThreshold {
  /** Minimum signal strength to buy, or null = no cut-off learned yet. */
  minStrength: number | null;
  /** Live results above that cut-off, and their average % per trade. */
  n: number;
  avgPct: number | null;
  /** Average of ALL signals of this strategy, for comparison. */
  allAvgPct: number | null;
}

const CUTS = [0.4, 0.5, 0.6, 0.7, 0.8];

/**
 * Self-tuning: which minimum signal strength would have made the most money for this
 * strategy in the live test (current mode)? A cut-off is only adopted when at least 20
 * results are above it and it beats taking every signal by 1 point per trade or more —
 * otherwise the strategy keeps its normal rules.
 */
export function learnedThreshold(book: ShadowBook, now: number, strategy: StrategyId, mode: RiskMode, days = 14): LearnedThreshold {
  const mine = book.closed.filter((r) => r.strategy === strategy && now - r.closedAt <= days * 86_400_000 && (mode !== "winrate" || r.winrateOk));
  const all = statOf(mine.map((r) => r.ret[mode]));
  let best: LearnedThreshold = { minStrength: null, n: all.n, avgPct: all.avgPct, allAvgPct: all.avgPct };
  if (all.n < 20 || all.avgPct === null) return best;
  for (const cut of CUTS) {
    const st = statOf(mine.filter((r) => r.strength >= cut).map((r) => r.ret[mode]));
    if (st.n < 20 || st.avgPct === null) continue;
    if (st.avgPct >= all.avgPct + 1 && st.avgPct > (best.avgPct ?? -1e9)) best = { minStrength: cut, n: st.n, avgPct: st.avgPct, allAvgPct: all.avgPct };
  }
  return best;
}
