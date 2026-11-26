/**
 * The strategy squad: four specialists that trade side by side, each with its own way of
 * finding coins, its own entry signal and its own exit rules.
 *
 *   🎯 Sniper     — young coins (15 min – 12 h) that survived launch, with clean holders
 *   ⚡ Momentum   — breakouts of established coins on rising volume and buy pressure
 *   🪝 Dip Hunter — pullbacks inside an uptrend, bought on the first bounce
 *   🐋 Whale Tail — coins that big wallets (and wallets with a good record) are buying now
 *
 * An allocator gives more money to strategies whose own track record is good and less to
 * the ones that lose; with real money a strategy that keeps losing is benched.
 */
import fs from "node:fs";
import path from "node:path";
import type { Candidate, HolderInfo, Mode, Settings, StrategyId, StrategySignal, Trade } from "../types.js";
import { scoreCandidate } from "../risk/scoring.js";
import { MOONSHOT, WINRATE, WINRATE_MIN_24H_PCT } from "../risk/profiles.js";
import { tradeStats, type TradeStats } from "../engine/stats.js";
import { L } from "../util/i18n.js";

export const STRATEGY_IDS: StrategyId[] = ["sniper", "momentum", "dip", "whale"];

export interface ExitProfile {
  stopLossPct: number;
  takeProfitPct: number;
  takeProfitSellPct: number;
  trailingStopPct: number;
  maxHoldHours: number;
}

interface StrategyDef {
  /** "owner" = the exit settings from the app's Settings tab. */
  exits: ExitProfile | "owner";
  /** Position size relative to the normal maximum (young coins: smaller bets). */
  sizeFactor: number;
  /** Max open positions for this strategy. */
  maxOpen: number;
  /** Minimum signal strength for a rule-based buy (when the AI isn't deciding). */
  ruleMin: number;
}

/**
 * Dip Hunter exits were chosen with scripts/backtest-squad.ts on the earlier part of the
 * chart archive only. Sniper and Whale Tail can't be back-tested on stored candles
 * (launch survivorship / no trade history), so their exits follow the usual practice for
 * those styles: wide stop and "take out the stake" for launches, medium for whale follows.
 */
export const STRATEGIES: Record<StrategyId, StrategyDef> = {
  sniper: {
    exits: { stopLossPct: 30, takeProfitPct: 100, takeProfitSellPct: 50, trailingStopPct: 35, maxHoldHours: 8 },
    sizeFactor: 0.5,
    maxOpen: 2,
    ruleMin: 0.62,
  },
  momentum: { exits: "owner", sizeFactor: 1, maxOpen: 2, ruleMin: 0.62 },
  dip: {
    // Chosen on earlier days; on the later 10 days it never saw: −0.8 % per trade after fees,
    // 45 % winners (momentum rule −4.5 %, buying anything −2.9 %). See ml/squad-backtest.json.
    exits: { stopLossPct: 20, takeProfitPct: 60, takeProfitSellPct: 50, trailingStopPct: 15, maxHoldHours: 12 },
    sizeFactor: 0.8,
    maxOpen: 2,
    ruleMin: 0.6,
  },
  whale: {
    exits: { stopLossPct: 20, takeProfitPct: 60, takeProfitSellPct: 50, trailingStopPct: 25, maxHoldHours: 24 },
    sizeFactor: 0.8,
    maxOpen: 2,
    ruleMin: 0.6,
  },
};

/** Between AI rounds, a signal this strong may be bought by the rules right away. */
export const FAST_LANE_STRENGTH = 0.78;

/** The exit settings a position of this strategy is managed with. */
export function exitSettings(s: Settings, id: StrategyId | undefined): Settings {
  if (s.riskMode === "moonshot") return { ...s, ...MOONSHOT };
  if (s.riskMode === "winrate") return { ...s, ...WINRATE };
  const d = STRATEGIES[id ?? "momentum"].exits;
  return d === "owner" ? s : { ...s, ...d };
}

export function exitProfile(s: Settings, id: StrategyId): ExitProfile {
  const x = exitSettings(s, id);
  return {
    stopLossPct: x.stopLossPct,
    takeProfitPct: x.takeProfitPct,
    takeProfitSellPct: x.takeProfitSellPct,
    trailingStopPct: x.trailingStopPct,
    maxHoldHours: x.maxHoldHours,
  };
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
/** +1.5% / −3.2% */
const sp = (x: number, d = 1) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(d)}%`;
const r2 = (x: number) => Math.round(x * 100) / 100;

// ------------------------------------------------------------------ Sniper

export const SNIPER_MIN_AGE_H = 0.25;
export const SNIPER_MAX_AGE_H = 12;

/** Hard filter for young coins (replaces the normal 24 h minimum age). Empty = pass. */
export function sniperFilter(c: Candidate, s: Settings): string[] {
  const l = (en: string, de: string) => L(s.language, en, de);
  const r: string[] = [];
  if (!(c.priceUsd > 0)) r.push(l("no price", "kein Preis"));
  if (c.ageHours < SNIPER_MIN_AGE_H) r.push(l("launched less than 15 min ago", "vor weniger als 15 Min. gestartet"));
  if (c.ageHours > SNIPER_MAX_AGE_H) r.push(l("older than 12 h", "älter als 12 Std."));
  if (c.liquidityUsd < 15_000) r.push(l(`liquidity $${Math.round(c.liquidityUsd)} < $15,000`, `Liquidität $${Math.round(c.liquidityUsd)} < $15.000`));
  if (c.volume.h1 < 10_000) r.push(l("less than $10k traded in the last hour", "weniger als $10k Volumen in der letzten Stunde"));
  if (c.marketCapUsd < 30_000) r.push(l("market cap below $30k", "Marktkapitalisierung unter $30k"));
  if (c.marketCapUsd > s.maxMarketCapUsd) r.push(l("market cap above limit", "Marktkapitalisierung über dem Limit"));
  if (c.priceChange.h1 > 400) r.push(l("vertical pump in the last hour", "senkrechter Pump in der letzten Stunde"));
  if (c.priceChange.m5 < -15 || c.priceChange.h1 < -25) r.push(l("crashing right now", "stürzt gerade ab"));
  const { buys, sells } = c.txns.h1;
  if (buys < 30) r.push(l("too few buyers in the last hour", "zu wenige Käufer in der letzten Stunde"));
  if (sells > buys) r.push(l("more sells than buys in the last hour", "mehr Verkäufe als Käufe in der letzten Stunde"));
  return r;
}

/** Deep holder check for young coins (developer powers, concentrated supply). Empty = pass. */
export function holderReasons(h: HolderInfo | undefined, s: Settings): string[] {
  const l = (en: string, de: string) => L(s.language, en, de);
  if (!h) return [l("holder check unavailable", "Holder-Check nicht verfügbar")];
  const r: string[] = [];
  if (h.rugged) r.push(l("marked as rugged", "als Rug Pull markiert"));
  if (!h.mintRevoked) r.push(l("developer can still create new tokens", "Entwickler kann noch neue Tokens erzeugen"));
  if (!h.freezeRevoked) r.push(l("developer can freeze wallets", "Entwickler kann Wallets einfrieren"));
  if ((h.top10Pct ?? 0) > 35) r.push(l(`top 10 wallets hold ${h.top10Pct}%`, `Top-10-Wallets halten ${h.top10Pct}%`));
  if ((h.maxHolderPct ?? 0) > 12) r.push(l(`one wallet holds ${h.maxHolderPct}%`, `ein Wallet hält ${h.maxHolderPct}%`));
  if ((h.creatorPct ?? 0) > 5) r.push(l(`creator still holds ${h.creatorPct}%`, `Ersteller hält noch ${h.creatorPct}%`));
  if ((h.holders ?? 0) < 150) r.push(l(`only ${h.holders ?? 0} holders`, `nur ${h.holders ?? 0} Holder`));
  // Unlocked liquidity = the creator can pull the pool's money at any moment (classic rug).
  if (!((h.lpLockedPct ?? 0) >= 80)) r.push(l("liquidity isn't locked (the creator could pull it)", "Liquidität ist nicht gesperrt (der Ersteller könnte sie abziehen)"));
  return r;
}

export function sniperSignal(c: Candidate, s: Settings): StrategySignal | null {
  const h = c.holders;
  if (!h || holderReasons(h, s).length) return null;
  const de = s.language === "de";
  const ratio = c.txns.h1.buys / Math.max(1, c.txns.h1.sells);
  const buyPressure = clamp01((ratio - 1) / 1);
  const turnover = clamp01(c.volume.h1 / Math.max(1, c.liquidityUsd));
  const spread = clamp01((35 - (h.top10Pct ?? 35)) / 20);
  const h1 = c.priceChange.h1;
  const momentum = h1 < 0 ? 0 : h1 <= 80 ? clamp01(h1 / 40) : clamp01(1 - (h1 - 80) / 300);
  const social = clamp01((c.socials.length + c.websites) / 3);
  const strength = 0.3 * buyPressure + 0.25 * turnover + 0.2 * spread + 0.15 * momentum + 0.1 * social;
  const age = c.ageHours < 1 ? `${Math.round(c.ageHours * 60)} min` : `${c.ageHours.toFixed(1)} h`;
  return {
    strategy: "sniper",
    strength: r2(strength),
    notes: de
      ? [
          `vor ${age} gestartet`,
          `${c.txns.h1.buys} Käufe vs. ${c.txns.h1.sells} Verkäufe (1 Std.)`,
          `${h.holders ?? "?"} Holder, Top 10 halten ${h.top10Pct ?? "?"}%`,
          "Mint & Freeze deaktiviert",
        ]
      : [
          `launched ${age} ago`,
          `${c.txns.h1.buys} buys vs ${c.txns.h1.sells} sells (1h)`,
          `${h.holders ?? "?"} holders, top 10 hold ${h.top10Pct ?? "?"}%`,
          "mint & freeze revoked",
        ],
  };
}

// ------------------------------------------------------------------ Momentum

export function momentumSignal(c: Candidate, s: Settings): StrategySignal | null {
  const de = s.language === "de";
  let strength = scoreCandidate(c).score;
  const ch = c.chart;
  if (c.priceChange.h1 <= 0 || c.priceChange.h6 <= 0) strength *= 0.5; // not breaking up
  if (ch) {
    if (ch.trend === "up") strength += 0.05;
    if (Number(ch.rsi) > 80) strength -= 0.15;
    if (Number(ch.volume_vs_avg_1h) >= 1.5) strength += 0.05;
    if (Number(ch.upper_wicks_1h_pct) > 3) strength -= 0.05;
  }
  const accel = c.volume.h24 > 0 ? (c.volume.h1 / (c.volume.h24 / 24)).toFixed(1) : "?";
  return {
    strategy: "momentum",
    strength: r2(clamp01(strength)),
    notes: de
      ? [`${sp(c.priceChange.h1)} in 1 Std., ${sp(c.priceChange.h6, 0)} in 6 Std.`, `Volumen ${accel}× Durchschnitt`, `${c.txns.h1.buys}/${c.txns.h1.sells} Käufe/Verkäufe`]
      : [`${sp(c.priceChange.h1)} in 1h, ${sp(c.priceChange.h6, 0)} in 6h`, `volume ${accel}× average`, `${c.txns.h1.buys}/${c.txns.h1.sells} buys/sells`],
  };
}

/**
 * "High win rate" mode: only coins already up ≥ 40 % in 24 h, and for Momentum the exact rule
 * that was back-tested (rising > 3 % in 1 h, short-term trend up, volume > 1.2× average, RSI < 80).
 */
export function winrateEntryOk(c: Candidate, strategy: StrategyId): boolean {
  if (c.priceChange.h24 < WINRATE_MIN_24H_PCT) return false;
  if (strategy === "dip") return true;
  if (strategy !== "momentum") return false;
  const ch = c.chart;
  return !!ch && Number(ch.change_1h_pct) > 3 && ch.trend !== "down" && Number(ch.volume_vs_avg_1h) > 1.2 && Number(ch.rsi) < 80;
}

// ------------------------------------------------------------------ Dip Hunter

/** Cheap pre-check before fetching a chart: strong 24 h, cooling off now. */
export function dipCandidate(c: Candidate): boolean {
  return c.priceChange.h24 >= 15 && c.priceChange.h1 <= 2;
}

/** Dip Hunter entry, also used by the back-test on stored candles. */
export function dipEntry(x: { trend: string; rsi: number; belowHighPct: number; change15mPct: number; change1hPct: number; change24hPct: number }): number | null {
  const uptrend = x.change24hPct >= 15 && x.trend !== "down";
  const pulledBack = x.belowHighPct >= 12 && x.belowHighPct <= 40;
  const cooled = x.rsi >= 25 && x.rsi <= 52;
  const bouncing = x.change15mPct > 0 && x.change1hPct > -8;
  if (!uptrend || !pulledBack || !cooled || !bouncing) return null;
  const depth = clamp01(1 - Math.abs(x.belowHighPct - 25) / 15);
  const rsi = clamp01((52 - x.rsi) / 20);
  const bounce = clamp01(x.change15mPct / 4);
  const trend = clamp01(x.change24hPct / 80);
  return 0.3 * depth + 0.25 * rsi + 0.25 * bounce + 0.2 * trend;
}

export function dipSignal(c: Candidate, s: Settings): StrategySignal | null {
  const ch = c.chart;
  if (!ch) return null;
  const x = {
    trend: String(ch.trend),
    rsi: Number(ch.rsi),
    belowHighPct: Number(ch.below_24h_high_pct),
    change15mPct: Number(ch.change_15m_pct ?? 0),
    change1hPct: Number(ch.change_1h_pct),
    change24hPct: Number(ch.change_24h_pct),
  };
  const st = dipEntry(x);
  if (st === null) return null;
  const de = s.language === "de";
  return {
    strategy: "dip",
    strength: r2(0.35 + 0.65 * st),
    notes: de
      ? [`${sp(x.change24hPct, 0)} in 24 Std., jetzt ${x.belowHighPct.toFixed(0)}% unter dem Hoch`, `RSI ${x.rsi} (abgekühlt)`, `erste grüne Kerze (+${x.change15mPct.toFixed(1)}% in 15 Min.)`]
      : [`${sp(x.change24hPct, 0)} in 24h, now ${x.belowHighPct.toFixed(0)}% below the high`, `RSI ${x.rsi} (cooled off)`, `first green candle (+${x.change15mPct.toFixed(1)}% in 15 min)`],
  };
}

// ------------------------------------------------------------------ Whale Tail

export function whaleSignal(c: Candidate, s: Settings): StrategySignal | null {
  const w = c.whales;
  if (!w) return null;
  const net = w.buyUsd - w.sellUsd;
  if (w.whales < 2 || w.buyUsd < 2 * w.sellUsd || net < 0.02 * c.liquidityUsd || c.priceChange.h1 > 50) return null;
  const ratio = c.txns.h1.buys / Math.max(1, c.txns.h1.sells);
  const strength =
    0.35 * clamp01(w.whales / 5) + 0.3 * clamp01(net / (0.05 * Math.max(1, c.liquidityUsd))) + 0.15 * clamp01((ratio - 0.8) / 0.8) + 0.2 * clamp01(w.smartWallets / 2);
  const de = s.language === "de";
  const k = (x: number) => (x >= 1000 ? `$${(x / 1000).toFixed(1)}k` : `$${Math.round(x)}`);
  const notes = de
    ? [`${w.whales} große Wallets kaufen (${k(w.buyUsd)} vs. ${k(w.sellUsd)} verkauft, 1 Std.)`]
    : [`${w.whales} big wallets buying (${k(w.buyUsd)} vs ${k(w.sellUsd)} sold, 1h)`];
  if (w.smartWallets) notes.push(de ? `${w.smartWallets} davon mit guter Bilanz („Smart Money“)` : `${w.smartWallets} of them with a good record ("smart money")`);
  notes.push(de ? `Preis erst ${sp(c.priceChange.h1, 0)} in 1 Std.` : `price only ${sp(c.priceChange.h1, 0)} in 1h`);
  return { strategy: "whale", strength: r2(0.3 + 0.7 * strength), notes };
}

// ------------------------------------------------------------------ choosing

/** Best signal among the enabled strategies (Sniper is handled separately for young coins). */
export function bestSignal(c: Candidate, s: Settings, allowed: Set<StrategyId>): StrategySignal | null {
  const sigs = [
    allowed.has("momentum") ? momentumSignal(c, s) : null,
    allowed.has("dip") ? dipSignal(c, s) : null,
    allowed.has("whale") ? whaleSignal(c, s) : null,
  ].filter((x): x is StrategySignal => !!x);
  sigs.sort((a, b) => b.strength - a.strength);
  return sigs[0] ?? null;
}

// ------------------------------------------------------------------ allocation

export interface StrategyStanding {
  weight: number;
  benched: boolean;
  stats: TradeStats;
}

export const MIN_TRADES_TO_ADAPT = 8;

/**
 * More money for strategies that are winning, less for those that lose (by profit factor,
 * once there are enough trades to mean something). With real money, a strategy with a
 * profit factor below 0.5 after 15+ trades is benched until it's re-enabled.
 */
export function standings(trades: Trade[], mode: Mode, held: Set<string>): Record<StrategyId, StrategyStanding> {
  const out = {} as Record<StrategyId, StrategyStanding>;
  for (const id of STRATEGY_IDS) {
    const mine = trades.filter((t) => (t.strategy ?? "momentum") === id);
    const stats = tradeStats(mine, mode, held, 5);
    let weight = 1;
    if (stats.closed >= MIN_TRADES_TO_ADAPT) weight = Math.max(0.4, Math.min(1.6, 0.5 + 0.5 * (stats.profitFactor ?? 1)));
    const benched = mode === "real" && stats.closed >= 15 && (stats.profitFactor ?? 1) < 0.5;
    out[id] = { weight: r2(weight), benched, stats };
  }
  return out;
}

// ------------------------------------------------------------------ back-test results

export interface SquadBacktest {
  createdAt: number;
  coins: number;
  testDays: number;
  dipExits: ExitProfile;
  dip: { trades: number; avgPct: number; medianPct: number; winRate: number; bestPct: number };
  momentum: { trades: number; avgPct: number; medianPct: number; winRate: number; bestPct: number };
  baseline: { trades: number; avgPct: number; medianPct: number; winRate: number; bestPct: number };
}

let cachedBacktest: SquadBacktest | null | undefined;
/** Results of scripts/backtest-squad.ts (shipped with the app). */
export function squadBacktest(): SquadBacktest | null {
  if (cachedBacktest === undefined) {
    try {
      cachedBacktest = JSON.parse(fs.readFileSync(path.resolve("ml/squad-backtest.json"), "utf8")) as SquadBacktest;
    } catch {
      cachedBacktest = null;
    }
  }
  return cachedBacktest;
}
