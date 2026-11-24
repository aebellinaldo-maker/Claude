import type { PortfolioState, Position, Settings, TradeTrigger } from "../types.js";
import { L } from "../util/i18n.js";

export type ExitSignal =
  | { action: "none" }
  | { action: "sell"; pct: number; trigger: TradeTrigger; reason: string };

/**
 * Hard exit rules. These ALWAYS run (every ~30s) and the AI cannot override them.
 */
export function exitSignal(
  pos: Position,
  priceUsd: number,
  liquidityUsd: number | undefined,
  now: number,
  s: Settings,
): ExitSignal {
  if (!(priceUsd > 0) || !(pos.entryPriceUsd > 0)) return { action: "none" };
  const l = (en: string, de: string) => L(s.language, en, de);
  const pnlPct = (priceUsd / pos.entryPriceUsd - 1) * 100;
  const peak = Math.max(pos.peakPriceUsd, priceUsd);
  const fromPeakPct = (1 - priceUsd / peak) * 100;
  const peakGainPct = (peak / pos.entryPriceUsd - 1) * 100;

  if (liquidityUsd !== undefined && pos.entryLiquidityUsd > 0 && liquidityUsd < pos.entryLiquidityUsd * 0.5) {
    return {
      action: "sell",
      pct: 100,
      trigger: "rug_exit",
      reason: l(
        `Liquidity dropped ${Math.round((1 - liquidityUsd / pos.entryLiquidityUsd) * 100)}% since entry (possible rug pull)`,
        `Liquidität seit dem Kauf um ${Math.round((1 - liquidityUsd / pos.entryLiquidityUsd) * 100)}% gefallen (möglicher Rug Pull)`,
      ),
    };
  }
  if (pnlPct <= -s.stopLossPct) {
    return { action: "sell", pct: 100, trigger: "stop_loss", reason: l(`Stop-loss hit (${pnlPct.toFixed(1)}%)`, `Stop-Loss ausgelöst (${pnlPct.toFixed(1)}%)`) };
  }
  if (!pos.tookProfit && pnlPct >= s.takeProfitPct) {
    return {
      action: "sell",
      pct: s.takeProfitSellPct,
      trigger: "take_profit",
      reason: l(
        `Take-profit: +${pnlPct.toFixed(1)}%, selling ${s.takeProfitSellPct}% and letting the rest run`,
        `Take-Profit: +${pnlPct.toFixed(1)}%, ${s.takeProfitSellPct}% verkauft, der Rest läuft weiter`,
      ),
    };
  }
  // Trailing stop: after take-profit, or once a trade was well in profit, protect gains.
  const trailingArmed = pos.tookProfit || peakGainPct >= s.takeProfitPct / 2;
  if (trailingArmed && fromPeakPct >= s.trailingStopPct && pnlPct > -s.stopLossPct) {
    return {
      action: "sell",
      pct: 100,
      trigger: "trailing_stop",
      reason: l(
        `Trailing stop: ${fromPeakPct.toFixed(1)}% below peak (P&L ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%)`,
        `Trailing-Stop: ${fromPeakPct.toFixed(1)}% unter dem Hoch (G&V ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%)`,
      ),
    };
  }
  const heldHours = (now - pos.openedAt) / 3_600_000;
  if (heldHours >= s.maxHoldHours && pnlPct < 10) {
    return {
      action: "sell",
      pct: 100,
      trigger: "time_exit",
      reason: l(
        `Held ${heldHours.toFixed(0)}h without a real move (${pnlPct.toFixed(1)}%), freeing the money`,
        `${heldHours.toFixed(0)} Std. ohne echte Bewegung gehalten (${pnlPct.toFixed(1)}%), Geld wird frei gemacht`,
      ),
    };
  }
  return { action: "none" };
}

/**
 * How much SOL to put into a new position.
 * `sizePct` (0–100) is how much of the max position size to use (from AI confidence or rules).
 */
export function buySizeSol(opts: { equitySol: number; freeSol: number; sizePct: number; s: Settings }): number {
  const { equitySol, freeSol, sizePct, s } = opts;
  const maxPerPosition = (equitySol * s.maxPositionPct) / 100;
  const wanted = (maxPerPosition * Math.max(25, Math.min(100, sizePct))) / 100;
  const available = freeSol - s.feeReserveSol;
  const size = Math.min(wanted, available);
  if (size < s.minTradeSol) return 0;
  return Math.floor(size * 1e6) / 1e6;
}

export interface BreakerStatus {
  killSwitch: boolean;
  noNewBuys: boolean;
  dailyPnlPct: number;
  totalPnlPct: number;
  drawdownPct: number;
  reason?: string;
}

/** Circuit breakers: stop buying after a bad day; stop everything after a big drawdown. */
export function breakers(p: PortfolioState, equityEur: number, s: Settings): BreakerStatus {
  const pct = (a: number, b: number) => (b > 0 ? (a / b - 1) * 100 : 0);
  const dailyPnlPct = pct(equityEur, p.day.startEquityEur);
  const totalPnlPct = pct(equityEur, p.startEquityEur);
  const peak = Math.max(p.peakEquityEur, p.startEquityEur);
  const drawdownPct = peak > 0 ? (1 - equityEur / peak) * 100 : 0;
  if (p.startEquityEur > 0 && drawdownPct >= s.maxDrawdownPct) {
    return {
      killSwitch: true,
      noNewBuys: true,
      dailyPnlPct,
      totalPnlPct,
      drawdownPct,
      reason: L(
        s.language,
        `Value fell ${drawdownPct.toFixed(0)}% from its best (limit ${s.maxDrawdownPct}%)`,
        `Wert ist ${drawdownPct.toFixed(0)}% unter den Höchststand gefallen (Limit ${s.maxDrawdownPct}%)`,
      ),
    };
  }
  if (p.day.startEquityEur > 0 && dailyPnlPct <= -s.maxDailyLossPct) {
    return {
      killSwitch: false,
      noNewBuys: true,
      dailyPnlPct,
      totalPnlPct,
      drawdownPct,
      reason: L(
        s.language,
        `Daily loss limit reached (${dailyPnlPct.toFixed(1)}%), no new buys until tomorrow`,
        `Tägliches Verlustlimit erreicht (${dailyPnlPct.toFixed(1)}%), keine neuen Käufe bis morgen`,
      ),
    };
  }
  return { killSwitch: false, noNewBuys: false, dailyPnlPct, totalPnlPct, drawdownPct };
}
