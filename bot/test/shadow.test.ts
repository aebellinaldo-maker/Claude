import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTO_MIN_RESULTS, emptyShadowBook, openShadow, shadowSummary, statOf, stepShadow, updateShadows, type ShadowResult } from "../src/engine/shadow.ts";
import { sniperFilter, standings } from "../src/strategies/squad.ts";
import { DEFAULT_SETTINGS } from "../src/store.ts";
import type { Candidate, StrategyId, StrategySignal } from "../src/types.ts";

const s = { ...DEFAULT_SETTINGS, riskMode: "normal" as const };
const H = 3_600_000;
const T0 = 1_800_000_000_000;

function cand(over: Partial<Candidate> = {}): Candidate {
  return {
    mint: "M",
    symbol: "COIN",
    name: "Coin",
    pairAddress: "P",
    dexId: "raydium",
    url: "",
    priceUsd: 1,
    liquidityUsd: 100_000,
    volume: { m5: 1_000, h1: 50_000, h6: 200_000, h24: 500_000 },
    priceChange: { m5: 1, h1: 4, h6: 20, h24: 60 },
    txns: { h1: { buys: 300, sells: 200 }, h24: { buys: 3000, sells: 2500 } },
    marketCapUsd: 2_000_000,
    fdvUsd: 2_000_000,
    pairCreatedAt: 0,
    ageHours: 72,
    socials: [],
    websites: 0,
    boostAmount: 0,
    sources: ["trending"],
    ...over,
  };
}
const sig = (strategy: StrategyId, strength = 0.7): StrategySignal => ({ strategy, strength, notes: [] });

test("one virtual trade per coin and strategy (2 h), entry from the first live price", () => {
  const book = emptyShadowBook();
  assert.equal(openShadow(book, cand(), sig("dip"), T0), true);
  assert.equal(openShadow(book, cand(), sig("dip"), T0 + 60_000), false, "duplicate");
  assert.equal(openShadow(book, cand(), sig("whale"), T0), true, "other strategy is separate");
  assert.equal(openShadow(book, cand(), sig("dip"), T0 + 3 * H), true, "again after 2 h");
  const t = book.open[0];
  assert.equal(t.entryUsd, undefined);
  stepShadow(t, 2, T0 + 60_000, s);
  assert.equal(t.entryUsd, 2);
  assert.equal(t.winrateOk, true, "dip on a coin up 60% in 24h");
});

test("each variant plays out with its own exits", () => {
  const book = emptyShadowBook();
  openShadow(book, cand(), sig("dip"), T0);
  const t = book.open[0];
  // entry 1.00 → 1.12 → 1.70 → 1.30
  const path = [1, 1.12, 1.7, 1.3];
  path.forEach((p, i) => stepShadow(t, p, T0 + (i + 1) * 60_000, s));
  // High win rate: sells everything at the first price ≥ +10 % (1.12).
  assert.ok(Math.abs(t.legs.winrate.ret! - (1.12 * 0.99 - 1)) < 1e-9, `winrate ${t.legs.winrate.ret}`);
  // Dip Hunter normal exits: half sold at ≥ +60 % (1.70); the rest still open, trailing stop
  // 15 % below the 1.70 peak (1.445) → the drop to 1.30 sells it.
  assert.ok(Math.abs(t.legs.normal.ret! - ((0.5 * 1.7 + 0.5 * 1.3) * 0.99 - 1)) < 1e-9, `normal ${t.legs.normal.ret}`);
  // Moonshot (sells 35 % at +200 %): nothing has triggered yet.
  assert.equal(t.legs.moonshot.ret, undefined);
});

test("finished virtual trades are filed; ones without any price are dropped", () => {
  const book = emptyShadowBook();
  openShadow(book, cand({ mint: "A" }), sig("dip"), T0);
  openShadow(book, cand({ mint: "B" }), sig("dip"), T0);
  updateShadows(book, { A: 1 }, T0 + 60_000, s);
  updateShadows(book, { A: 0.6 }, T0 + 120_000, s); // −40 %: every variant's stop-loss
  assert.equal(book.closed.length, 1);
  assert.equal(book.closed[0].mint, "A");
  assert.ok(book.closed[0].ret.winrate < -0.3);
  updateShadows(book, {}, T0 + 7 * H, s); // B never got a price
  assert.equal(book.open.length, 0);
});

test("mode comparison: High win rate only counts its allowed signals; Auto waits for enough data", () => {
  const book = emptyShadowBook();
  const add = (strategy: StrategyId, winrateOk: boolean, normal: number, winrate: number, moonshot: number) =>
    book.closed.push({ mint: "m", symbol: "m", strategy, strength: 0.7, ts: T0, closedAt: T0, winrateOk, ret: { normal, winrate, moonshot } } as ShadowResult);
  for (let i = 0; i < AUTO_MIN_RESULTS; i++) {
    add("dip", true, -0.02, 0.03, -0.05);
    add("sniper", false, 0.01, -0.3, 0.2); // not allowed in High win rate mode → ignored there
  }
  const sum = shadowSummary(book, T0, new Set(["dip", "sniper"]), "winrate");
  assert.equal(sum.byMode.winrate.n, AUTO_MIN_RESULTS);
  assert.equal(sum.byMode.winrate.avgPct, 3);
  assert.equal(sum.byMode.normal.n, 2 * AUTO_MIN_RESULTS);
  assert.equal(sum.bestMode, "moonshot", "moonshot averages (−5 + 20)/2 = +7.5 %");
  assert.equal(sum.current.sniper.n, 0, "sniper doesn't trade in this mode");
  assert.equal(sum.current.dip.n, AUTO_MIN_RESULTS);
  const few = emptyShadowBook();
  few.closed = book.closed.slice(0, 10);
  assert.equal(shadowSummary(few, T0, new Set(["dip", "sniper"]), "normal").bestMode, null);
  assert.equal(statOf([0.1, -0.05]).profitFactor, 2);
});

test("allocator uses the live test until a strategy has its own trades", () => {
  const st = standings([], "paper", new Set(), { whale: { n: 25, profitFactor: 2 }, sniper: { n: 25, profitFactor: 0.3 } });
  assert.equal(st.whale.basis, "shadow");
  assert.ok(st.whale.weight > 1);
  assert.ok(st.sniper.weight < 1);
  assert.equal(st.dip.basis, "none");
  assert.equal(st.dip.weight, 1);
  const real = standings([], "real", new Set(), { sniper: { n: 45, profitFactor: 0.4 } });
  assert.equal(real.sniper.benched, true, "real money: a strategy losing in the live test sits out");
  assert.equal(standings([], "paper", new Set(), { sniper: { n: 45, profitFactor: 0.4 } }).sniper.benched, false);
});

test("sniper doesn't chase a 5-minute spike", () => {
  const young = cand({ ageHours: 3, liquidityUsd: 40_000, marketCapUsd: 300_000, txns: { h1: { buys: 400, sells: 200 }, h24: { buys: 900, sells: 500 } } });
  assert.deepEqual(sniperFilter(young, s), []);
  assert.ok(sniperFilter({ ...young, priceChange: { ...young.priceChange, m5: 18 } }, s).some((r) => r.includes("spiking")));
});

test("urgent sells retry with more slippage and priority; normal sells try once", async () => {
  const { sellAttempts } = await import("../src/engine/executor.ts");
  assert.deepEqual(sellAttempts(150, false).map((a) => a.slippageBps), [300]);
  const urgent = sellAttempts(150, true);
  assert.deepEqual(urgent.map((a) => a.slippageBps), [300, 800, 1500]);
  assert.deepEqual(urgent.map((a) => a.priority), ["high", "veryHigh", "veryHigh"]);
  assert.ok(urgent[2].maxPriorityLamports > urgent[0].maxPriorityLamports);
  assert.deepEqual(sellAttempts(1000, true).map((a) => a.slippageBps), [1000, 1000, 1500], "never below the owner's own setting");
});

test("self-tuning: a cut-off is learned only when it clearly beats taking every signal", async () => {
  const { learnedThreshold } = await import("../src/engine/shadow.ts");
  const book = emptyShadowBook();
  const add = (strength: number, ret: number) =>
    book.closed.push({ mint: "m", symbol: "m", strategy: "sniper", strength, ts: T0, closedAt: T0, winrateOk: false, ret: { normal: ret, winrate: ret, moonshot: ret } } as ShadowResult);
  for (let i = 0; i < 25; i++) add(0.5, -0.08); // weak signals lose
  for (let i = 0; i < 25; i++) add(0.75, 0.06); // strong ones win
  const lt = learnedThreshold(book, T0, "sniper", "normal");
  assert.equal(lt.minStrength, 0.6);
  assert.equal(lt.n, 25);
  assert.equal(lt.avgPct, 6);
  assert.equal(lt.allAvgPct, -1);
  // Too few results, or no clear gain → no cut-off.
  const small = emptyShadowBook();
  small.closed = book.closed.slice(0, 10);
  assert.equal(learnedThreshold(small, T0, "sniper", "normal").minStrength, null);
  const flat = emptyShadowBook();
  for (let i = 0; i < 40; i++) flat.closed.push({ ...book.closed[0], strength: i % 2 ? 0.5 : 0.75, ret: { normal: 0.02, winrate: 0.02, moonshot: 0.02 } });
  assert.equal(learnedThreshold(flat, T0, "sniper", "normal").minStrength, null);
});

test("only trade what's winning: paper pauses proven losers, real money needs proven winners", async () => {
  const { edgeCheck, EDGE_MIN_RESULTS } = await import("../src/strategies/squad.ts");
  const N = EDGE_MIN_RESULTS;
  assert.equal(edgeCheck({ n: 5, avgPct: -8 }, "paper", "en").ok, true, "too early to judge");
  assert.equal(edgeCheck({ n: N, avgPct: -2 }, "paper", "en").ok, false, "losing → sits out");
  assert.match(edgeCheck({ n: N, avgPct: -2 }, "paper", "en").reason!, /losing/);
  assert.equal(edgeCheck({ n: N, avgPct: 1.5 }, "paper", "en").ok, true);
  assert.equal(edgeCheck({ n: 5, avgPct: 9 }, "real", "en").ok, false, "real money: not proven yet");
  assert.equal(edgeCheck({ n: N, avgPct: 0 }, "real", "en").ok, false, "break-even isn't a proven profit");
  assert.equal(edgeCheck({ n: N, avgPct: 2 }, "real", "en").ok, true);
  assert.equal(edgeCheck(undefined, "paper", "en").ok, true);
});

test("default run goal: +10 % sells everything and stops", async () => {
  const { autoStopReason } = await import("../src/risk/rules.ts");
  assert.equal(DEFAULT_SETTINGS.stopAtProfitPct, 10);
  assert.equal(DEFAULT_SETTINGS.closeOnStop, true);
  assert.match(autoStopReason(10.2, T0, DEFAULT_SETTINGS) ?? "", /Profit target/);
  assert.equal(autoStopReason(9.9, T0, DEFAULT_SETTINGS), null);
});
