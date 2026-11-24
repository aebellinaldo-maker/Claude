export type Mode = "paper" | "real";
export type Lang = "en" | "de";

export interface Settings {
  language: Lang;
  /** Paper trading uses a fake balance at real prices. */
  paperBudgetEur: number;

  // --- timing ---
  scanIntervalMin: number;
  monitorIntervalSec: number;

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
}

export type TradeTrigger =
  | "ai"
  | "rules"
  | "stop_loss"
  | "take_profit"
  | "trailing_stop"
  | "time_exit"
  | "rug_exit"
  | "ai_exit"
  | "panic"
  | "kill_switch"
  | "manual";

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
  score?: number;
  scoreBreakdown?: Record<string, number>;
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
}
