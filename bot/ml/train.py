"""
Trains the bot's own trading model ("Pilot ML") with LightGBM.

Input : data/ml/dataset.jsonl   (built by the bot from its chart archive)
Output: data/ml/model.json      (trees + feature names + honest test results)

Question the model answers: "If the bot buys this coin now, will it reach the
take-profit before the stop-loss within the next 24 hours?"

How it is tested (so it can't fool itself):
1. Unseen coins AND unseen days: the test set is the most recent period, using only
   coins that were held out of training entirely, with a 24 h gap so no future
   information leaks in. The model must beat "buy everything" and a simple momentum
   rule there, after fees -> "useful" (allowed for paper trading).
2. Forward check: charts the bot recorded *after* it started watching a coin are
   free of survivorship bias (back-filled charts come from coins that are popular
   today, which makes almost any signal look good). Once there is enough forward
   data, the model must also win there -> "tradeReady" (allowed for real money).

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
EMBARGO = HORIZON_BARS * BAR_SEC


def say(msg):
    print(msg, flush=True)


# ---------------------------------------------------------------- load
rows = [json.loads(l) for l in (data_dir / "ml" / "dataset.jsonl").read_text().splitlines() if l.strip()]
if len(rows) < 500:
    raise SystemExit(f"Not enough data yet ({len(rows)} samples, need 500+). Let the bot collect more charts.")
rows.sort(key=lambda r: r["t"])
t = np.array([r["t"] for r in rows], dtype=np.int64)
X = np.array([[np.nan if v is None else v for v in r["x"]] for r in rows], dtype=np.float64)
if X.shape[1] != len(FEATURES):
    raise SystemExit("Dataset features don't match the bot's feature list; rebuild the dataset.")
y = np.array([r["y"] for r in rows], dtype=np.int32)
ret = np.array([r["r"] for r in rows], dtype=np.float64) - FEE
coin = np.array([r["c"] for r in rows])
fwd = np.array([r.get("f", 0) for r in rows], dtype=bool)
coins = np.unique(coin)
say(f"Loaded {len(rows)} samples from {len(coins)} coins over {(t[-1] - t[0]) / 86400:.1f} days "
    f"({fwd.sum()} recorded forward); base win rate {y.mean():.1%}")

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
        return dict(trades=0, winRate=None, avgReturnPct=None, tStat=None)
    r = ret[mask]
    se = float(r.std(ddof=1) / math.sqrt(n)) if n > 1 else float("inf")
    t_stat = float(r.mean() / se) if se > 0 else 0.0
    return dict(
        trades=n,
        winRate=round(float(y[mask].mean()), 4),
        avgReturnPct=round(float(r.mean() * 100), 3),
        # How many standard errors the average return is above zero (>= 1 ≈ 84% confidence it's not just luck).
        tStat=round(t_stat, 2),
    )


MIN_T = 1.0


def beats(model_stats, *baselines, min_trades=20):
    """Positive after fees, at least ~1 standard error above zero, and better than every baseline."""
    a = model_stats["avgReturnPct"]
    if model_stats["trades"] < min_trades or a is None or a <= 0 or (model_stats["tStat"] or 0) < MIN_T:
        return False
    return all(b["avgReturnPct"] is None or a > b["avgReturnPct"] for b in baselines)


fi = {n: i for i, n in enumerate(FEATURES)}
momentum_rule = (X[:, fi["ret_1h"]] > 0) & (X[:, fi["ema9_21_gap"]] > 0) & (X[:, fi["rsi_14"]] < 70)

# ---------------------------------------------------------------- split: later days AND held-out coins
rng = np.random.default_rng(42)
held = set(rng.choice(coins, size=max(1, len(coins) // 3), replace=False).tolist())
is_held = np.array([c in held for c in coin])
t_test = np.quantile(t, 0.75)
train_all = (t < t_test - EMBARGO) & ~is_held
test = (t >= t_test) & is_held
t_valid = np.quantile(t[train_all], 0.8)
train = train_all & (t < t_valid - EMBARGO)
valid = train_all & (t >= t_valid)
say(f"Train {train.sum()} · validation {valid.sum()} · test {test.sum()} "
    f"(test = last {(t[-1] - t_test) / 86400:.1f} days on {len(held)} coins never seen in training)")
if train.sum() < 300 or valid.sum() < 100 or test.sum() < 100:
    raise SystemExit("Not enough data in each period yet. Let the bot collect more charts.")

model = fit(train, valid_mask=valid)
best_rounds = max(50, model.best_iteration or 200)
p_valid = model.predict(X[valid], num_iteration=best_rounds)

# Probability threshold with the best average return on validation (min. 40 trades).
best_thr, best_avg, best_n = None, -1e9, 0
for q in [0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.93, 0.95, 0.97]:
    thr = float(np.quantile(p_valid, q))
    sel = p_valid >= thr
    if sel.sum() < 40:
        continue
    avg = float(ret[valid][sel].mean())
    if avg > best_avg:
        best_thr, best_avg, best_n = thr, avg, int(sel.sum())
if best_thr is None:
    best_thr = float(np.quantile(p_valid, 0.9))

model_tv = fit(train_all, rounds=best_rounds)
p_test = model_tv.predict(X[test])
picked = np.zeros(len(y), dtype=bool)
picked[np.where(test)[0][p_test >= best_thr]] = True
top10 = np.zeros(len(y), dtype=bool)
top10[np.where(test)[0][p_test >= np.quantile(p_test, 0.9)]] = True

m_model, m_all, m_mom = stats(picked), stats(test), stats(test & momentum_rule)
useful = beats(m_model, m_all, m_mom)
test_days = (t[test][-1] - t[test][0]) / 86400

# ---------------------------------------------------------------- forward check (no survivorship bias)
forward = dict(available=False, samples=int(fwd.sum()), days=0.0, model=stats(np.zeros(len(y), bool)), buyEverything=stats(np.zeros(len(y), bool)), validated=False)
if fwd.sum() >= 300 and (t[fwd][-1] - t[fwd][0]) >= 3 * 86400:
    t_f = np.quantile(t[fwd], 0.4)
    f_test = fwd & (t >= t_f)
    f_train = t < t_f - EMBARGO
    if f_train.sum() >= 300 and f_test.sum() >= 100:
        m_f = fit(f_train, rounds=best_rounds)
        p_f = m_f.predict(X[f_test])
        f_pick = np.zeros(len(y), dtype=bool)
        f_pick[np.where(f_test)[0][p_f >= best_thr]] = True
        forward.update(
            available=True,
            days=round(float((t[f_test][-1] - t[f_test][0]) / 86400), 1),
            model=stats(f_pick),
            buyEverything=stats(f_test),
        )
        forward["validated"] = bool(beats(forward["model"], forward["buyEverything"]))

metrics = dict(
    validation=dict(trades=best_n, avgReturnPct=round(best_avg * 100, 3) if best_n else None),
    testDays=round(float(test_days), 1),
    testCoins=len(held),
    testAuc=round(auc(p_test, y[test]), 4),
    model=m_model,
    top10pct=stats(top10),
    buyEverything=m_all,
    momentumRule=m_mom,
    useful=useful,
    forward=forward,
    tradeReady=bool(useful and forward["validated"]),
)
say(f"TEST (last {test_days:.1f} days, {len(held)} unseen coins): AUC {metrics['testAuc']}")
say(f"  model picks     : {m_model}")
say(f"  top 10% scores  : {metrics['top10pct']}")
say(f"  buy everything  : {m_all}")
say(f"  momentum rule   : {m_mom}")
if forward["available"]:
    say(f"  forward check   : picks {forward['model']} vs buy everything {forward['buyEverything']}")
else:
    say(f"  forward check   : not enough forward data yet ({forward['samples']} samples; needs 300+ over 3+ days)")
say("  => " + ("TRADE-READY (useful and confirmed on forward data)" if metrics["tradeReady"]
               else "USEFUL for paper trading; real money needs the forward check" if useful
               else "NOT better than the baselines — the bot will not trade on it"))

# ---------------------------------------------------------------- final model on all data
final = fit(np.ones(len(y), dtype=bool), rounds=best_rounds)
gain = final.feature_importance(importance_type="gain")
importance = sorted(
    [{"feature": n, "gain": round(float(g) / max(1e-9, float(gain.sum())), 4)} for n, g in zip(FEATURES, gain)],
    key=lambda d: -d["gain"],
)
dump = final.dump_model()
out = dict(
    version=2,
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
out_file = Path(opts.get("outFile") or (data_dir / "ml" / "model.json"))
tmp = out_file.with_suffix(".json.tmp")
tmp.write_text(json.dumps(out))
tmp.replace(out_file)
say(f"Saved model: {len(out['trees'])} trees, threshold {best_thr:.3f}. Top signals: {', '.join(i['feature'] for i in importance[:5])}")
