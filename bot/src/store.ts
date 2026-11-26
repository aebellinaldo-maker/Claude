import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import type { BotEvent, BotState, Settings } from "./types.js";
import { log } from "./util/log.js";

export const DEFAULT_SETTINGS: Settings = {
  language: "en",
  paperBudgetEur: 10,
  realBudgetEur: 0,
  // Lock in the win: when a run is up 10 %, sell everything and stop.
  stopAtProfitPct: 10,
  stopAtLossPct: 0,
  stopAt: 0,
  closeOnStop: true,

  scanIntervalMin: 3,
  monitorIntervalSec: 15,

  // The only mode that tested profitable on unseen days; Auto switches if live data disagrees.
  riskMode: "winrate",
  autoMode: true,
  requireEdge: true,
  strategies: { sniper: true, momentum: true, dip: true, whale: true },
  maxPositions: 4,
  maxPositionPct: 40,
  minTradeSol: 0.01,
  feeReserveSol: 0.012,
  slippageBps: 150,
  maxPriceImpactPct: 2,

  stopLossPct: 15,
  takeProfitPct: 40,
  takeProfitSellPct: 50,
  trailingStopPct: 20,
  maxHoldHours: 24,
  breakevenAfterPct: 0,

  maxDailyLossPct: 20,
  maxDrawdownPct: 50,
  cooldownHours: 6,

  minLiquidityUsd: 50_000,
  minVolume24hUsd: 100_000,
  minPairAgeHours: 24,
  minMarketCapUsd: 250_000,
  maxMarketCapUsd: 5_000_000_000,
  maxRugScore: 50,
  maxPump24hPct: 300,

  aiEnabled: true,
  aiModel: "claude-opus-5-5",
  aiEffort: "medium",
  aiDailyBudgetUsd: 0.5,
  aiIntervalMin: 20,
  aiMinConfidence: 0.6,
  webResearch: true,
  briefingIntervalHours: 12,
};

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function freshState(): BotState {
  return {
    running: false,
    mode: "paper",
    killSwitch: { tripped: false },
    aiSpend: { date: today(), usd: 0, calls: 0 },
    cooldowns: {},
    lastCandidates: [],
    paper: {
      solBalance: 0,
      positions: [],
      startEquityEur: 0,
      peakEquityEur: 0,
      day: { date: today(), startEquityEur: 0 },
    },
    real: {
      positions: [],
      startEquityEur: 0,
      peakEquityEur: 0,
      day: { date: today(), startEquityEur: 0 },
    },
    trades: [],
    equity: [],
    events: [],
    settings: { ...DEFAULT_SETTINGS },
    sessions: [],
    whaleBook: { pending: [], wallets: {} },
    shadow: { open: [], closed: [] },
  };
}

const FILE = path.join(config.dataDir, "state.json");

function load(): BotState {
  try {
    if (fs.existsSync(FILE)) {
      const raw = JSON.parse(fs.readFileSync(FILE, "utf8")) as Partial<BotState>;
      const base = freshState();
      // Merge so new settings fields get defaults after an upgrade.
      return {
        ...base,
        ...raw,
        settings: {
          ...DEFAULT_SETTINGS,
          ...(raw.settings ?? {}),
          strategies: { ...DEFAULT_SETTINGS.strategies, ...(raw.settings?.strategies ?? {}) },
        },
        sessions: raw.sessions ?? [],
        whaleBook: { ...base.whaleBook, ...(raw.whaleBook ?? {}) },
        shadow: { ...base.shadow, ...(raw.shadow ?? {}) },
        paper: { ...base.paper, ...(raw.paper ?? {}) },
        real: { ...base.real, ...(raw.real ?? {}) },
      };
    }
  } catch (e) {
    log.error("Could not read state.json, starting fresh (old file kept as state.broken.json)", e);
    try {
      fs.copyFileSync(FILE, FILE.replace(/\.json$/, ".broken.json"));
    } catch {
      /* ignore */
    }
  }
  return freshState();
}

export const state: BotState = load();

let saveTimer: NodeJS.Timeout | undefined;

/** Debounced, atomic save (write temp file + rename) so a crash never corrupts state. */
export function save(immediate = false) {
  const doSave = () => {
    saveTimer = undefined;
    trimHistory();
    const tmp = FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, FILE);
  };
  if (immediate) {
    if (saveTimer) clearTimeout(saveTimer);
    doSave();
    return;
  }
  if (!saveTimer) saveTimer = setTimeout(doSave, 1000);
}

function trimHistory() {
  if (state.trades.length > 1000) state.trades = state.trades.slice(-1000);
  if (state.equity.length > 4000) state.equity = state.equity.slice(-4000);
  if (state.events.length > 300) state.events = state.events.slice(-300);
  if (state.sessions.length > 30) state.sessions = state.sessions.slice(-30);
  const wb = state.whaleBook;
  if (wb.pending.length > 3000) wb.pending = wb.pending.slice(-3000);
  const wallets = Object.entries(wb.wallets);
  if (wallets.length > 6000) {
    wallets.sort((a, b) => b[1].last - a[1].last);
    wb.wallets = Object.fromEntries(wallets.slice(0, 5000));
  }
  const now = Date.now();
  for (const [mint, until] of Object.entries(state.cooldowns)) if (until < now) delete state.cooldowns[mint];
}

export function addEvent(level: BotEvent["level"], msg: string) {
  state.events.push({ ts: Date.now(), level, msg });
  log[level](msg);
  save();
}

export function portfolio() {
  return state.mode === "paper" ? state.paper : state.real;
}
