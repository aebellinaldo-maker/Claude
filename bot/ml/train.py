"""
Trains the bot's own trading model ("Pilot ML") with LightGBM.

Input : data/ml/dataset.jsonl   (built by the bot from its chart archive)
Output: data/ml/model.json      (trees + feature names + honest test results)

Question the model answers: "If the bot buys this coin now, will it reach the
take-profit before the stop-loss within the next 24 hours?"

Evaluation is walk-forward: the model is trained on older data and tested on the
most recent period it has never seen, with a gap in between so no future
information leaks into training. It is compared with two baselines:
buying every coin, and a simple momentum rule.

Usage: python ml/train.py <data_dir> '<json options>'
"""
import json
import math
import sys
import time
from pathlib import Path

import lightgbm as lgb
import numpy as np

data_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "./data")
opts = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
FEATURES = opts["featureNames"]
TP = float(opts["tpPct"])
SL = float(opts["slPct"])
HORIZON_BARS = int(opts["horizonBars"])
FEE = float(opts.get("feePct", 1.0)) / 100  # round-trip fees + slippage
BAR_SEC = 900


def say(msg):
    print(msg, flush=True)


# ---------------------------------------------------------------- load
rows = [json.loads(l) for l in (data_dir / "ml" / "dataset.jsonl").read_text().splitlines() if l.strip()]
if len(rows) < 500:
    raise SystemExit(f"Not enough data yet ({len(rows)} samples, need 500+). Let the bot collect more charts.")
rows.sort(key=lambda r: r["t"])
t = np.array([r["t"] for r in rows], dtype=np.int64)
X = np.array([[np.nan if v is None else v for v in r["x"]] for r in rows], dtype=np.float64)
y = np.array([r["y"] for r in rows], dtype=np.int32)
ret = np.array([r["r"] for r in rows], dtype=np.float64) - FEE
coins = {r["c"] for r in rows}
say(f"Loaded {len(rows)} samples from {len(coins)} coins, {(t[-1] - t[0]) / 86400:.1f} days, base win rate {y.mean():.1%}")

# ---------------------------------------------------------------- splits (by time, with an embargo gap)
embargo = HORIZON_BARS * BAR_SEC
t_test = np.quantile(t, 0.75)
train_all = t < t_test - embargo
test = t >= t_test
t_valid = np.quantile(t[train_all], 0.8)
train = train_all & (t < t_valid - embargo)
valid = train_all & (t >= t_valid)
say(f"Train {train.sum()} · validation {valid.sum()} · test {test.sum()} (test = last {(t[-1] - t_test) / 86400:.1f} days, never seen in training)")
if train.sum() < 300 or valid.sum() < 100 or test.sum() < 100:
    raise SystemExit("Not enough data in each period yet. Let the bot collect more charts.")

params = dict(
    objective="binary",
    learning_rate=0.03,
    num_leaves=15,
    min_data_in_leaf=60,
    feature_fraction=0.8,
    bagging_fraction=0.8,
    bagging_freq=1,
    lambda_l2=2.0,
    verbose=-1,
    seed=7,
    deterministic=True,
    num_threads=2,
)


def fit(mask, rounds=None, valid_mask=None):
    ds = lgb.Dataset(X[mask], y[mask], feature_name=FEATURES, free_raw_data=False)
    if valid_mask is not None:
        vs = lgb.Dataset(X[valid_mask], y[valid_mask], reference=ds)
        return lgb.train(params, ds, num_boost_round=2000, valid_sets=[vs], callbacks=[lgb.early_stopping(100, verbose=False)])
    return lgb.train(params, ds, num_boost_round=rounds)


def auc(scores, labels):
    order = np.argsort(scores)
    ranks = np.empty(len(scores))
    ranks[order] = np.arange(1, len(scores) + 1)
    pos = labels == 1
    n_pos, n_neg = pos.sum(), (~pos).sum()
    if n_pos == 0 or n_neg == 0:
        return float("nan")
    return float((ranks[pos].sum() - n_pos * (n_pos + 1) / 2) / (n_pos * n_neg))


def stats(mask):
    n = int(mask.sum())
    if n == 0:
        return dict(trades=0, winRate=None, avgReturnPct=None)
    return dict(trades=n, winRate=round(float(y[mask].mean()), 4), avgReturnPct=round(float(ret[mask].mean() * 100), 3))


# ---------------------------------------------------------------- train on train, tune on validation
model = fit(train, valid_mask=valid)
best_rounds = max(50, model.best_iteration or 200)
p_valid = model.predict(X[valid], num_iteration=best_rounds)

# Pick the probability threshold that gave the best average return on validation (min. 40 trades).
best_thr, best_avg = None, -1e9
for q in [0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.93, 0.95, 0.97]:
    thr = float(np.quantile(p_valid, q))
    sel = p_valid >= thr
    if sel.sum() < 40:
        continue
    avg = float(ret[valid][sel].mean())
    if avg > best_avg:
        best_thr, best_avg = thr, avg
if best_thr is None:
    best_thr = float(np.quantile(p_valid, 0.9))

# ---------------------------------------------------------------- honest test on unseen recent data
model_tv = fit(train_all, rounds=best_rounds)
p_test = model_tv.predict(X[test])
fi = {n: i for i, n in enumerate(FEATURES)}
momentum_rule = (X[:, fi["ret_1h"]] > 0) & (X[:, fi["ema9_21_gap"]] > 0) & (X[:, fi["rsi_14"]] < 70)

picked = np.zeros(len(y), dtype=bool)
picked[np.where(test)[0][p_test >= best_thr]] = True
top10 = np.zeros(len(y), dtype=bool)
top10[np.where(test)[0][p_test >= np.quantile(p_test, 0.9)]] = True

m_model = stats(picked)
m_all = stats(test)
m_mom = stats(test & momentum_rule)
test_days = (t[test][-1] - t[test][0]) / 86400
useful = bool(
    m_model["trades"] >= 30
    and m_model["avgReturnPct"] is not None
    and m_model["avgReturnPct"] > 0
    and m_model["avgReturnPct"] > max(m_all["avgReturnPct"], m_mom["avgReturnPct"] if m_mom["avgReturnPct"] is not None else -1e9)
)
metrics = dict(
    testDays=round(float(test_days), 1),
    testAuc=round(auc(p_test, y[test]), 4),
    model=m_model,
    top10pct=stats(top10),
    buyEverything=m_all,
    momentumRule=m_mom,
    useful=useful,
)
say(f"TEST (unseen last {test_days:.1f} days): AUC {metrics['testAuc']}")
say(f"  model picks     : {m_model}")
say(f"  top 10% scores  : {metrics['top10pct']}")
say(f"  buy everything  : {m_all}")
say(f"  momentum rule   : {m_mom}")
say(f"  => model is {'USEFUL (beats both baselines)' if useful else 'NOT better than the baselines — the bot will not trade on it'}")

# ---------------------------------------------------------------- final model on all data
final = fit(np.ones(len(y), dtype=bool), rounds=best_rounds)
gain = final.feature_importance(importance_type="gain")
importance = sorted(
    [{"feature": n, "gain": round(float(g) / max(1e-9, float(gain.sum())), 4)} for n, g in zip(FEATURES, gain)],
    key=lambda d: -d["gain"],
)
dump = final.dump_model()
out = dict(
    version=1,
    createdAt=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    featureNames=FEATURES,
    params=dict(tpPct=TP, slPct=SL, horizonBars=HORIZON_BARS, feePct=FEE * 100),
    threshold=best_thr,
    rounds=best_rounds,
    data=dict(samples=len(rows), coins=len(coins), days=round(float((t[-1] - t[0]) / 86400), 1), baseWinRate=round(float(y.mean()), 4)),
    metrics=metrics,
    importance=importance[:10],
    trees=[ti["tree_structure"] for ti in dump["tree_info"]],
)
# Self-check rows so the bot can verify its own tree evaluation matches LightGBM exactly.
check_idx = np.linspace(0, len(y) - 1, 5).astype(int)
out["selfCheck"] = [
    {"x": [None if math.isnan(v) else float(v) for v in X[i]], "p": float(final.predict(X[i : i + 1])[0])} for i in check_idx
]
(data_dir / "ml" / "model.json.tmp").write_text(json.dumps(out))
(data_dir / "ml" / "model.json.tmp").replace(data_dir / "ml" / "model.json")
say(f"Saved model: {len(out['trees'])} trees, threshold {best_thr:.3f}. Top features: {', '.join(i['feature'] for i in importance[:5])}")
