import type { ShadowBook } from "./engine/shadow.js";

export type Mode = "paper" | "real";

/**
 * The four trading strategies ("the squad"). Each has its own way of finding coins,
 * its own entry signal and its own exit rules; they trade side by side.
 * - sniper:   young coins (15 min – 12 h old) that survived launch, with clean holders
 * - momentum: breakouts of established coins on rising volume
 * - dip:      pullbacks inside an uptrend, bought on the first bounce
 * - whale:    coins that large wallets (and wallets with a good record) are buying right now
 */
export type StrategyId = "sniper" | "momentum" | "dip" | "whale";
export type RiskMode = "normal" | "moonshot" | "winrate";
export type Lang = "en" | "de";

export interface Settings {
  language: Lang;
  /** Paper trading uses a fake balance at real prices. */
  paperBudgetEur: number;
  /** Real money: the most the bot may use, in EUR (0 = everything in the bot wallet). */
  realBudgetEur: number;

  // --- auto-stop ("when to close") ---
  /** Stop when total profit reaches this % (0 = off). */
  stopAtProfitPct: number;
  /** Stop when total loss reaches this % (0 = off). */
  stopAtLossPct: number;
  /** Stop at this time (unix ms, 0 = off). */
  stopAt: number;
  /** When an auto-stop triggers: sell everything (true) or only stop buying (false). */
  closeOnStop: boolean;

  // --- timing ---
  scanIntervalMin: number;
  monitorIntervalSec: number;

  /**
   * "normal": the exit/sizing values below. "moonshot": fewer, bigger bets that are allowed
   * to run (see risk/profiles.ts) — more chance of a big win AND of a big loss.
   * "winrate": only Dip Hunter and Momentum on coins up ≥40 % in 24 h, selling everything at
   * a small target with a wide stop — wins most trades, but each loss is several wins.
   */
  riskMode: RiskMode;
  /** Let the bot switch to the mode that is winning in the live shadow test. */
  autoMode: boolean;
  /**
   * Only trade what's winning: a strategy whose live shadow test is losing doesn't buy
   * (and with real money it must first PROVE a profit there). It resumes on its own.
   */
  requireEdge: boolean;
  /** Which strategies may open new trades. */
  strategies: Record<StrategyId, boolean>;

  // --- position sizing ---
  maxPositions: number;
  /** Max % of total equity in a single coin. */
  maxPositionPct: number;
  minTradeSol: number;
  /** SOL kept aside for network fees and token-account rent. */
  feeReserveSol: number;
  slippageBps: number;
  maxPriceImpactPct: number;

  // --- exits ---
  stopLossPct: number;
  takeProfitPct: number;
  takeProfitSellPct: number;
  trailingStopPct: number;
  maxHoldHours: number;
  /**
   * Break-even stop: once a coin has been up this much (%), sell if it falls back to
   * +BREAKEVEN_FLOOR_PCT, so a winner can't turn into a full stop-loss (0 = off).
   */
  breakevenAfterPct: number;

  // --- circuit breakers ---
  maxDailyLossPct: number;
  maxDrawdownPct: number;
  cooldownHours: number;

  // --- coin filters (rug-pull protection) ---
  minLiquidityUsd: number;
  minVolume24hUsd: number;
  minPairAgeHours: number;
  minMarketCapUsd: number;
  maxMarketCapUsd: number;
  maxRugScore: number;
  maxPump24hPct: number;

  // --- AI ---
  aiEnabled: boolean;
  aiModel: string;
  aiEffort: "low" | "medium" | "high";
  aiDailyBudgetUsd: number;
  /** Minimum minutes between AI trading decisions (saves API costs). */
  aiIntervalMin: number;
  aiMinConfidence: number;
  webResearch: boolean;
  briefingIntervalHours: number;
}

export interface Position {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  /** Raw token amount (integer, as string because it can exceed 2^53). */
  rawAmount: string;
  /** SOL spent on what's still held (cost basis, reduced pro-rata on partial sells). */
  costSol: number;
  /** EUR value at entry for the part still held. */
  costEur: number;
  entryPriceUsd: number;
  openedAt: number;
  peakPriceUsd: number;
  tookProfit: boolean;
  entryLiquidityUsd: number;
  lastPriceUsd: number;
  lastLiquidityUsd: number;
  lastUpdate: number;
  reason: string;
  imageUrl?: string;
  /** DEX pool address (used to keep archiving the chart while the coin is held). */
  pool?: string;
  /** Strategy that opened the position (decides its exit rules). Old positions: momentum. */
  strategy?: StrategyId;
}

export type TradeTrigger =
  | "ai"
  | "rules"
  | "stop_loss"
  | "take_profit"
  | "trailing_stop"
  | "breakeven"
  | "time_exit"
  | "rug_exit"
  | "ai_exit"
  | "panic"
  | "kill_switch"
  | "manual"
  | "ml"
  | "auto_stop";

export interface Trade {
  id: string;
  ts: number;
  mode: Mode;
  side: "buy" | "sell";
  mint: string;
  symbol: string;
  solAmount: number;
  tokenAmount: number;
  priceUsd: number;
  valueEur: number;
  trigger: TradeTrigger;
  reason: string;
  pnlEur?: number;
  pnlPct?: number;
  signature?: string;
  strategy?: StrategyId;
  imageUrl?: string;
}

export interface EquityPoint {
  ts: number;
  eur: number;
  mode: Mode;
}

export interface BotEvent {
  ts: number;
  level: "info" | "warn" | "error";
  msg: string;
}

export interface PortfolioState {
  positions: Position[];
  /** Equity in EUR when the bot was (re)started in this mode — basis for total P&L. */
  startEquityEur: number;
  /** Highest equity seen — basis for the drawdown kill switch. */
  peakEquityEur: number;
  day: { date: string; startEquityEur: number };
}

export interface PaperState extends PortfolioState {
  solBalance: number;
}

export interface Candidate {
  mint: string;
  symbol: string;
  name: string;
  imageUrl?: string;
  pairAddress: string;
  dexId: string;
  url: string;
  priceUsd: number;
  liquidityUsd: number;
  volume: { m5: number; h1: number; h6: number; h24: number };
  priceChange: { m5: number; h1: number; h6: number; h24: number };
  txns: { h1: { buys: number; sells: number }; h24: { buys: number; sells: number } };
  marketCapUsd: number;
  fdvUsd: number;
  pairCreatedAt: number;
  ageHours: number;
  socials: string[];
  websites: number;
  boostAmount: number;
  sources: string[];
  trendingRank?: number;
  safety?: SafetyReport;
  /** Chart analysis of the last 24 h (trend, RSI, volume…), when candles were available. */
  chart?: Record<string, number | string>;
  /** Own model: probability of hitting take-profit before stop-loss. */
  mlProb?: number;
  /** Large-wallet activity in the last hour (Whale Tail). */
  whales?: WhaleInfo;
  /** Holder distribution and token authorities (deep check for young coins). */
  holders?: HolderInfo;
  /** The strategy that wants this coin, how strongly, and why. */
  signal?: StrategySignal;
  score?: number;
  scoreBreakdown?: Record<string, number>;
}

export interface StrategySignal {
  strategy: StrategyId;
  /** 0 … 1 */
  strength: number;
  notes: string[];
}

export interface WhaleInfo {
  windowMin: number;
  /** A trade counts as "big" from this size (USD). */
  thresholdUsd: number;
  bigBuys: number;
  bigSells: number;
  buyUsd: number;
  sellUsd: number;
  /** Distinct wallets with big buys. */
  whales: number;
  /** Of those, wallets whose earlier big buys mostly went up (learned by the bot). */
  smartWallets: number;
  wallets: string[];
  checkedAt: number;
}

export interface HolderInfo {
  holders?: number;
  /** Share of supply held by the 10 largest real holders (pools and lockers excluded), %. */
  top10Pct?: number;
  maxHolderPct?: number;
  insiders?: number;
  creatorPct?: number;
  mintRevoked: boolean;
  freezeRevoked: boolean;
  lpLockedPct?: number;
  launchpad?: string;
  rugged?: boolean;
}

/** One bot run, from Start to Stop. */
export interface RunSession {
  id: string;
  mode: Mode;
  startedAt: number;
  startEquityEur: number;
  endedAt?: number;
  endEquityEur?: number;
}

/** What the bot learned about big wallets: did their big buys go up afterwards? */
export interface WhaleBook {
  pending: { wallet: string; mint: string; priceUsd: number; ts: number }[];
  wallets: Record<string, { n: number; wins: number; sumRet: number; last: number }>;
}

export interface SafetyReport {
  ok: boolean;
  level: "good" | "warn" | "danger" | "unknown";
  rugScore?: number;
  lpLockedPct?: number;
  risks: { name: string; level: string; description: string }[];
  reasons: string[];
  checkedAt: number;
}

export interface AiDecision {
  mint: string;
  action: "buy" | "skip";
  confidence: number;
  sizePct: number;
  reason: string;
}

export interface AiExit {
  mint: string;
  action: "hold" | "sell";
  sellPct: number;
  reason: string;
}

export interface BotState {
  running: boolean;
  mode: Mode;
  killSwitch: { tripped: boolean; reason?: string; at?: number };
  lastScanAt?: number;
  lastAiAt?: number;
  lastMonitorAt?: number;
  lastError?: string;
  briefing?: { text: string; ts: number; lang: Lang };
  marketView?: string;
  aiSpend: { date: string; usd: number; calls: number };
  cooldowns: Record<string, number>;
  lastCandidates: Candidate[];
  paper: PaperState;
  real: PortfolioState;
  trades: Trade[];
  equity: EquityPoint[];
  events: BotEvent[];
  settings: Settings;
  ownerWallet?: string;
  /** The current (or last) run, and earlier ones. */
  session?: RunSession;
  sessions: RunSession[];
  whaleBook: WhaleBook;
  /** Virtual trades for every signal (see engine/shadow.ts). */
  shadow: ShadowBook;
}
