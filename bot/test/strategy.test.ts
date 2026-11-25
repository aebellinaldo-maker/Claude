import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveSettings, MOONSHOT } from "../src/risk/profiles.ts";
import { exitStats, monteCarlo, simulateExit } from "../src/backtest/exits.ts";
import { roundTrips, tradeStats } from "../src/engine/stats.ts";
import { DEFAULT_SETTINGS } from "../src/store.ts";
import type { Candle } from "../src/ml/candles.ts";
import type { Trade } from "../src/types.ts";

const s = { ...DEFAULT_SETTINGS };
const NORMAL = { stopLossPct: 15, takeProfitPct: 40, takeProfitSellPct: 50, trailingStopPct: 20, maxHoldHours: 24 };

test("normal mode trades with the owner's settings; moonshot overrides exits and sizing", () => {
  assert.equal(effectiveSettings(s), s);
  const m = effectiveSettings({ ...s, riskMode: "moonshot" });
  assert.equal(m.stopLossPct, MOONSHOT.stopLossPct);
  assert.equal(m.takeProfitPct, MOONSHOT.takeProfitPct);
  assert.equal(m.trailingStopPct, MOONSHOT.trailingStopPct);
  assert.ok(m.maxPositions < s.maxPositions && m.maxPositionPct > s.maxPositionPct);
  // Safety nets stay as the owner set them.
  assert.equal(m.maxDrawdownPct, s.maxDrawdownPct);
  assert.equal(m.maxDailyLossPct, s.maxDailyLossPct);
});

// 15-minute candles [ts, open, high, low, close, volume] from a list of closes (tight wicks).
function grid(closes: number[]): Candle[] {
  return closes.map((c, i) => [1_700_000_000 + i * 900, i ? closes[i - 1] : c, Math.max(c, i ? closes[i - 1] : c), Math.min(c, i ? closes[i - 1] : c), c, 1000]);
}

test("back-test applies the real exit rules: stop-loss", () => {
  const r = simulateExit(grid([1, 1, 0.95, 0.9, 0.8, 0.7, 0.7]), 0, NORMAL, s, { feePct: 0 })!;
  assert.ok(Math.abs(r.ret - -0.15) < 1e-9, `stop-loss fills at -15%, got ${r.ret}`);
});

test("back-test: take-profit sells half, trailing stop sells the rest", () => {
  // +50% (TP at +40% sells half at 1.4), peak 2.0, then down to 1.5 (trailing 20% from 2.0 = 1.6)
  const r = simulateExit(grid([1, 1.2, 1.5, 1.8, 2.0, 1.5, 1.5]), 0, NORMAL, s, { feePct: 0 })!;
  assert.ok(Math.abs(r.ret - (0.5 * 1.4 + 0.5 * 1.6 - 1)) < 1e-9, `got ${r.ret}`);
  assert.ok(Math.abs(r.peakRet - 1) < 1e-9);
});

test("back-test: a stop the candle gaps through fills at the open", () => {
  const g = grid([1, 1, 1]);
  g.push([g[2][0] + 900, 0.5, 0.5, 0.4, 0.45, 1000]);
  for (let k = 0; k < 3; k++) g.push([g[g.length - 1][0] + 900, 0.45, 0.45, 0.45, 0.45, 1000]);
  const r = simulateExit(g, 0, NORMAL, s, { feePct: 0 })!;
  assert.ok(Math.abs(r.ret - -0.5) < 1e-9, `got ${r.ret}`);
});

test("exit stats and Monte Carlo", () => {
  const st = exitStats([-0.15, -0.15, 0.4, 1.2, 5]);
  assert.equal(st.trades, 5);
  assert.equal(st.doubled, 0.4);
  assert.equal(st.fiveX, 0.2);
  // Every trade +100% all-in: 10x is reached; a stake of 0 never moves.
  assert.equal(monteCarlo([1], 1, 5, 10).reach10x, 1);
  assert.equal(monteCarlo([-0.5, 1], 0, 50, 10).medianEnd, 1);
});

function trade(over: Partial<Trade>): Trade {
  return { id: Math.random().toString(), ts: 0, mode: "paper", side: "buy", mint: "A", symbol: "AAA", solAmount: 0.1, tokenAmount: 1, priceUsd: 1, valueEur: 10, trigger: "ai", reason: "", ...over };
}

test("round trips: partial sells add up; open positions are not counted", () => {
  const trades = [
    trade({ ts: 1, side: "buy", mint: "A", valueEur: 10, reason: "breakout" }),
    trade({ ts: 2, side: "sell", mint: "A", trigger: "take_profit", pnlEur: 2 }),
    trade({ ts: 3, side: "sell", mint: "A", trigger: "trailing_stop", pnlEur: 1 }),
    trade({ ts: 4, side: "buy", mint: "B", symbol: "BBB", valueEur: 5 }),
    trade({ ts: 5, side: "sell", mint: "B", symbol: "BBB", trigger: "stop_loss", pnlEur: -0.75 }),
    trade({ ts: 6, side: "buy", mint: "C", symbol: "CCC" }), // still held
    trade({ ts: 7, side: "buy", mint: "D", symbol: "DDD", mode: "real" }), // other mode
  ];
  const { closed, open } = roundTrips(trades, "paper", new Set(["C"]));
  assert.equal(closed.length, 2);
  assert.equal(open, 1);
  assert.equal(closed[0].pnlEur, 3);
  assert.equal(closed[0].pnlPct, 30);
  assert.deepEqual(closed[0].exitTriggers, ["take_profit", "trailing_stop"]);
  assert.equal(closed[0].why, "breakout");
  assert.equal(closed[1].pnlPct, -15);

  const st = tradeStats(trades, "paper", new Set(["C"]));
  assert.equal(st.closed, 2);
  assert.equal(st.winRate, 0.5);
  assert.equal(st.profitFactor, 4);
  assert.equal(st.realizedEur, 2.25);
  assert.equal(st.verdict, "too_early");
  assert.equal(st.best?.symbol, "AAA");
  assert.equal(st.recent[0].symbol, "BBB"); // newest first
});

test("verdict needs enough trades", () => {
  const many: Trade[] = [];
  for (let i = 0; i < 30; i++) {
    many.push(trade({ ts: i * 10, side: "buy", mint: `M${i}`, valueEur: 10 }));
    many.push(trade({ ts: i * 10 + 1, side: "sell", mint: `M${i}`, pnlEur: i % 2 ? 3 : -1 }));
  }
  assert.equal(tradeStats(many, "paper", new Set()).verdict, "good");
  const losing = many.map((t) => (t.side === "sell" ? { ...t, pnlEur: -(t.pnlEur ?? 0) } : t));
  assert.equal(tradeStats(losing, "paper", new Set()).verdict, "losing");
});
