/**
 * Run summary: everything that happened between Start and Stop — value and profit,
 * each strategy's result, the activity feed, the equity curve and how every coin did.
 */
import type { EquityPoint, Position, RunSession, StrategyId, Trade } from "../types.js";
import { roundTrips, type RoundTrip } from "./stats.js";
import { STRATEGY_IDS } from "../strategies/squad.js";

export interface SessionSummary {
  id: string;
  mode: RunSession["mode"];
  live: boolean;
  startedAt: number;
  endedAt: number | null;
  startEur: number;
  valueEur: number;
  profitEur: number;
  /** valueEur ÷ startEur (1.5 = +50 %). */
  multiple: number;
  trades: number;
  closed: number;
  winRate: number | null;
  avgTradeEur: number | null;
  byStrategy: Record<StrategyId, { profitEur: number; trades: number; open: number; lastTradeAt: number | null }>;
  coins: (Pick<RoundTrip, "symbol" | "mint" | "strategy" | "pnlEur" | "pnlPct" | "exitTriggers" | "imageUrl"> & { closedAt: number })[];
  activity: {
    ts: number;
    side: "buy" | "sell";
    symbol: string;
    strategy: StrategyId;
    trigger: string;
    valueEur: number;
    pnlEur: number | null;
    imageUrl: string | null;
  }[];
  equity: { ts: number; eur: number }[];
}

const r2 = (x: number) => Math.round(x * 100) / 100;

export function sessionSummary(
  sess: RunSession,
  allTrades: Trade[],
  equity: EquityPoint[],
  positions: { pos: Position; valueEur: number }[],
  valueNowEur: number,
): SessionSummary {
  const live = !sess.endedAt;
  const end = sess.endedAt ?? Date.now();
  const trades = allTrades.filter((t) => t.mode === sess.mode && t.ts >= sess.startedAt && t.ts <= end);
  const held = new Set(positions.map((p) => p.pos.mint));
  const { closed } = roundTrips(trades, sess.mode, held);
  const valueEur = live ? valueNowEur : (sess.endEquityEur ?? valueNowEur);

  const byStrategy = Object.fromEntries(
    STRATEGY_IDS.map((id) => [id, { profitEur: 0, trades: 0, open: 0, lastTradeAt: null as number | null }]),
  ) as SessionSummary["byStrategy"];
  for (const t of trades) {
    const b = byStrategy[t.strategy ?? "momentum"];
    if (t.side === "buy") b.trades++;
    b.lastTradeAt = Math.max(b.lastTradeAt ?? 0, t.ts);
  }
  for (const rt of closed) byStrategy[rt.strategy].profitEur += rt.pnlEur;
  if (live) {
    // Open coins bought during this run count with their current (unrealised) result.
    for (const { pos, valueEur: v } of positions) {
      if (pos.openedAt < sess.startedAt) continue;
      const b = byStrategy[pos.strategy ?? "momentum"];
      b.open++;
      const realised = trades.filter((t) => t.side === "sell" && t.mint === pos.mint && t.ts >= pos.openedAt).reduce((a, t) => a + (t.pnlEur ?? 0), 0);
      b.profitEur += v - pos.costEur + realised;
    }
  }
  for (const id of STRATEGY_IDS) byStrategy[id].profitEur = r2(byStrategy[id].profitEur);

  const wins = closed.filter((x) => x.pnlEur > 0).length;
  const curve = equity.filter((e) => e.mode === sess.mode && e.ts >= sess.startedAt && e.ts <= end).map((e) => ({ ts: e.ts, eur: e.eur }));
  const step = Math.max(1, Math.ceil(curve.length / 200));
  const points = [{ ts: sess.startedAt, eur: sess.startEquityEur }, ...curve.filter((_, i) => i % step === 0), { ts: end, eur: valueEur }];

  return {
    id: sess.id,
    mode: sess.mode,
    live,
    startedAt: sess.startedAt,
    endedAt: sess.endedAt ?? null,
    startEur: r2(sess.startEquityEur),
    valueEur: r2(valueEur),
    profitEur: r2(valueEur - sess.startEquityEur),
    multiple: sess.startEquityEur > 0 ? Math.round((valueEur / sess.startEquityEur) * 1000) / 1000 : 1,
    trades: trades.filter((t) => t.side === "buy").length,
    closed: closed.length,
    winRate: closed.length ? Math.round((wins / closed.length) * 1000) / 1000 : null,
    avgTradeEur: closed.length ? r2(closed.reduce((a, x) => a + x.pnlEur, 0) / closed.length) : null,
    byStrategy,
    coins: [...closed]
      .sort((a, b) => b.pnlEur - a.pnlEur)
      .map((x) => ({
        symbol: x.symbol,
        mint: x.mint,
        strategy: x.strategy,
        pnlEur: r2(x.pnlEur),
        pnlPct: Math.round(x.pnlPct * 10) / 10,
        exitTriggers: x.exitTriggers,
        imageUrl: x.imageUrl,
        closedAt: x.closedAt,
      })),
    activity: [...trades]
      .reverse()
      .slice(0, 20)
      .map((t) => ({
        ts: t.ts,
        side: t.side,
        symbol: t.symbol,
        strategy: t.strategy ?? "momentum",
        trigger: t.trigger,
        valueEur: r2(t.valueEur),
        pnlEur: t.pnlEur !== undefined ? r2(t.pnlEur) : null,
        imageUrl: t.imageUrl ?? null,
      })),
    equity: points,
  };
}
