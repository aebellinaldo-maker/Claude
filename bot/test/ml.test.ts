import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { predictWith, type PilotModel } from "../src/ml/model.ts";
import { FEATURE_NAMES, featuresAt, outcomeAt, LOOKBACK, describeChart } from "../src/ml/features.ts";
import { mergeCandles, toGrid, STEP_SEC, type Candle } from "../src/ml/candles.ts";

test("tree evaluation matches LightGBM exactly (incl. missing values and zeros)", () => {
  const fx = JSON.parse(fs.readFileSync(new URL("./fixtures/lgbm-tiny.json", import.meta.url), "utf8"));
  const model = { trees: fx.trees } as PilotModel;
  for (const c of fx.cases as { x: (number | null)[]; p: number }[]) {
    const p = predictWith(model, c.x.map((v) => (v === null ? NaN : v)));
    assert.ok(Math.abs(p - c.p) < 1e-9, `${p} vs ${c.p}`);
  }
});

/** Synthetic 15-minute candles following a list of closes. */
function series(closes: number[], vol = 1000): Candle[] {
  return closes.map((c, i) => {
    const o = i ? closes[i - 1] : c;
    return [1_700_000_000 + i * STEP_SEC, o, Math.max(o, c) * 1.001, Math.min(o, c) * 0.999, c, vol] as Candle;
  });
}

test("chart features: a steady uptrend looks like an uptrend", () => {
  const closes = Array.from({ length: 120 }, (_, i) => 1 + i * 0.01);
  const g = series(closes);
  const x = featuresAt(g, g.length - 1)!;
  assert.equal(x.length, FEATURE_NAMES.length);
  const d = describeChart(x);
  assert.equal(d.trend, "up");
  assert.ok(d.rsi > 90, `RSI ${d.rsi}`);
  assert.ok(d.position_in_24h_range_pct >= 99);
  assert.ok(d.change_24h_pct > 0);
  // No look-ahead: features at i only depend on candles up to i.
  const xi = featuresAt(g, 100)!;
  const xiTrunc = featuresAt(g.slice(0, 101), 100)!;
  assert.deepEqual(xi, xiTrunc);
  // Not enough history → no features.
  assert.equal(featuresAt(g, LOOKBACK - 2), null);
});

test("outcome labels: take-profit, stop-loss, both-in-one-candle and timeout", () => {
  const base = Array.from({ length: 10 }, () => 1);
  const tp = series([...base, 1.1, 1.5]);
  assert.deepEqual(outcomeAt(tp, 9, 40, 15, 2), { win: 1, ret: 0.4, bars: 2 });
  const sl = series([...base, 0.95, 0.8]);
  assert.deepEqual(outcomeAt(sl, 9, 40, 15, 2), { win: 0, ret: -0.15, bars: 2 });
  // One candle touching both levels counts as a loss (we can't know which came first).
  const both = series([...base, 1, 1]);
  both[10] = [both[10][0], 1, 1.6, 0.5, 1, 1000];
  assert.equal(outcomeAt(both, 9, 40, 15, 2)!.win, 0);
  const flat = series([...base, 1.05, 1.1]);
  const o = outcomeAt(flat, 9, 40, 15, 2)!;
  assert.equal(o.win, 0);
  assert.ok(Math.abs(o.ret - 0.1) < 1e-9);
  // Not enough future candles → no label.
  assert.equal(outcomeAt(flat, 10, 40, 15, 2), null);
});

test("candle archive helpers: merge de-duplicates, grid fills missing 15-minute gaps", () => {
  const a: Candle[] = [
    [0, 1, 1, 1, 1, 5],
    [900, 1, 1, 1, 1.1, 5],
  ];
  const b: Candle[] = [
    [900, 1, 1, 1, 1.2, 7],
    [3600, 1.2, 1.3, 1.2, 1.3, 9],
  ];
  const m = mergeCandles(a, b);
  assert.deepEqual(
    m.map((c) => c[0]),
    [0, 900, 3600],
  );
  assert.equal(m[1][4], 1.2); // newer data wins
  const g = toGrid(m);
  assert.deepEqual(
    g.map((c) => c[0]),
    [0, 900, 1800, 2700, 3600],
  );
  assert.equal(g[2][5], 0); // filled candle: no volume
  assert.equal(g[2][4], 1.2); // flat at the previous close
});
