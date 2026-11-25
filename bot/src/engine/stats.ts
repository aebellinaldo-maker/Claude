/**
 * Track record: turns the trade list into complete round trips (buy → last sell) and
 * computes the numbers that tell skill from luck — win rate, average win vs. average loss,
 * profit factor. Shown in the app, and given to the AI so it learns from its own results.
 */
import type { Mode, Trade, TradeTrigger } from "../types.js";

export interface RoundTrip {
  mint: string;
  symbol: string;
  openedAt: number;
  closedAt: number;
  costEur: number;
  pnlEur: number;
  pnlPct: number;
  entryTrigger: TradeTrigger;
  exitTriggers: TradeTrigger[];
  /** Why it was bought (the buy reason). */
  why: string;
}

export type Verdict = "too_early" | "good" | "breakeven" | "losing";

export interface TradeStats {
  closed: number;
  open: number;
  wins: number;
  winRate: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
  /** Euros won ÷ euros lost (above 1 = making money). */
  profitFactor: number | null;
  /** Average result per trade, % of the money put in. */
  avgTradePct: number | null;
  realizedEur: number;
  best: { symbol: string; pnlPct: number } | null;
  worst: { symbol: string; pnlPct: number } | null;
  avgHoldHours: number | null;
  verdict: Verdict;
  recent: RoundTrip[];
}

/** Fewer closed trades than this and the numbers are mostly luck. */
export const MIN_TRADES_FOR_VERDICT = 30;

export function roundTrips(trades: Trade[], mode: Mode, heldMints: Set<string>): { closed: RoundTrip[]; open: number } {
  const open = new Map<string, { buy: Trade; sells: Trade[] }>();
  const closed: RoundTrip[] = [];
  const finish = (o: { buy: Trade; sells: Trade[] }) => {
    if (!o.sells.length) return; // e.g. cleared by a paper reset: outcome unknown
    const pnlEur = o.sells.reduce((a, t) => a + (t.pnlEur ?? 0), 0);
    const cost = o.buy.valueEur;
    closed.push({
      mint: o.buy.mint,
      symbol: o.buy.symbol,
      openedAt: o.buy.ts,
      closedAt: o.sells[o.sells.length - 1].ts,
      costEur: cost,
      pnlEur,
      pnlPct: cost > 0 ? (pnlEur / cost) * 100 : 0,
      entryTrigger: o.buy.trigger,
      exitTriggers: [...new Set(o.sells.map((t) => t.trigger))],
      why: o.buy.reason,
    });
  };
  for (const t of [...trades].filter((x) => x.mode === mode).sort((a, b) => a.ts - b.ts)) {
    if (t.side === "buy") {
      const prev = open.get(t.mint);
      if (prev) finish(prev);
      open.set(t.mint, { buy: t, sells: [] });
    } else {
      open.get(t.mint)?.sells.push(t);
    }
  }
  let stillOpen = 0;
  for (const [mint, o] of open) {
    if (heldMints.has(mint)) stillOpen++;
    else finish(o);
  }
  closed.sort((a, b) => a.closedAt - b.closedAt);
  return { closed, open: stillOpen };
}

export function tradeStats(trades: Trade[], mode: Mode, heldMints: Set<string>, recent = 10): TradeStats {
  const { closed, open } = roundTrips(trades, mode, heldMints);
  const n = closed.length;
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const avg = (xs: number[]) => (xs.length ? r1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const wins = closed.filter((t) => t.pnlEur > 0);
  const losses = closed.filter((t) => t.pnlEur <= 0);
  const won = wins.reduce((a, t) => a + t.pnlEur, 0);
  const lost = -losses.reduce((a, t) => a + t.pnlEur, 0);
  const profitFactor = n ? (lost > 0 ? Math.round((won / lost) * 100) / 100 : won > 0 ? 99 : null) : null;
  const avgTradePct = avg(closed.map((t) => t.pnlPct));
  const byPct = [...closed].sort((a, b) => a.pnlPct - b.pnlPct);
  let verdict: Verdict = "too_early";
  if (n >= MIN_TRADES_FOR_VERDICT && profitFactor !== null && avgTradePct !== null) {
    verdict = profitFactor >= 1.2 && avgTradePct > 0 ? "good" : profitFactor < 0.9 ? "losing" : "breakeven";
  }
  return {
    closed: n,
    open,
    wins: wins.length,
    winRate: n ? Math.round((wins.length / n) * 1000) / 1000 : null,
    avgWinPct: avg(wins.map((t) => t.pnlPct)),
    avgLossPct: avg(losses.map((t) => t.pnlPct)),
    profitFactor,
    avgTradePct,
    realizedEur: Math.round(closed.reduce((a, t) => a + t.pnlEur, 0) * 100) / 100,
    best: n ? { symbol: byPct[n - 1].symbol, pnlPct: r1(byPct[n - 1].pnlPct) } : null,
    worst: n ? { symbol: byPct[0].symbol, pnlPct: r1(byPct[0].pnlPct) } : null,
    avgHoldHours: avg(closed.map((t) => (t.closedAt - t.openedAt) / 3_600_000)),
    verdict,
    recent: closed.slice(-recent).reverse(),
  };
}
