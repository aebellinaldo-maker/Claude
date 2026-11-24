import { test } from "node:test";
import assert from "node:assert/strict";
import { breakers, buySizeSol, exitSignal } from "../src/risk/rules.ts";
import { marketFilter } from "../src/risk/safety.ts";
import { scoreCandidate } from "../src/risk/scoring.ts";
import { DEFAULT_SETTINGS } from "../src/store.ts";
import type { Candidate, PortfolioState, Position } from "../src/types.ts";

const s = { ...DEFAULT_SETTINGS };
const HOUR = 3_600_000;
const now = 1_800_000_000_000;

function pos(over: Partial<Position> = {}): Position {
  return {
    mint: "M",
    symbol: "TEST",
    name: "Test",
    decimals: 6,
    rawAmount: "1000000",
    costSol: 0.05,
    costEur: 3.25,
    entryPriceUsd: 1,
    openedAt: now - HOUR,
    peakPriceUsd: 1,
    tookProfit: false,
    entryLiquidityUsd: 200_000,
    lastPriceUsd: 1,
    lastLiquidityUsd: 200_000,
    lastUpdate: now,
    reason: "",
    ...over,
  };
}

test("no exit while price is flat", () => {
  assert.equal(exitSignal(pos(), 1.02, 200_000, now, s).action, "none");
});

test("stop-loss sells everything at -15%", () => {
  const sig = exitSignal(pos(), 0.85, 200_000, now, s);
  assert.equal(sig.action, "sell");
  if (sig.action === "sell") {
    assert.equal(sig.trigger, "stop_loss");
    assert.equal(sig.pct, 100);
  }
});

test("take-profit sells half at +40%", () => {
  const sig = exitSignal(pos(), 1.41, 200_000, now, s);
  assert.equal(sig.action, "sell");
  if (sig.action === "sell") {
    assert.equal(sig.trigger, "take_profit");
    assert.equal(sig.pct, 50);
  }
});

test("trailing stop after take-profit", () => {
  const p = pos({ tookProfit: true, peakPriceUsd: 2 });
  const sig = exitSignal(p, 1.55, 200_000, now, s); // 22.5% below peak
  assert.equal(sig.action, "sell");
  if (sig.action === "sell") assert.equal(sig.trigger, "trailing_stop");
});

test("trailing stop protects a big unrealised gain even before take-profit", () => {
  const p = pos({ peakPriceUsd: 1.3 }); // was +30%, TP is 40% so trailing arms at +20%
  const sig = exitSignal(p, 1.02, 200_000, now, s); // ~21.5% below peak
  assert.equal(sig.action, "sell");
  if (sig.action === "sell") assert.equal(sig.trigger, "trailing_stop");
});

test("liquidity crash triggers a rug exit before anything else", () => {
  const sig = exitSignal(pos(), 1.5, 80_000, now, s);
  assert.equal(sig.action, "sell");
  if (sig.action === "sell") assert.equal(sig.trigger, "rug_exit");
});

test("time exit after max hold with no gain", () => {
  const sig = exitSignal(pos({ openedAt: now - 25 * HOUR }), 1.03, 200_000, now, s);
  assert.equal(sig.action, "sell");
  if (sig.action === "sell") assert.equal(sig.trigger, "time_exit");
});

test("position sizing respects max %, fee reserve and minimum", () => {
  // €10 ≈ 0.153 SOL. Max 40% per coin = 0.0612 SOL.
  assert.equal(buySizeSol({ equitySol: 0.153, freeSol: 0.153, sizePct: 100, s }), 0.0612);
  // Only 0.015 SOL free, reserve 0.012 → 0.003 < min trade 0.01 → no trade.
  assert.equal(buySizeSol({ equitySol: 0.153, freeSol: 0.015, sizePct: 100, s }), 0);
  // sizePct is clamped to at least 25%.
  assert.equal(buySizeSol({ equitySol: 0.153, freeSol: 0.153, sizePct: 5, s }), 0.0153);
});

function portfolio(start: number, peak: number, dayStart: number): PortfolioState {
  return { positions: [], startEquityEur: start, peakEquityEur: peak, day: { date: "x", startEquityEur: dayStart } };
}

test("daily loss limit stops new buys but not the bot", () => {
  const b = breakers(portfolio(10, 10, 10), 7.9, s);
  assert.equal(b.noNewBuys, true);
  assert.equal(b.killSwitch, false);
});

test("kill switch at 50% drawdown from the peak", () => {
  const b = breakers(portfolio(10, 14, 9), 6.9, s);
  assert.equal(b.killSwitch, true);
});

function cand(over: Partial<Candidate> = {}): Candidate {
  return {
    mint: "C",
    symbol: "MEME",
    name: "Meme",
    pairAddress: "P",
    dexId: "raydium",
    url: "",
    priceUsd: 0.01,
    liquidityUsd: 300_000,
    volume: { m5: 5_000, h1: 60_000, h6: 300_000, h24: 900_000 },
    priceChange: { m5: 1, h1: 8, h6: 20, h24: 60 },
    txns: { h1: { buys: 400, sells: 250 }, h24: { buys: 6000, sells: 5000 } },
    marketCapUsd: 5_000_000,
    fdvUsd: 5_000_000,
    pairCreatedAt: now - 72 * HOUR,
    ageHours: 72,
    socials: ["twitter", "telegram"],
    websites: 1,
    boostAmount: 100,
    sources: ["boost_top", "trending"],
    trendingRank: 3,
    ...over,
  };
}

test("market filter passes a healthy coin and rejects risky ones", () => {
  assert.deepEqual(marketFilter(cand(), s), []);
  assert.ok(marketFilter(cand({ liquidityUsd: 10_000 }), s).length > 0);
  assert.ok(marketFilter(cand({ ageHours: 2 }), s).length > 0);
  assert.ok(marketFilter(cand({ priceChange: { m5: 0, h1: 0, h6: 0, h24: 900 } }), s).length > 0);
  assert.ok(marketFilter(cand({ txns: { h1: { buys: 20, sells: 200 }, h24: { buys: 1, sells: 1 } } }), s).length > 0);
});

test("scoring prefers strong momentum + buy pressure over a dumping coin", () => {
  const good = scoreCandidate(cand()).score;
  const bad = scoreCandidate(
    cand({ priceChange: { m5: -2, h1: -12, h6: -20, h24: -30 }, txns: { h1: { buys: 100, sells: 300 }, h24: { buys: 1, sells: 1 } } }),
  ).score;
  assert.ok(good > bad, `${good} should be > ${bad}`);
  assert.ok(good > 0 && good <= 1);
});

import { autoStopReason, tradeable } from "../src/risk/rules.ts";

test("real-money budget caps what the bot can trade", () => {
  const eq = { cashSol: 1, totalSol: 1, positionsEur: 0, solEur: 65 }; // €65 in the wallet
  // No budget → the whole wallet.
  assert.deepEqual(tradeable(eq, s, "real"), { equitySol: 1, freeSol: 1 });
  // €13 budget → acts as if it had 0.2 SOL (+ fee reserve on top).
  const r = tradeable(eq, { ...s, realBudgetEur: 13 }, "real");
  assert.ok(Math.abs(r.equitySol - 0.2) < 1e-9);
  assert.ok(Math.abs(r.freeSol - (0.2 + s.feeReserveSol)) < 1e-9);
  // €6.50 already invested → only the rest of the budget is free.
  const r2 = tradeable({ ...eq, positionsEur: 6.5 }, { ...s, realBudgetEur: 13 }, "real");
  assert.ok(Math.abs(r2.freeSol - (0.1 + s.feeReserveSol)) < 1e-9);
  // Paper mode ignores the real-money budget.
  assert.deepEqual(tradeable(eq, { ...s, realBudgetEur: 13 }, "paper"), { equitySol: 1, freeSol: 1 });
});

test("auto-stop: profit target, loss limit and end time", () => {
  const now = 1_800_000_000_000;
  assert.equal(autoStopReason(50, now, s), null); // all off by default
  assert.ok(autoStopReason(21, now, { ...s, stopAtProfitPct: 20 }));
  assert.equal(autoStopReason(19, now, { ...s, stopAtProfitPct: 20 }), null);
  assert.ok(autoStopReason(-10, now, { ...s, stopAtLossPct: 10 }));
  assert.equal(autoStopReason(-9, now, { ...s, stopAtLossPct: 10 }), null);
  assert.ok(autoStopReason(0, now, { ...s, stopAt: now - 1 }));
  assert.equal(autoStopReason(0, now, { ...s, stopAt: now + 60_000 }), null);
});
