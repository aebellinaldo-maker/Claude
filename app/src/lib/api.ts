/** Typed client for the bot server's HTTP API. */

export interface Candidate {
  mint: string;
  symbol: string;
  name: string;
  imageUrl?: string;
  url: string;
  priceUsd: number;
  liquidityUsd: number;
  volume: { m5: number; h1: number; h6: number; h24: number };
  priceChange: { m5: number; h1: number; h6: number; h24: number };
  txns: { h1: { buys: number; sells: number }; h24: { buys: number; sells: number } };
  marketCapUsd: number;
  ageHours: number;
  socials: string[];
  boostAmount: number;
  sources: string[];
  trendingRank?: number;
  score?: number;
  safety?: {
    ok: boolean;
    level: "good" | "warn" | "danger" | "unknown";
    rugScore?: number;
    lpLockedPct?: number;
    risks: { name: string; level: string; description: string }[];
    reasons: string[];
  };
  filterReasons?: string[];
}

export interface BotPosition {
  mint: string;
  symbol: string;
  name: string;
  imageUrl: string | null;
  valueEur: number;
  costEur: number;
  pnlPct: number;
  pnlEur: number;
  priceUsd: number;
  entryPriceUsd: number;
  openedAt: number;
  tookProfit: boolean;
  reason: string;
}

export type RiskMode = "normal" | "moonshot" | "winrate";

export interface WinrateResult {
  trades: number;
  winRate: number;
  avgPct: number;
  worstPct: number;
  lossStreak: number;
}
export type StrategyId = "sniper" | "momentum" | "dip" | "whale";
export const STRATEGY_IDS: StrategyId[] = ["sniper", "momentum", "dip", "whale"];

export interface ExitProfile {
  stopLossPct: number;
  takeProfitPct: number;
  takeProfitSellPct: number;
  trailingStopPct: number;
  maxHoldHours: number;
}

export interface ShadowStat {
  n: number;
  winRate: number | null;
  avgPct: number | null;
  profitFactor: number | null;
}

export interface ShadowSummary {
  days: number;
  open: number;
  byStrategy: Record<StrategyId, Record<RiskMode, ShadowStat>>;
  byMode: Record<RiskMode, ShadowStat>;
  bestMode: RiskMode | null;
  current: Record<StrategyId, ShadowStat>;
}

export interface SquadEntry {
  basis: "trades" | "shadow" | "none";
  liveTest: ShadowStat;
  enabled: boolean;
  benched: boolean;
  weight: number;
  exits: ExitProfile;
  closed: number;
  winRate: number | null;
  profitFactor: number | null;
  realizedEur: number;
}

export interface SessionSummary {
  id: string;
  mode: "paper" | "real";
  live: boolean;
  startedAt: number;
  endedAt: number | null;
  startEur: number;
  valueEur: number;
  profitEur: number;
  multiple: number;
  trades: number;
  closed: number;
  winRate: number | null;
  avgTradeEur: number | null;
  byStrategy: Record<StrategyId, { profitEur: number; trades: number; open: number; lastTradeAt: number | null }>;
  coins: { symbol: string; mint: string; strategy: StrategyId; pnlEur: number; pnlPct: number; exitTriggers: string[]; imageUrl?: string; closedAt: number }[];
  activity: { ts: number; side: "buy" | "sell"; symbol: string; strategy: StrategyId; trigger: string; valueEur: number; pnlEur: number | null; imageUrl: string | null }[];
  equity: { ts: number; eur: number }[];
}

export interface SquadBacktest {
  coins: number;
  testDays: number;
  dipExits: ExitProfile;
  dip: { trades: number; avgPct: number; winRate: number };
  momentum: { trades: number; avgPct: number; winRate: number };
  baseline: { trades: number; avgPct: number; winRate: number };
}

export interface StrategyInfo {
  stopLossPct: number;
  takeProfitPct: number;
  takeProfitSellPct: number;
  trailingStopPct: number;
  maxHoldHours: number;
  maxPositions: number;
  maxPositionPct: number;
}

export interface StrategyResult {
  avgPct: number;
  medianPct: number;
  winRate: number;
  doubled: number;
  fiveX: number;
  bestPct: number;
  tenXChance: number;
  halfChance: number;
}

export interface RoundTrip {
  mint: string;
  symbol: string;
  openedAt: number;
  closedAt: number;
  costEur: number;
  pnlEur: number;
  pnlPct: number;
  entryTrigger: string;
  exitTriggers: string[];
  why: string;
}

export interface TradeStats {
  closed: number;
  open: number;
  wins: number;
  winRate: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
  profitFactor: number | null;
  avgTradePct: number | null;
  realizedEur: number;
  best: { symbol: string; pnlPct: number } | null;
  worst: { symbol: string; pnlPct: number } | null;
  avgHoldHours: number | null;
  verdict: "too_early" | "good" | "breakeven" | "losing";
  recent: RoundTrip[];
}

export interface BotStatus {
  running: boolean;
  paperBudgetEur: number;
  mode: "paper" | "real";
  riskMode: RiskMode;
  strategies: {
    normal: StrategyInfo;
    moonshot: StrategyInfo;
    winrate: StrategyInfo & { minChange24hPct: number };
    winrateBacktest: {
      coins: number;
      testDays: number;
      dip?: { test: WinrateResult; test2pctFees: WinrateResult };
      momentum?: { test: WinrateResult; test2pctFees: WinrateResult };
    } | null;
    backtest: { createdAt: number; coins: number; testDays: number; trades: number; normal: StrategyResult; moonshot: StrategyResult } | null;
  };
  stats: TradeStats;
  squad: Record<StrategyId, SquadEntry>;
  autoMode: boolean;
  shadow: ShadowSummary;
  squadBacktest: SquadBacktest | null;
  session: SessionSummary | null;
  killSwitch: { tripped: boolean; reason?: string; at?: number };
  lastScanAt: number | null;
  nextScanAt: number | null;
  lastError: string | null;
  equity: { cashSol: number; cashEur: number; positionsEur: number; totalEur: number; totalSol: number; solEur: number; solUsd: number };
  pnl: { startEur: number; totalEur: number; totalPct: number; dailyPct: number; drawdownPct: number; noNewBuys: boolean; breakerReason: string | null };
  positions: BotPosition[];
  wallets: { bot: string; owner: string | null };
  ai: {
    available: boolean;
    enabled: boolean;
    model: string;
    modelLabel: string | null;
    free: boolean;
    briefingSupported: boolean;
    spentTodayUsd: number;
    callsToday: number;
    budgetUsd: number;
    budgetLeftUsd: number;
  };
  briefing: { text: string; ts: number } | null;
  marketView: string | null;
  events: { ts: number; level: "info" | "warn" | "error"; msg: string }[];
}

export interface Trade {
  id: string;
  ts: number;
  mode: "paper" | "real";
  side: "buy" | "sell";
  mint: string;
  symbol: string;
  solAmount: number;
  tokenAmount: number;
  priceUsd: number;
  valueEur: number;
  trigger: string;
  reason: string;
  pnlEur?: number;
  pnlPct?: number;
  signature?: string;
}

export interface BotSettings {
  language: "en" | "de";
  paperBudgetEur: number;
  realBudgetEur: number;
  stopAtProfitPct: number;
  stopAtLossPct: number;
  stopAt: number;
  closeOnStop: boolean;
  riskMode: RiskMode;
  autoMode: boolean;
  strategies: Record<StrategyId, boolean>;
  scanIntervalMin: number;
  monitorIntervalSec: number;
  maxPositions: number;
  maxPositionPct: number;
  minTradeSol: number;
  feeReserveSol: number;
  slippageBps: number;
  maxPriceImpactPct: number;
  stopLossPct: number;
  takeProfitPct: number;
  takeProfitSellPct: number;
  trailingStopPct: number;
  maxHoldHours: number;
  maxDailyLossPct: number;
  maxDrawdownPct: number;
  cooldownHours: number;
  minLiquidityUsd: number;
  minVolume24hUsd: number;
  minPairAgeHours: number;
  minMarketCapUsd: number;
  maxMarketCapUsd: number;
  maxRugScore: number;
  maxPump24hPct: number;
  aiEnabled: boolean;
  aiModel: string;
  aiEffort: "low" | "medium" | "high";
  aiDailyBudgetUsd: number;
  aiIntervalMin: number;
  aiMinConfidence: number;
  webResearch: boolean;
  briefingIntervalHours: number;
}

export interface WalletInfo {
  sol: number;
  solEur: number;
  solPriceEur: number;
  totalEur: number;
  tokens: {
    mint: string;
    symbol: string;
    name: string;
    imageUrl: string | null;
    amount: number;
    decimals: number;
    raw: string;
    priceUsd: number | null;
    change24h: number | null;
    valueEur: number;
  }[];
}

export interface QuoteSummary {
  inDecimals: number | null;
  outDecimals: number | null;
  outValueUsd: number | null;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  minOutAmount: string;
  priceImpactPct: number;
  slippageBps: number;
  route: string;
}

export interface Opinion {
  verdict: "bullish" | "neutral" | "bearish" | "avoid";
  risk: "low" | "medium" | "high" | "extreme";
  summary: string;
  points: string[];
}

export interface ChartRead {
  is_chart: boolean;
  verdict: "buy" | "sell" | "hold" | "avoid";
  confidence: number;
  timeframe: string;
  trend: "up" | "down" | "sideways" | "unclear";
  wyckoff_phase: string;
  patterns: { name: string; meaning: string }[];
  support: string[];
  resistance: string[];
  volume_read: string;
  momentum_read: string;
  entry_idea: string;
  stop_loss_idea: string;
  take_profit_idea: string;
  summary: string;
  risks: string[];
}

export interface TokenChart {
  candles: { t: number; o: number; h: number; l: number; c: number; v: number }[];
  chart: Record<string, number | string> | null;
  mlProb: number | null;
  model: { threshold: number; baseWinRate: number; tpPct: number; slPct: number; hours: number; useful: boolean; tradeReady: boolean } | null;
}

export interface MlStats {
  trades: number;
  winRate: number | null;
  avgReturnPct: number | null;
  tStat?: number | null;
}

export interface MlStatus {
  model: {
    createdAt: string;
    params: { tpPct: number; slPct: number; horizonBars: number; feePct: number };
    threshold: number;
    data: { samples: number; coins: number; days: number; baseWinRate: number };
    metrics: {
      testDays: number;
      testCoins: number;
      testAuc: number;
      model: MlStats;
      top10pct: MlStats;
      buyEverything: MlStats;
      momentumRule: MlStats;
      useful: boolean;
      forward: { available: boolean; samples: number; days: number; model: MlStats; buyEverything: MlStats; validated: boolean };
      tradeReady: boolean;
    };
    importance: { feature: string; gain: number }[];
  } | null;
  training: {
    running: boolean;
    phase: "idle" | "collecting" | "dataset" | "training" | "done" | "failed";
    startedAt: number | null;
    finishedAt: number | null;
    progress: string | null;
    error: string | null;
    log: string[];
  };
  archiveCoins: number;
  trainerAvailable: boolean;
}

export type PayMethod = "card" | "paypal" | "apple_pay" | "google_pay" | "bank";
export interface OnrampProvider {
  id: "moonpay" | "transak" | "moonpay_web";
  name: string;
  methods: PayMethod[];
  prefillsWallet: boolean;
}

export const SOL_MINT = "So11111111111111111111111111111111111111112";

export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

export function createApi(serverUrl: string, token: string) {
  const base = serverUrl.replace(/\/+$/, "");

  async function req<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown, timeoutMs = 30_000): Promise<T> {
    if (!base) throw new ApiError("No server configured");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        /* not JSON */
      }
      if (!res.ok) {
        const msg = (json as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
        throw new ApiError(res.status === 401 ? "Wrong API token" : msg, res.status);
      }
      return json as T;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      if ((e as Error).name === "AbortError") throw new ApiError("The server took too long to answer");
      throw new ApiError(`Can't reach the server (${(e as Error).message})`);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    health: () => req<{ ok: boolean }>("GET", "/api/health", undefined, 10_000),
    status: () => req<BotStatus>("GET", "/api/bot/status"),
    session: (id?: string) => req<{ session: SessionSummary | null }>("GET", `/api/session${id ? `?id=${encodeURIComponent(id)}` : ""}`),
    sessions: () =>
      req<{ sessions: { id: string; mode: "paper" | "real"; startedAt: number; endedAt: number | null; startEur: number; endEur: number | null }[] }>("GET", "/api/sessions"),
    start: () => req<{ ok: true }>("POST", "/api/bot/start", {}),
    stop: () => req<{ ok: true }>("POST", "/api/bot/stop", {}),
    panic: () => req<{ ok: true }>("POST", "/api/bot/panic", {}, 120_000),
    setMode: (mode: "paper" | "real") => req<{ mode: string }>("POST", "/api/bot/mode", { mode }),
    resetPaper: (budgetEur?: number) => req<{ ok: true }>("POST", "/api/bot/paper/reset", { budgetEur }),
    resetBaseline: () => req<{ ok: true }>("POST", "/api/bot/baseline/reset", {}),
    scanNow: () => req<{ ok: true }>("POST", "/api/bot/scan", {}),
    refreshBriefing: () => req<{ briefing: BotStatus["briefing"] }>("POST", "/api/bot/briefing", {}, 180_000),
    sellPosition: (mint: string, pct: number) => req<{ ok: true }>("POST", "/api/bot/sell", { mint, pct }, 120_000),
    trades: (limit = 100) => req<{ trades: Trade[] }>("GET", `/api/bot/trades?limit=${limit}`),
    equity: (hours = 72) => req<{ points: { ts: number; eur: number }[] }>("GET", `/api/bot/equity?hours=${hours}`),
    withdraw: (sol?: number) => req<{ signature: string; sol: number }>("POST", "/api/bot/withdraw", { sol }, 120_000),
    settings: () =>
      req<{
        settings: BotSettings;
        aiModels: { id: string; label: string; provider: string; inUsd: number; outUsd: number; free: boolean }[];
        aiAvailable: boolean;
        wallets: { bot: string; owner: string | null; ownerLockedByServer: boolean };
      }>("GET", "/api/settings"),
    saveSettings: (patch: Partial<BotSettings>) => req<{ settings: BotSettings }>("PUT", "/api/settings", patch),
    getKeys: () => req<{ keys: Record<string, { set: boolean; value?: string }>; canRestart: boolean; hostSecrets: boolean }>("GET", "/api/keys"),
    walletBackup: () => req<{ needed: boolean; ephemeral: boolean; address: string }>("GET", "/api/wallet-backup"),
    revealWalletBackup: () => req<{ name: string; value: string }>("POST", "/api/wallet-backup/reveal", {}),
    saveKeys: (patch: Record<string, string>) => req<{ ok: boolean; restarting: boolean }>("PUT", "/api/keys", patch),
    registerOwner: (wallet: string) => req<{ owner: string }>("POST", "/api/owner", { wallet }),
    trending: () => req<{ coins: Candidate[]; botPicks: Candidate[] }>("GET", "/api/market/trending", undefined, 60_000),
    search: (q: string) => req<{ coins: Candidate[] }>("GET", `/api/market/search?q=${encodeURIComponent(q)}`),
    token: (mint: string) => req<{ coin: Candidate }>("GET", `/api/token/${mint}`),
    analyzeChartImage: (image: string, mediaType: "image/jpeg" | "image/png", note?: string) =>
      req<{ analysis: ChartRead; model: string }>("POST", "/api/chart/analyze", { image, mediaType, note }, 240_000),
    tokenChart: (mint: string) => req<TokenChart>("GET", `/api/token/${mint}/chart`, undefined, 90_000),
    mlStatus: () => req<MlStatus>("GET", "/api/ml/status"),
    mlTrain: (collect?: boolean) => req<{ started: boolean }>("POST", "/api/ml/train", { collect }),
    askAi: (mint: string) => req<{ opinion: Opinion }>("POST", `/api/token/${mint}/ai`, {}, 180_000),
    wallet: (address: string) => req<WalletInfo>("GET", `/api/wallet/${address}`),
    quote: (inputMint: string, outputMint: string, amount: string, slippageBps = 100) =>
      req<{ quote: QuoteSummary }>("POST", "/api/swap/quote", { inputMint, outputMint, amount, slippageBps }),
    buildSwap: (userPublicKey: string, inputMint: string, outputMint: string, amount: string, slippageBps = 100) =>
      req<{ transaction: string; quote: QuoteSummary; simulationError: { error?: string } | null }>("POST", "/api/swap/build", {
        userPublicKey,
        inputMint,
        outputMint,
        amount,
        slippageBps,
      }),
    buildTransfer: (from: string, to: string, sol: number) => req<{ transaction: string }>("POST", "/api/transfer/build", { from, to, sol }),
    buildFundBot: (from: string, sol: number) => req<{ transaction: string; to: string }>("POST", "/api/transfer/fund-bot", { from, sol }),
    sendSigned: (transaction: string) => req<{ signature: string }>("POST", "/api/tx/send", { transaction }, 120_000),
    onrampProviders: () => req<{ providers: OnrampProvider[] }>("GET", "/api/onramp/providers"),
    onrampUrl: (body: { provider: string; wallet: string; currency: "sol" | "usdc"; amountEur?: number; method?: PayMethod }) =>
      req<{ url: string; prefillsWallet: boolean }>("POST", "/api/onramp/url", body),
  };
}

export type Api = ReturnType<typeof createApi>;
