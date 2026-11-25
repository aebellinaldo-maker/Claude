import fs from "node:fs";
import path from "node:path";
import type { Settings } from "../types.js";

/**
 * "Moonshot" risk profile: fewer, bigger bets that are allowed to run.
 * - "Take out your initial" (a common meme-trader rule): at +200% (3x) sell 35% — that is
 *   already more than the stake — and let the rest ride with a wide trailing stop.
 * - A wide stop-loss, because meme coins often swing 20-30% before big moves.
 * Chosen by scripts/backtest-exits.ts on the earlier 60% of the charts only (best chance of a
 * ≥2x trade without a worse average). On the later days it never saw: ~5% of trades doubled
 * (normal: none), but the average trade was worse (≈ -6% vs -4%). A lottery ticket, not an edge.
 */
export const MOONSHOT = {
  stopLossPct: 30,
  takeProfitPct: 200,
  takeProfitSellPct: 35,
  trailingStopPct: 45,
  maxHoldHours: 72,
};

const MOONSHOT_SIZING = { maxPositions: 2, maxPositionPct: 60 };

/** Results of scripts/backtest-exits.ts on charts not used to choose the values (shipped with the app). */
export interface StrategyBacktest {
  createdAt: number;
  coins: number;
  testDays: number;
  trades: number;
  normal: StrategyResult;
  moonshot: StrategyResult;
}
interface StrategyResult {
  avgPct: number;
  medianPct: number;
  winRate: number;
  doubled: number;
  fiveX: number;
  bestPct: number;
  /** Chance that €10 becomes €100 within 60 trades (Monte Carlo on the back-test trades). */
  tenXChance: number;
  /** Chance of dropping to half within 60 trades. */
  halfChance: number;
}

export const BACKTEST_FILE = path.resolve("ml/strategy-backtest.json");

let cached: StrategyBacktest | null | undefined;
export function strategyBacktest(): StrategyBacktest | null {
  if (cached === undefined) {
    try {
      cached = JSON.parse(fs.readFileSync(BACKTEST_FILE, "utf8")) as StrategyBacktest;
    } catch {
      cached = null;
    }
  }
  return cached;
}

/** What each mode does, for the app. */
export function strategies(s: Settings) {
  const pick = (x: Settings) => ({
    stopLossPct: x.stopLossPct,
    takeProfitPct: x.takeProfitPct,
    takeProfitSellPct: x.takeProfitSellPct,
    trailingStopPct: x.trailingStopPct,
    maxHoldHours: x.maxHoldHours,
    maxPositions: x.maxPositions,
    maxPositionPct: x.maxPositionPct,
  });
  return {
    normal: pick(effectiveSettings({ ...s, riskMode: "normal" })),
    moonshot: pick(effectiveSettings({ ...s, riskMode: "moonshot" })),
    backtest: strategyBacktest(),
  };
}

/** The settings the bot actually trades with: the owner's settings, or the Moonshot profile on top. */
export function effectiveSettings(s: Settings): Settings {
  if (s.riskMode !== "moonshot") return s;
  return { ...s, ...MOONSHOT, ...MOONSHOT_SIZING };
}
