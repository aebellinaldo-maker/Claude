import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bestSignal,
  dipEntry,
  exitSettings,
  holderReasons,
  momentumSignal,
  sniperFilter,
  sniperSignal,
  standings,
  whaleSignal,
} from "../src/strategies/squad.ts";
import { gradeWhaleBuys, isSmartWallet, summariseTrades, whaleThresholdUsd } from "../src/market/whales.ts";
import { holderInfoFromReport } from "../src/market/rugcheck.ts";
import { sessionSummary } from "../src/engine/session.ts";
import { MOONSHOT } from "../src/risk/profiles.ts";
import { DEFAULT_SETTINGS } from "../src/store.ts";
import type { Candidate, HolderInfo, Position, Trade, WhaleBook } from "../src/types.ts";

const s = { ...DEFAULT_SETTINGS };
const NOW = 1_800_000_000_000;

function cand(over: Partial<Candidate> = {}): Candidate {
  return {
    mint: "M",
    symbol: "NEW",
    name: "New",
    pairAddress: "P",
    dexId: "pumpswap",
    url: "",
    priceUsd: 0.001,
    liquidityUsd: 40_000,
    volume: { m5: 5_000, h1: 60_000, h6: 150_000, h24: 150_000 },
    priceChange: { m5: 2, h1: 35, h6: 60, h24: 60 },
    txns: { h1: { buys: 400, sells: 220 }, h24: { buys: 900, sells: 500 } },
    marketCapUsd: 300_000,
    fdvUsd: 300_000,
    pairCreatedAt: 0,
    ageHours: 3,
    socials: ["twitter", "telegram"],
    websites: 1,
    boostAmount: 0,
    sources: ["new_launch"],
    ...over,
  };
}

const cleanHolders: HolderInfo = { holders: 1800, top10Pct: 18, maxHolderPct: 4, creatorPct: 0, mintRevoked: true, freezeRevoked: true, lpLockedPct: 100 };

test("sniper filter: age window, liquidity, buyers", () => {
  assert.deepEqual(sniperFilter(cand(), s), []);
  assert.ok(sniperFilter(cand({ ageHours: 0.1 }), s).length);
  assert.ok(sniperFilter(cand({ ageHours: 13 }), s).length);
  assert.ok(sniperFilter(cand({ liquidityUsd: 9_000 }), s).length);
  assert.ok(sniperFilter(cand({ txns: { h1: { buys: 100, sells: 150 }, h24: { buys: 1, sells: 1 } } }), s).length);
  assert.ok(sniperFilter(cand({ priceChange: { m5: -20, h1: 10, h6: 10, h24: 10 } }), s).length);
});

test("holder check rejects developer powers and concentrated supply", () => {
  assert.deepEqual(holderReasons(cleanHolders, s), []);
  assert.ok(holderReasons({ ...cleanHolders, mintRevoked: false }, s).length);
  assert.ok(holderReasons({ ...cleanHolders, freezeRevoked: false }, s).length);
  assert.ok(holderReasons({ ...cleanHolders, top10Pct: 50 }, s).length);
  assert.ok(holderReasons({ ...cleanHolders, maxHolderPct: 20 }, s).length);
  assert.ok(holderReasons({ ...cleanHolders, holders: 60 }, s).length);
  assert.ok(holderReasons({ ...cleanHolders, lpLockedPct: 0 }, s).length, "unlocked liquidity");
  assert.ok(holderReasons({ ...cleanHolders, lpLockedPct: undefined }, s).length, "unknown lock");
  assert.ok(holderReasons(undefined, s).length);
});

test("holder info ignores pools and lockers", () => {
  const h = holderInfoFromReport({
    totalHolders: 900,
    token: { supply: 1_000_000 },
    creatorBalance: 20_000,
    topHolders: [
      { owner: "POOL", pct: 30 },
      { owner: "LOCK", pct: 10 },
      { owner: "a", pct: 5 },
      { owner: "b", pct: 3 },
    ],
    knownAccounts: { POOL: { type: "AMM" }, LOCK: { type: "LOCKER" } },
    markets: [{ lp: { lpLockedPct: 100 } }],
  });
  assert.equal(h.top10Pct, 8);
  assert.equal(h.maxHolderPct, 5);
  assert.equal(h.creatorPct, 2);
  assert.equal(h.mintRevoked, true);
  assert.equal(h.lpLockedPct, 100);
});

test("sniper signal needs a clean holder check", () => {
  assert.equal(sniperSignal(cand(), s), null);
  const sig = sniperSignal(cand({ holders: cleanHolders }), s)!;
  assert.equal(sig.strategy, "sniper");
  assert.ok(sig.strength > 0.5 && sig.strength <= 1, `strength ${sig.strength}`);
  assert.ok(sig.notes.some((n) => n.includes("holders")));
});

test("dip entry: uptrend, pulled back, cooled off, bouncing", () => {
  const good = { trend: "up", rsi: 38, belowHighPct: 24, change15mPct: 2, change1hPct: -3, change24hPct: 60 };
  assert.ok((dipEntry(good) ?? 0) > 0.5);
  assert.equal(dipEntry({ ...good, change15mPct: -1 }), null, "no bounce yet");
  assert.equal(dipEntry({ ...good, belowHighPct: 5 }), null, "no real pullback");
  assert.equal(dipEntry({ ...good, belowHighPct: 60 }), null, "that's a crash, not a dip");
  assert.equal(dipEntry({ ...good, change24hPct: 2 }), null, "no uptrend");
  assert.equal(dipEntry({ ...good, rsi: 70 }), null, "not cooled off");
});

test("whale signal: several big buyers, buys outweigh sells, price not run yet", () => {
  const w = { windowMin: 60, thresholdUsd: 1000, bigBuys: 6, bigSells: 1, buyUsd: 9000, sellUsd: 1200, whales: 4, smartWallets: 1, wallets: [], checkedAt: NOW };
  const sig = whaleSignal(cand({ ageHours: 48, whales: w, priceChange: { m5: 1, h1: 12, h6: 20, h24: 30 } }), s)!;
  assert.equal(sig.strategy, "whale");
  assert.ok(sig.notes.some((n) => n.includes("smart money")));
  assert.equal(whaleSignal(cand({ whales: { ...w, whales: 1 } }), s), null);
  assert.equal(whaleSignal(cand({ whales: { ...w, sellUsd: 6000 } }), s), null);
  assert.equal(whaleSignal(cand({ whales: w, priceChange: { m5: 1, h1: 80, h6: 90, h24: 90 } }), s), null);
});

test("best signal picks the strongest enabled strategy", () => {
  const c = cand({ ageHours: 48 });
  const all = bestSignal(c, s, new Set(["momentum", "dip", "whale"]));
  assert.equal(all?.strategy, "momentum");
  assert.equal(bestSignal(c, s, new Set(["dip"])), null);
  assert.ok(momentumSignal(cand({ priceChange: { m5: 0, h1: -3, h6: -5, h24: 0 } }), s)!.strength < momentumSignal(c, s)!.strength);
});

test("each strategy has its own exits; moonshot overrides all", () => {
  assert.equal(exitSettings(s, "momentum").stopLossPct, s.stopLossPct);
  assert.equal(exitSettings(s, "dip").stopLossPct, 20);
  assert.equal(exitSettings(s, "dip").maxHoldHours, 12);
  assert.equal(exitSettings(s, "sniper").takeProfitPct, 100);
  assert.equal(exitSettings(s, undefined).takeProfitPct, s.takeProfitPct);
  assert.equal(exitSettings({ ...s, riskMode: "moonshot" }, "dip").stopLossPct, MOONSHOT.stopLossPct);
});

test("whale trades: only big trades in the last hour count; buyers are remembered", () => {
  const t = (kind: "buy" | "sell", usd: number, wallet: string, minAgo: number, price = 1) => ({
    attributes: { kind, volume_in_usd: String(usd), tx_from_address: wallet, block_timestamp: new Date(NOW - minAgo * 60_000).toISOString(), price_to_in_usd: String(price), price_from_in_usd: String(price) },
  });
  const book: WhaleBook = { pending: [], wallets: { w1: { n: 4, wins: 3, sumRet: 1.2, last: 0 } } };
  const { info, buys } = summariseTrades([t("buy", 2000, "w1", 5), t("buy", 1500, "w2", 10), t("buy", 1500, "w2", 12), t("sell", 1200, "w3", 20), t("buy", 500, "w4", 3), t("buy", 9000, "w5", 90)], 1000, NOW, book);
  assert.equal(info.bigBuys, 3);
  assert.equal(info.whales, 2);
  assert.equal(info.buyUsd, 5000);
  assert.equal(info.sellUsd, 1200);
  assert.equal(info.smartWallets, 1);
  assert.equal(buys.length, 2);
  assert.equal(whaleThresholdUsd(50_000), 1000);
  assert.equal(whaleThresholdUsd(500_000), 5000);
  assert.equal(whaleThresholdUsd(50_000_000), 25_000);
});

test("whale book learns which wallets buy before rises", () => {
  const book: WhaleBook = { pending: [], wallets: {} };
  const H = 3_600_000;
  for (let i = 0; i < 3; i++) book.pending.push({ wallet: "smart", mint: `m${i}`, priceUsd: 1, ts: NOW - 7 * H });
  book.pending.push({ wallet: "dumb", mint: "m0", priceUsd: 2, ts: NOW - 7 * H });
  book.pending.push({ wallet: "fresh", mint: "m0", priceUsd: 1, ts: NOW - 1 * H });
  const n = gradeWhaleBuys(book, { m0: 1.5, m1: 1.3, m2: 0.95 }, NOW);
  assert.equal(n, 4);
  assert.equal(book.pending.length, 1, "the 1-hour-old buy waits");
  assert.equal(isSmartWallet(book.wallets.smart), true);
  assert.equal(isSmartWallet(book.wallets.dumb), false);
});

function trade(over: Partial<Trade>): Trade {
  return { id: Math.random().toString(), ts: NOW, mode: "paper", side: "buy", mint: "A", symbol: "AAA", solAmount: 0.1, tokenAmount: 1, priceUsd: 1, valueEur: 10, trigger: "ai", reason: "", ...over };
}

test("allocator: winners get more money, losers less; real-money losers are benched", () => {
  const trades: Trade[] = [];
  for (let i = 0; i < 16; i++) {
    trades.push(trade({ ts: i * 10, mint: `W${i}`, strategy: "whale" }), trade({ ts: i * 10 + 1, side: "sell", mint: `W${i}`, strategy: "whale", pnlEur: i % 2 ? 4 : -1 }));
    trades.push(trade({ ts: i * 10 + 2, mint: `D${i}`, strategy: "dip" }), trade({ ts: i * 10 + 3, side: "sell", mint: `D${i}`, strategy: "dip", pnlEur: i % 4 ? -2 : 1 }));
  }
  const paper = standings(trades, "paper", new Set());
  assert.ok(paper.whale.weight > 1);
  assert.ok(paper.dip.weight < 1);
  assert.equal(paper.sniper.weight, 1, "no trades yet → neutral");
  assert.equal(paper.dip.benched, false, "paper keeps learning");
  const real = standings(trades.map((t) => ({ ...t, mode: "real" as const })), "real", new Set());
  assert.equal(real.dip.benched, true);
  assert.equal(real.whale.benched, false);
});

test("run summary: profit per strategy, coin list, open positions count live", () => {
  const H = 3_600_000;
  const NOW = Date.now(); // a live run ends "now"
  const sess = { id: "s1", mode: "paper" as const, startedAt: NOW - 4 * H, startEquityEur: 10 };
  const trades = [
    trade({ ts: NOW - 5 * H, mint: "OLD", symbol: "OLD", strategy: "momentum" }), // before the run
    trade({ ts: NOW - 3 * H, mint: "VICE", symbol: "VICE", strategy: "dip", valueEur: 3 }),
    trade({ ts: NOW - 2 * H, side: "sell", mint: "VICE", symbol: "VICE", strategy: "dip", trigger: "take_profit", pnlEur: 6 }),
    trade({ ts: NOW - 2.5 * H, mint: "FOX", symbol: "FOX", strategy: "momentum", valueEur: 3 }),
    trade({ ts: NOW - 2.2 * H, side: "sell", mint: "FOX", symbol: "FOX", strategy: "momentum", trigger: "stop_loss", pnlEur: -0.45 }),
    trade({ ts: NOW - 1 * H, mint: "BUCK", symbol: "BUCK", strategy: "whale", valueEur: 4 }),
  ];
  const pos = { mint: "BUCK", strategy: "whale", openedAt: NOW - 1 * H, costEur: 4 } as Position;
  const sum = sessionSummary(sess, trades, [], [{ pos, valueEur: 5 }], 16.55);
  assert.equal(sum.live, true);
  assert.equal(sum.trades, 3);
  assert.equal(sum.closed, 2);
  assert.equal(sum.profitEur, 6.55);
  assert.equal(sum.byStrategy.dip.profitEur, 6);
  assert.equal(sum.byStrategy.momentum.profitEur, -0.45);
  assert.equal(sum.byStrategy.whale.profitEur, 1);
  assert.equal(sum.byStrategy.whale.open, 1);
  assert.equal(sum.coins[0].symbol, "VICE");
  assert.equal(sum.winRate, 0.5);
  assert.equal(sum.activity[0].symbol, "BUCK");
  assert.equal(sum.equity[0].eur, 10);
});

test("high win rate mode: sells everything at +10 %, stop −30 %, only strong coins", async () => {
  const { winrateEntryOk } = await import("../src/strategies/squad.ts");
  const { simulateExit } = await import("../src/backtest/exits.ts");
  const w = { ...s, riskMode: "winrate" as const };
  const x = exitSettings(w, "dip");
  assert.equal(x.takeProfitPct, 10);
  assert.equal(x.takeProfitSellPct, 100);
  assert.equal(x.stopLossPct, 30);
  // Price goes +4 %, +12 % → the whole position is sold at +10 %.
  const closes = [1, 1.04, 1.12, 1.2, 1.3];
  const grid = closes.map((c, i) => [1_700_000_000 + i * 900, i ? closes[i - 1] : c, Math.max(c, i ? closes[i - 1] : c), Math.min(c, i ? closes[i - 1] : c), c, 1000] as [number, number, number, number, number, number]);
  for (let k = 0; k < 4; k++) grid.push([grid[grid.length - 1][0] + 900, 1.3, 1.3, 1.3, 1.3, 1000]);
  const r = simulateExit(grid, 0, x, s, { feePct: 0 })!;
  assert.ok(Math.abs(r.ret - 0.1) < 1e-9, `got ${r.ret}`);

  const strong = cand({ ageHours: 48, priceChange: { m5: 1, h1: 5, h6: 20, h24: 55 } });
  assert.equal(winrateEntryOk(strong, "dip"), true);
  assert.equal(winrateEntryOk({ ...strong, priceChange: { ...strong.priceChange, h24: 25 } }, "dip"), false, "not strong enough");
  assert.equal(winrateEntryOk(strong, "momentum"), false, "momentum needs the tested chart rule");
  const chart = { trend: "up", rsi: 62, change_1h_pct: 5, volume_vs_avg_1h: 1.6 };
  assert.equal(winrateEntryOk({ ...strong, chart }, "momentum"), true);
  assert.equal(winrateEntryOk({ ...strong, chart: { ...chart, rsi: 85 } }, "momentum"), false);
  assert.equal(winrateEntryOk(strong, "sniper"), false, "untested strategies sit out");
});
