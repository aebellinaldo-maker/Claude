/**
 * Runs the bot's own trained model (LightGBM trees exported to JSON by ml/train.py).
 * Pure TypeScript: no Python needed for predictions, only for training.
 */
import fs from "node:fs";
import path from "node:path";
import { ML_DIR } from "./dataset.js";
import { FEATURE_NAMES } from "./features.js";
import { log } from "../util/log.js";

interface LeafNode {
  leaf_value: number;
}
interface SplitNode {
  split_feature: number;
  threshold: number;
  decision_type: string;
  default_left: boolean;
  missing_type: "None" | "Zero" | "NaN";
  left_child: TreeNode;
  right_child: TreeNode;
}
type TreeNode = LeafNode | SplitNode;

export interface Stats {
  trades: number;
  winRate: number | null;
  avgReturnPct: number | null;
  /** Average return divided by its standard error (≥ 1 ≈ 84% confidence the edge isn't luck). */
  tStat?: number | null;
}

export interface PilotModel {
  version: number;
  createdAt: string;
  featureNames: string[];
  params: { tpPct: number; slPct: number; horizonBars: number; feePct: number };
  threshold: number;
  rounds: number;
  data: { samples: number; coins: number; days: number; baseWinRate: number };
  metrics: {
    /** Test = later days AND coins the model never saw in training. */
    testDays: number;
    testCoins: number;
    testAuc: number;
    model: Stats;
    top10pct: Stats;
    buyEverything: Stats;
    momentumRule: Stats;
    /** Beat both baselines on unseen coins and days. Enough for paper trading. */
    useful: boolean;
    /** Check on charts recorded after the bot started watching (no survivorship bias). */
    forward: { available: boolean; samples: number; days: number; model: Stats; buyEverything: Stats; validated: boolean };
    /** useful AND validated on forward data: required before trading real money. */
    tradeReady: boolean;
  };
  importance: { feature: string; gain: number }[];
  trees: TreeNode[];
  selfCheck?: { x: (number | null)[]; p: number }[];
}

export const MODEL_FILE = path.join(ML_DIR, "model.json");

let current: PilotModel | null = null;

/** Same decision rule LightGBM uses for numerical splits (see LightGBM tree.h). */
function walk(node: TreeNode, x: number[]): number {
  let n = node;
  while (!("leaf_value" in n)) {
    let v = x[n.split_feature];
    if (Number.isNaN(v) && n.missing_type !== "NaN") v = 0;
    const isMissing = (n.missing_type === "Zero" && Math.abs(v) <= 1e-35) || (n.missing_type === "NaN" && Number.isNaN(v));
    if (isMissing) n = n.default_left ? n.left_child : n.right_child;
    else n = v <= n.threshold ? n.left_child : n.right_child;
  }
  return n.leaf_value;
}

export function predictWith(m: PilotModel, x: number[]): number {
  let raw = 0;
  for (const t of m.trees) raw += walk(t, x);
  return 1 / (1 + Math.exp(-raw));
}

/** Loads (or reloads) data/ml/model.json. Rejects models that don't match this code's features. */
export function loadModel(): PilotModel | null {
  try {
    if (!fs.existsSync(MODEL_FILE)) {
      current = null;
      return null;
    }
    const m = JSON.parse(fs.readFileSync(MODEL_FILE, "utf8")) as PilotModel;
    if (m.featureNames.join() !== FEATURE_NAMES.join()) {
      log.warn("Own model was trained with different chart features — retrain it");
      current = null;
      return null;
    }
    for (const c of m.selfCheck ?? []) {
      const p = predictWith(m, c.x.map((v) => (v === null ? NaN : v)));
      if (Math.abs(p - c.p) > 1e-6) {
        log.error(`Own model self-check failed (${p} vs ${c.p}) — not using it`);
        current = null;
        return null;
      }
    }
    current = m;
    return m;
  } catch (e) {
    log.error("Could not load the own model", e);
    current = null;
    return null;
  }
}

export function getModel(): PilotModel | null {
  return current;
}

/** Probability (0–1) that a trade hits take-profit before stop-loss, or null without a model. */
export function predict(x: number[] | null): number | null {
  if (!current || !x) return null;
  return predictWith(current, x);
}

loadModel();
