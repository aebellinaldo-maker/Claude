import crypto from "node:crypto";
import { addEvent, portfolio, save, state, today } from "../store.js";
import type { Candidate, Mode, PortfolioState, Position, RiskMode, StrategyId, Trade, TradeTrigger } from "../types.js";
import { discoverCandidates, WATCHLIST } from "../market/discovery.js";
import { getPrices, SOL_MINT } from "../market/jupiter.js";
import { getSolPrice, lastSolEur, usdToEur } from "../market/prices.js";
import { marketFilter, rugCheck } from "../risk/safety.js";
import { scoreCandidate } from "../risk/scoring.js";
import { autoStopReason, breakers, buySizeSol, exitSignal, tradeable } from "../risk/rules.js";
import { effectiveSettings, WINRATE_STRATEGIES } from "../risk/profiles.js";
import {
  allSignals,
  dipCandidate,
  edgeCheck,
  exitProfile,
  exitSettings,
  FAST_LANE_STRENGTH,
  sniperFilter,
  sniperSignal,
  SNIPER_MAX_AGE_H,
  standings,
  STRATEGIES,
  STRATEGY_IDS,
  winrateEntryOk,
} from "../strategies/squad.js";
import { getLaunchMints } from "../market/launches.js";
import { getHolderInfo } from "../market/rugcheck.js";
import { getWhaleInfo, gradeWhaleBuys, isSmartWallet, mintsToGrade } from "../market/whales.js";
import { learnedThreshold, openShadow, shadowSummary, updateShadows } from "./shadow.js";
import { tradeStats } from "./stats.js";
import { aiBriefing, aiBudgetLeft, aiCanSpend, aiDecide, briefingSupported } from "../ai/claude.js";
import { LiveExecutor, PaperExecutor, TOKEN_ACCOUNT_RENT_SOL, type Executor } from "./executor.js";
import { getTokenHolding } from "../chain/solana.js";
import { resolveModel } from "../ai/models.js";
import { analyzeChart, mlPicks } from "../ml/brain.js";
import { updateArchive } from "../ml/candles.js";
import { getModel } from "../ml/model.js";
import { retrainDue, trainModel } from "../ml/trainer.js";
import { botKeypair } from "../chain/solana.js";
import { log, errMsg } from "../util/log.js";
import { L } from "../util/i18n.js";

const l = (en: string, de: string) => L(state.settings.language, en, de);

const STRATEGY_LABEL: Record<StrategyId, string> = { sniper: "Sniper", momentum: "Momentum", dip: "Dip Hunter", whale: "Whale Tail" };

const paperExec = new PaperExecutor();
const liveExec = new LiveExecutor();

export interface Equity {
  cashSol: number;
  cashEur: number;
  positionsEur: number;
  totalEur: number;
  totalSol: number;
  solEur: number;
  solUsd: number;
}

function executor(): Executor {
  return state.mode === "paper" ? paperExec : liveExec;
}

function rawToUi(raw: string | bigint, decimals: number): number {
  return Number(BigInt(raw)) / 10 ** decimals;
}

/**
 * What the position is worth: coins at the current price, plus the ~0.002 SOL
 * token-account deposit that comes back when the position is fully sold.
 */
export function positionValueEur(p: Position): number {
  return usdToEur(rawToUi(p.rawAmount, p.decimals) * p.lastPriceUsd) + TOKEN_ACCOUNT_RENT_SOL * lastSolEur();
}

export function positionPnlPct(p: Position): number {
  return p.entryPriceUsd > 0 ? (p.lastPriceUsd / p.entryPriceUsd - 1) * 100 : 0;
}

class Bot {
  private timer?: NodeJS.Timeout;
  /** The protection loop and the scan/AI loop run independently, so a slow AI never delays a stop-loss. */
  private monitorBusy = false;
  private scanBusy = false;
  /** Coins with a buy/sell in flight (prevents selling the same coin twice at once). */
  private trading = new Set<string>();
  private lastBriefingTry = 0;
  private warnedUnproven = false;
  /** Signals the AI has already judged (mint:strategy → time), so it's only asked about new ones. */
  private aiSeen = new Map<string, number>();
  private lastWhaleGrade = 0;
  private lastShadowUpdate = 0;
  private lastAutoSwitch = 0;
  private lastEdgeNote = 0;
  /** Last computed equity, used by the API without hitting the RPC on every request. */
  lastEquity?: Equity;

  // ---------------------------------------------------------------- lifecycle

  boot() {
    // The loop always runs: it protects open positions even while new buys are paused.
    const tick = () => {
      void this.tickMonitor();
      void this.tickScan();
      // The own model retrains itself weekly in the background (and once enough charts exist).
      if (retrainDue()) void trainModel();
    };
    this.timer = setInterval(tick, 5_000);
    tick();
  }

  shutdown() {
    if (this.timer) clearInterval(this.timer);
    save(true);
  }

  async start() {
    if (state.killSwitch.tripped) {
      state.killSwitch = { tripped: false };
      addEvent("info", l("Kill switch reset by owner", "Not-Aus vom Besitzer zurückgesetzt"));
    }
    if (state.mode === "paper" && state.paper.positions.length === 0 && state.paper.solBalance <= 0) {
      await this.resetPaper();
    }
    const p = portfolio(); // after a possible reset, which replaces the paper object
    const eq = await this.computeEquity();
    if (eq.totalEur <= 0.5) {
      throw new Error(
        state.mode === "real"
          ? "The bot wallet is empty. Send SOL to it from Phantom first."
          : "Paper balance is empty. Reset paper trading first.",
      );
    }
    if (p.startEquityEur === 0) {
      p.startEquityEur = eq.totalEur;
      p.peakEquityEur = eq.totalEur;
    }
    p.day = { date: today(), startEquityEur: eq.totalEur };
    state.running = true;
    state.session = { id: crypto.randomUUID(), mode: state.mode, startedAt: Date.now(), startEquityEur: eq.totalEur };
    state.lastScanAt = 0; // scan right away
    addEvent(
      "info",
      l(
        `Bot started in ${state.mode.toUpperCase()} mode with €${eq.totalEur.toFixed(2)}`,
        `Bot gestartet (${state.mode === "paper" ? "Testgeld" : "Echtgeld"}) mit ${eq.totalEur.toFixed(2)} €`,
      ),
    );
    save(true);
  }

  stop(reason?: string) {
    state.running = false;
    this.endSession();
    addEvent(
      "info",
      `${reason ?? l("Paused by owner", "Vom Besitzer pausiert")}. ${l(
        "Open positions are still protected by stop-loss/take-profit.",
        "Offene Positionen bleiben durch Stop-Loss/Take-Profit geschützt.",
      )}`,
    );
    save(true);
  }

  async setMode(mode: Mode) {
    if (mode === state.mode) return;
    if (state.running) throw new Error("Stop the bot before switching mode.");
    state.mode = mode;
    if (mode === "real") {
      // Re-sync tracked positions with what is really in the wallet.
      await this.reconcileReal();
    }
    addEvent("info", l(`Switched to ${mode.toUpperCase()} mode`, `Umgeschaltet auf ${mode === "paper" ? "Testgeld" : "Echtgeld"}`));
    save(true);
  }

  async resetPaper() {
    const sol = await getSolPrice();
    state.paper = {
      solBalance: state.settings.paperBudgetEur / sol.eur,
      positions: [],
      startEquityEur: 0,
      peakEquityEur: 0,
      day: { date: today(), startEquityEur: 0 },
    };
    state.trades = state.trades.filter((t) => t.mode !== "paper");
    state.equity = state.equity.filter((e) => e.mode !== "paper");
    addEvent(
      "info",
      l(
        `Paper account reset to €${state.settings.paperBudgetEur} (${state.paper.solBalance.toFixed(4)} SOL)`,
        `Testkonto auf ${state.settings.paperBudgetEur} € zurückgesetzt (${state.paper.solBalance.toFixed(4)} SOL)`,
      ),
    );
    save(true);
  }

  /** Resets the P&L baseline of the current mode (e.g. after funding or withdrawing). */
  async resetBaseline() {
    const eq = await this.computeEquity();
    const p = portfolio();
    p.startEquityEur = eq.totalEur;
    p.peakEquityEur = eq.totalEur;
    p.day = { date: today(), startEquityEur: eq.totalEur };
    save(true);
  }

  private async reconcileReal() {
    const kept: Position[] = [];
    for (const pos of state.real.positions) {
      try {
        const h = await getTokenHolding(botKeypair.publicKey, pos.mint);
        if (h && h.raw > 0n) {
          pos.rawAmount = h.raw.toString();
          kept.push(pos);
        }
      } catch {
        kept.push(pos);
      }
    }
    state.real.positions = kept;
  }

  // ---------------------------------------------------------------- equity

  async computeEquity(): Promise<Equity> {
    const sol = await getSolPrice();
    const p = portfolio();
    const cashSol = await executor().cashSol();
    const positionsEur = p.positions.reduce((sum, pos) => sum + positionValueEur(pos), 0);
    const cashEur = cashSol * sol.eur;
    const totalEur = cashEur + positionsEur;
    const eq: Equity = {
      cashSol,
      cashEur,
      positionsEur,
      totalEur,
      totalSol: totalEur / sol.eur,
      solEur: sol.eur,
      solUsd: sol.usd,
    };
    this.lastEquity = eq;
    return eq;
  }

  // ---------------------------------------------------------------- main loop

  /** Every ~30 s: prices, stop-loss / take-profit, circuit breakers. */
  private async tickMonitor() {
    if (this.monitorBusy) return;
    const s = state.settings;
    if (state.lastMonitorAt && Date.now() - state.lastMonitorAt < s.monitorIntervalSec * 1000) return;
    this.monitorBusy = true;
    try {
      await this.monitor();
      state.lastMonitorAt = Date.now();
      state.lastError = undefined;
    } catch (e) {
      state.lastError = errMsg(e);
      log.error("Monitor failed", e);
    } finally {
      this.monitorBusy = false;
      save();
    }
  }

  /** Every scan interval: research briefing, discovery, AI decisions, buys. */
  private async tickScan() {
    if (this.scanBusy || !state.running || state.killSwitch.tripped) return;
    this.scanBusy = true;
    try {
      const s = state.settings;
      const now = Date.now();
      const briefingDue =
        s.aiEnabled &&
        briefingSupported(s) &&
        (!state.briefing || now - state.briefing.ts >= s.briefingIntervalHours * 3_600_000) &&
        now - this.lastBriefingTry > 30 * 60_000;
      if (briefingDue) {
        this.lastBriefingTry = now;
        await this.refreshBriefing();
      }
      if (!state.lastScanAt || now - state.lastScanAt >= s.scanIntervalMin * 60_000) {
        state.lastScanAt = Date.now();
        await this.scan();
      }
    } catch (e) {
      state.lastError = errMsg(e);
      log.error("Scan failed", e);
    } finally {
      this.scanBusy = false;
      save();
    }
  }

  async refreshBriefing() {
    const s = state.settings;
    if (aiBudgetLeft(s) < 0.1) return;
    const text = await aiBriefing(s);
    if (text) {
      state.briefing = { text, ts: Date.now(), lang: s.language };
      addEvent("info", l("New AI market briefing", "Neue KI-Marktrecherche"));
    }
  }

  /** Updates prices, applies hard exit rules and circuit breakers. */
  async monitor() {
    const s = effectiveSettings(state.settings);
    const p = portfolio();
    await this.updateShadow();
    if (p.positions.length) {
      const prices = await getPrices(p.positions.map((x) => x.mint));
      for (const pos of [...p.positions]) {
        const pr = prices[pos.mint];
        if (!pr) continue;
        pos.lastPriceUsd = pr.usdPrice;
        if (typeof pr.liquidity === "number") pos.lastLiquidityUsd = pr.liquidity;
        pos.lastUpdate = Date.now();
        const sig = exitSignal(pos, pr.usdPrice, pr.liquidity, Date.now(), exitSettings(state.settings, pos.strategy));
        pos.peakPriceUsd = Math.max(pos.peakPriceUsd, pr.usdPrice);
        if (sig.action === "sell") await this.sell(pos, sig.pct, sig.trigger, sig.reason);
      }
    }

    const eq = await this.computeEquity();
    if (state.running) this.rollDay(p, eq.totalEur);
    p.peakEquityEur = Math.max(p.peakEquityEur, eq.totalEur);

    const last = state.equity[state.equity.length - 1];
    if (!last || last.mode !== state.mode || Date.now() - last.ts >= 5 * 60_000) {
      state.equity.push({ ts: Date.now(), eur: Math.round(eq.totalEur * 10000) / 10000, mode: state.mode });
    }

    if (state.running) {
      const b = breakers(p, eq.totalEur, s);
      if (b.killSwitch && !state.killSwitch.tripped) {
        state.killSwitch = { tripped: true, reason: b.reason, at: Date.now() };
        addEvent("error", l(`KILL SWITCH: ${b.reason}. Selling everything and stopping.`, `NOT-AUS: ${b.reason}. Alles wird verkauft, Bot stoppt.`));
        await this.sellAll("kill_switch", b.reason ?? l("Kill switch", "Not-Aus"));
        state.running = false;
        await this.computeEquity().catch(() => undefined);
        this.endSession();
      }
      // The owner's own stop conditions (profit target, loss limit, end time).
      // With a real-money budget, measure profit/loss against the budget, not the whole wallet.
      const basis = state.mode === "real" && s.realBudgetEur > 0 ? Math.min(p.startEquityEur, s.realBudgetEur) : p.startEquityEur;
      const pnlPct = basis > 0 ? ((eq.totalEur - p.startEquityEur) / basis) * 100 : 0;
      const stopReason = state.running && p.startEquityEur > 0 ? autoStopReason(pnlPct, Date.now(), s) : null;
      if (stopReason) {
        state.running = false;
        state.settings.stopAt = 0; // a planned end time is used once (s may be a copy)
        if (s.closeOnStop) {
          addEvent("info", l(`AUTO-STOP: ${stopReason}. Selling everything.`, `AUTO-STOPP: ${stopReason}. Alles wird verkauft.`));
          await this.sellAll("auto_stop", stopReason);
          await this.computeEquity().catch(() => undefined);
          this.endSession();
        } else {
          addEvent("info", l(`AUTO-STOP: ${stopReason}. No new buys; open coins stay protected.`, `AUTO-STOPP: ${stopReason}. Keine neuen Käufe; offene Coins bleiben geschützt.`));
        }
      }
    }
  }

  private rollDay(p: PortfolioState, equityEur: number) {
    if (p.day.date !== today()) p.day = { date: today(), startEquityEur: equityEur };
  }

  /** Finds coins for each strategy, checks them, lets the AI (or the rules) choose, and buys. */
  async scan() {
    this.autoSwitchMode();
    const s = effectiveSettings(state.settings);
    const p = portfolio();
    const eq = await this.computeEquity();
    const b = breakers(p, eq.totalEur, s);
    const now = Date.now();
    const held = new Set(p.positions.map((x) => x.mint));
    // Every strategy the owner switched on is TRACKED (its signals go into the shadow test),
    // but only the ones allowed in this mode and not benched may TRADE.
    const tracked = new Set(STRATEGY_IDS.filter((id) => s.strategies[id]));
    const stand = standings(state.trades, state.mode, held, shadowEvidence(tracked, s.riskMode));
    // "High win rate" mode only uses the two strategies it was tested with.
    // "Only trade what's winning": strategies losing in the live test sit out (shadow keeps testing them).
    const live = shadowSummary(state.shadow, now, tracked, s.riskMode).current;
    const enabled = new Set(
      STRATEGY_IDS.filter(
        (id) =>
          tracked.has(id) &&
          !stand[id].benched &&
          (s.riskMode !== "winrate" || WINRATE_STRATEGIES.has(id)) &&
          (!s.requireEdge || edgeCheck(live[id], state.mode, s.language).ok),
      ),
    );

    await this.gradeWhales();
    const sitting = STRATEGY_IDS.filter((id) => tracked.has(id) && !enabled.has(id));
    if (!enabled.size && tracked.size && s.requireEdge && now - this.lastEdgeNote > 3_600_000) {
      this.lastEdgeNote = now;
      const why = sitting.map((id) => `${STRATEGY_LABEL[id]}: ${edgeCheck(live[id], state.mode, s.language).reason ?? l("not allowed in this mode", "in diesem Modus nicht erlaubt")}`);
      addEvent(
        "info",
        l(
          `Waiting — no strategy is winning in the live test right now, so nothing is bought (${why.join("; ")}). The live test keeps running.`,
          `Warte — gerade gewinnt keine Strategie im Live-Test, darum wird nichts gekauft (${why.join("; ")}). Der Live-Test läuft weiter.`,
        ),
      );
    }

    // 1) Discover: trending / boosted / watchlist coins, plus fresh launches for the Sniper.
    const launches = tracked.has("sniper") ? await getLaunchMints() : [];
    const raw = await discoverCandidates(launches);
    const young: Candidate[] = [];
    const standard: Candidate[] = [];
    let rejected = 0;
    for (const c of raw) {
      if (held.has(c.mint) || (state.cooldowns[c.mint] ?? 0) > now) continue;
      if (c.ageHours > 0 && c.ageHours <= SNIPER_MAX_AGE_H && !(c.mint in WATCHLIST)) {
        if (tracked.has("sniper") && !sniperFilter(c, s).length) young.push(c);
        else rejected++;
        continue;
      }
      if (marketFilter(c, s).length) {
        rejected++;
        continue;
      }
      const { score, breakdown } = scoreCandidate(c);
      c.score = score;
      c.scoreBreakdown = breakdown;
      standard.push(c);
    }

    // 2) Shortlist per strategy, then the deeper (slower) checks only for those.
    standard.sort((a, b2) => (b2.score ?? 0) - (a.score ?? 0));
    const pick = new Map<string, Candidate>();
    for (const c of standard.slice(0, 8)) pick.set(c.mint, c);
    if (tracked.has("dip")) for (const c of standard.filter(dipCandidate).slice(0, 4)) pick.set(c.mint, c);
    if (tracked.has("whale")) for (const c of [...standard].sort((a, b2) => b2.volume.h1 - a.volume.h1).slice(0, 4)) pick.set(c.mint, c);
    const checked: Candidate[] = [];
    for (const c of [...pick.values()].slice(0, 14)) {
      c.safety = await rugCheck(c, s);
      if (!c.safety.ok) {
        rejected++;
        continue;
      }
      const re = scoreCandidate(c);
      c.score = re.score;
      c.scoreBreakdown = re.breakdown;
      checked.push(c);
    }
    // Charts (Dip Hunter needs them; they also keep the own model's archive growing).
    for (const c of checked) await analyzeChart(c);
    if (tracked.has("whale")) {
      for (const c of [...checked].sort((a, b2) => b2.volume.h1 - a.volume.h1).slice(0, 5)) {
        c.whales = await getWhaleInfo(c.pairAddress, c.mint, c.liquidityUsd, state.whaleBook);
      }
    }
    let shadowed = 0;
    for (const c of checked) {
      const sigs = allSignals(c, s, tracked);
      for (const sg of sigs) if (openShadow(state.shadow, c, sg, now)) shadowed++;
      c.signal =
        sigs.find((sg) => enabled.has(sg.strategy) && (s.riskMode !== "winrate" || winrateEntryOk(c, sg.strategy))) ?? undefined;
    }

    // Young coins: holder check (developer powers, concentrated supply), then the Sniper signal.
    young.sort((a, b2) => b2.volume.h1 * (b2.txns.h1.buys / Math.max(1, b2.txns.h1.sells)) - a.volume.h1 * (a.txns.h1.buys / Math.max(1, a.txns.h1.sells)));
    for (const c of young.slice(0, 6)) {
      try {
        c.holders = await getHolderInfo(c.mint);
      } catch {
        rejected++;
        continue;
      }
      c.safety = await rugCheck(c, s);
      const sig = c.safety.ok ? sniperSignal(c, s) : null;
      if (!sig) {
        rejected++;
        continue;
      }
      if (openShadow(state.shadow, c, sig, now)) shadowed++;
      if (!enabled.has("sniper")) continue; // tracked in the shadow test, but not traded in this mode
      c.signal = sig;
      checked.push(c);
    }

    const final = checked.filter((c) => c.signal).sort((a, b2) => b2.signal!.strength - a.signal!.strength).slice(0, 10);
    state.lastCandidates = final;
    log.info(
      `Scan: ${raw.length} coins (${launches.length} launches), ${final.length} tradeable signals, ${shadowed} new shadow trades, ${rejected} rejected — ` +
        final.map((c) => `${c.symbol}:${c.signal!.strategy}:${c.signal!.strength}`).join(" "),
    );
    for (const pos of p.positions) {
      if (pos.pool) await updateArchive({ pool: pos.pool, mint: pos.mint, symbol: pos.symbol }, 1, false);
    }

    // 3) Free slots: overall, and per strategy.
    const openBy: Partial<Record<StrategyId, number>> = {};
    for (const x of p.positions) openBy[x.strategy ?? "momentum"] = (openBy[x.strategy ?? "momentum"] ?? 0) + 1;
    const freeTotal = Math.max(0, s.maxPositions - p.positions.length);
    const room = tradeable(eq, s, state.mode);
    const canBuy = !b.noNewBuys && freeTotal > 0 && room.freeSol - s.feeReserveSol >= s.minTradeSol;
    if (b.noNewBuys && b.reason) addEvent("warn", b.reason);
    const slotFor = (id: StrategyId) => enabled.has(id) && (openBy[id] ?? 0) < STRATEGIES[id].maxOpen;
    // Self-tuning: a strategy only buys signals above the strength its live test says pays off.
    const learned = Object.fromEntries(STRATEGY_IDS.map((id) => [id, learnedThreshold(state.shadow, now, id, s.riskMode).minStrength])) as Record<
      StrategyId,
      number | null
    >;
    const buyable = canBuy
      ? final.filter((c) => slotFor(c.signal!.strategy) && c.signal!.strength >= (learned[c.signal!.strategy] ?? 0))
      : [];
    const tryBuy = async (c: Candidate, sizePct: number, trigger: TradeTrigger, reason: string) => {
      const id = c.signal!.strategy;
      if (!state.running || state.killSwitch.tripped || !slotFor(id) || portfolio().positions.length >= s.maxPositions) return;
      await this.buy(c, sizePct, trigger, reason);
      if (portfolio().positions.some((x) => x.mint === c.mint)) openBy[id] = (openBy[id] ?? 0) + 1;
    };
    const why = (c: Candidate) => `${STRATEGY_LABEL[c.signal!.strategy]}: ${c.signal!.notes.join(", ")}`;

    // Own trained model as the brain: buy what it rates above its tested threshold.
    const brain = resolveModel(s);
    if (s.aiEnabled && brain?.provider === "ml") {
      const mm = getModel()?.metrics;
      // Paper money: the model must beat the baselines on unseen coins and days.
      // Real money: it must ALSO be confirmed on forward-recorded charts.
      const allowed = state.mode === "real" ? mm?.tradeReady : mm?.useful;
      if (allowed) {
        for (const pick of mlPicks(buyable, freeTotal, s)) await tryBuy(pick.c, pick.sizePct, "ml", `${why(pick.c)}. ${pick.reason}`);
        return;
      }
      if (!this.warnedUnproven) {
        this.warnedUnproven = true;
        addEvent(
          "warn",
          mm?.useful && state.mode === "real"
            ? l(
                "Own model passed the back-test but isn't confirmed on forward-recorded charts yet — with real money the rules decide until it is",
                "Eigenes Modell hat den Backtest bestanden, ist aber auf vorwärts aufgezeichneten Charts noch nicht bestätigt — mit Echtgeld entscheiden bis dahin die Regeln",
              )
            : l(
                "Own model hasn't proven better than simple rules yet — the rules decide until it does",
                "Eigenes Modell ist noch nicht nachweislich besser als einfache Regeln — bis dahin entscheiden die Regeln",
              ),
        );
      }
    }

    // 4) The AI decides when there is something new to decide (a fresh signal) or a review is due,
    //    at most every few minutes; in between, only very strong signals are bought by the rules.
    for (const [k, ts] of this.aiSeen) if (now - ts > 2 * 3_600_000) this.aiSeen.delete(k);
    const aiReady = s.aiEnabled && brain?.provider !== "ml" && aiCanSpend(s);
    if (aiReady) {
      const sinceAi = now - (state.lastAiAt ?? 0);
      const fresh = buyable.filter((c) => c.signal!.strength >= 0.5 && !this.aiSeen.has(`${c.mint}:${c.signal!.strategy}`));
      const reviewDue = p.positions.length > 0 && sinceAi >= 60 * 60_000;
      const minGap = Math.max(3, s.aiIntervalMin / 4) * 60_000;
      const due = (fresh.length > 0 && sinceAi >= minGap) || (sinceAi >= s.aiIntervalMin * 60_000 && (buyable.length > 0 || reviewDue));
      if (!due) {
        const strong = buyable.find((c) => c.signal!.strength >= FAST_LANE_STRENGTH);
        if (strong) await tryBuy(strong, Math.round(strong.signal!.strength * 100), "rules", `${why(strong)} (${l("very strong signal", "sehr starkes Signal")})`);
        return;
      }
      state.lastAiAt = now;
      for (const c of buyable) this.aiSeen.set(`${c.mint}:${c.signal!.strategy}`, now);

      const solPrice = (await getPrices([SOL_MINT]).catch(() => ({})) as Record<string, { priceChange24h?: number }>)[SOL_MINT];
      const liveTest = shadowSummary(state.shadow, now, tracked, s.riskMode).current;
      const decision = await aiDecide(
        {
          candidates: buyable,
          positions: p.positions.map((x) => ({
            mint: x.mint,
            symbol: x.symbol,
            strategy: x.strategy ?? "momentum",
            pnlPct: Math.round(positionPnlPct(x) * 10) / 10,
            heldHours: Math.round(((now - x.openedAt) / 3_600_000) * 10) / 10,
            valueEur: Math.round(positionValueEur(x) * 100) / 100,
            boughtBecause: x.reason,
          })),
          freeSlots: buyable.length ? freeTotal : 0,
          cashEur: eq.cashEur,
          equityEur: eq.totalEur,
          dailyPnlPct: b.dailyPnlPct,
          solChange24hPct: solPrice?.priceChange24h,
          strategy: { risk_mode: s.riskMode },
          squad: Object.fromEntries(
            STRATEGY_IDS.map((id) => [
              id,
              {
                enabled: enabled.has(id),
                free_slots: Math.max(0, STRATEGIES[id].maxOpen - (openBy[id] ?? 0)),
                exits: exitProfile(s, id),
                money_weight: stand[id].weight,
                closed_trades: stand[id].stats.closed,
                win_rate: stand[id].stats.winRate,
                profit_factor: stand[id].stats.profitFactor,
                live_signal_test: liveTest[id],
                learned_min_signal_strength: learned[id],
              },
            ]),
          ),
          trackRecord: trackRecordForAi(p),
          recentTrades: state.trades
            .filter((t) => t.mode === state.mode)
            .slice(-12)
            .map((t) => ({
              symbol: t.symbol,
              side: t.side,
              trigger: t.trigger,
              strategy: t.strategy ?? "momentum",
              pnlPct: t.pnlPct !== undefined ? Math.round(t.pnlPct * 10) / 10 : undefined,
              hoursAgo: Math.round(((now - t.ts) / 3_600_000) * 10) / 10,
            })),
        },
        s,
      );
      if (decision) {
        state.marketView = decision.marketView;
        for (const ex of decision.exits) {
          const pos = p.positions.find((x) => x.mint === ex.mint);
          if (pos && ex.action === "sell" && ex.sellPct > 0) await this.sell(pos, ex.sellPct, "ai_exit", ex.reason);
        }
        const buys = decision.buys
          .filter((d) => d.action === "buy" && d.confidence >= s.aiMinConfidence)
          .sort((a, b2) => b2.confidence - a.confidence);
        for (const d of buys) {
          const c = buyable.find((x) => x.mint === d.mint);
          if (!c) continue; // the AI can only pick from the vetted list
          await tryBuy(c, d.sizePct, "ai", `${STRATEGY_LABEL[c.signal!.strategy]}: ${d.reason} (${l("AI confidence", "KI-Sicherheit")} ${Math.round(d.confidence * 100)}%)`);
        }
        if (buyable.length && !buys.length) addEvent("info", l(`AI decided not to buy anything: ${decision.marketView}`, `KI hat entschieden, nichts zu kaufen: ${decision.marketView}`));
        return;
      }
      addEvent("warn", l("AI unavailable this round, using rule-based decisions", "KI diese Runde nicht verfügbar, Regeln entscheiden"));
    }

    // 5) Rule-based decisions: each strategy buys its signals above its own threshold.
    let bought = 0;
    for (const c of buyable) {
      if (bought >= 2) break;
      if (c.signal!.strength < STRATEGIES[c.signal!.strategy].ruleMin) continue;
      await tryBuy(c, Math.round(c.signal!.strength * 100), "rules", `${why(c)} (${l("signal", "Signal")} ${c.signal!.strength.toFixed(2)})`);
      bought++;
    }
  }

  /** Every ~90 s: move every virtual (shadow) trade forward with live prices. */
  private async updateShadow() {
    const now = Date.now();
    if (now - this.lastShadowUpdate < 90_000 || !state.shadow.open.length) return;
    this.lastShadowUpdate = now;
    try {
      const mints = [...new Set(state.shadow.open.map((t) => t.mint))];
      const prices = await getPrices(mints);
      const finished = updateShadows(
        state.shadow,
        Object.fromEntries(Object.entries(prices).map(([m, pr]) => [m, pr.usdPrice])),
        now,
        state.settings,
      );
      if (finished) log.info(`Shadow test: ${finished} virtual trades finished (${state.shadow.closed.length} total, ${state.shadow.open.length} open)`);
    } catch (e) {
      log.debug(`Shadow update skipped: ${errMsg(e)}`);
    }
  }

  /** Auto mode: switch to the mode that is winning in the live shadow test (at most every 6 h). */
  private autoSwitchMode() {
    const st = state.settings;
    if (!st.autoMode) return;
    const now = Date.now();
    if (now - this.lastAutoSwitch < 6 * 3_600_000) return;
    const sum = shadowSummary(state.shadow, now, new Set(STRATEGY_IDS.filter((id) => st.strategies[id])), st.riskMode);
    if (!sum.bestMode || sum.bestMode === st.riskMode) return;
    const from = st.riskMode;
    st.riskMode = sum.bestMode;
    this.lastAutoSwitch = now;
    const name = { normal: "Normal", winrate: l("High win rate", "Hohe Trefferquote"), moonshot: "Moonshot" };
    const a = sum.byMode[sum.bestMode].avgPct,
      b2 = sum.byMode[from].avgPct;
    addEvent(
      "info",
      l(
        `AUTO MODE: switched to ${name[sum.bestMode]} — in the live test it made ${a}% per trade vs ${b2}% for ${name[from]}`,
        `AUTO-MODUS: auf ${name[sum.bestMode]} gewechselt — im Live-Test ${a}% pro Trade gegenüber ${b2}% bei ${name[from]}`,
      ),
    );
    save(true);
  }

  /** Every ~10 min: grade big-wallet buys that are 6 h old (did the price go up?). */
  private async gradeWhales() {
    const now = Date.now();
    if (now - this.lastWhaleGrade < 10 * 60_000) return;
    this.lastWhaleGrade = now;
    const mints = mintsToGrade(state.whaleBook, now);
    if (!mints.length) return;
    try {
      const prices = await getPrices(mints);
      const n = gradeWhaleBuys(state.whaleBook, Object.fromEntries(Object.entries(prices).map(([m, pr]) => [m, pr.usdPrice])), now);
      if (n) log.info(`Whale Tail: graded ${n} big-wallet buys; ${Object.values(state.whaleBook.wallets).filter(isSmartWallet).length} smart wallets known`);
    } catch (e) {
      log.debug(`Whale grading skipped: ${errMsg(e)}`);
    }
  }

  // ---------------------------------------------------------------- trading

  async buy(c: Candidate, sizePct: number, trigger: TradeTrigger, reason: string) {
    if (this.trading.has(c.mint)) return;
    this.trading.add(c.mint);
    try {
      await this.doBuy(c, sizePct, trigger, reason);
    } finally {
      this.trading.delete(c.mint);
    }
  }

  private async doBuy(c: Candidate, sizePct: number, trigger: TradeTrigger, reason: string) {
    const s = effectiveSettings(state.settings);
    const p = portfolio();
    if (p.positions.length >= s.maxPositions) return;
    const strategy: StrategyId = c.signal?.strategy ?? "momentum";
    // Smaller bets for riskier styles, more money for strategies with a good record.
    const weight = standings(state.trades, state.mode, new Set(p.positions.map((x) => x.mint)), shadowEvidence(new Set(STRATEGY_IDS), s.riskMode))[strategy]
      .weight;
    const scaledPct = Math.round(Math.max(25, Math.min(100, sizePct * STRATEGIES[strategy].sizeFactor * weight)));
    const eq = await this.computeEquity();
    const room = tradeable(eq, s, state.mode);
    const solAmount = buySizeSol({ equitySol: room.equitySol, freeSol: room.freeSol, sizePct: scaledPct, s });
    if (solAmount <= 0) {
      addEvent("info", l(`Skipped ${c.symbol}: not enough free SOL for a trade`, `${c.symbol} übersprungen: nicht genug freie SOL`));
      return;
    }
    try {
      const prices = await getPrices([c.mint]);
      const pr = prices[c.mint];
      if (!pr) throw new Error("no Jupiter price/decimals");
      const res = await executor().buy(c.mint, solAmount, s);
      const tokens = Number(res.rawReceived) / 10 ** pr.decimals;
      // Entry price from the swap itself (fees and the refundable token-account deposit
      // are excluded, otherwise the stop-loss would fire too early on small trades).
      const entryPriceUsd = tokens > 0 ? (solAmount * eq.solUsd) / tokens : pr.usdPrice;
      const costEur = res.solSpent * eq.solEur;
      const existing = p.positions.find((x) => x.mint === c.mint);
      if (existing) {
        const newRaw = BigInt(existing.rawAmount) + res.rawReceived;
        const oldTokens = rawToUi(existing.rawAmount, existing.decimals);
        existing.entryPriceUsd = (existing.entryPriceUsd * oldTokens + entryPriceUsd * tokens) / (oldTokens + tokens);
        existing.rawAmount = newRaw.toString();
        existing.costSol += res.solSpent;
        existing.costEur += costEur;
      } else {
        p.positions.push({
          mint: c.mint,
          symbol: c.symbol,
          name: c.name,
          decimals: pr.decimals,
          rawAmount: res.rawReceived.toString(),
          costSol: res.solSpent,
          costEur,
          entryPriceUsd,
          openedAt: Date.now(),
          peakPriceUsd: entryPriceUsd,
          tookProfit: false,
          entryLiquidityUsd: pr.liquidity ?? c.liquidityUsd,
          lastPriceUsd: pr.usdPrice,
          lastLiquidityUsd: pr.liquidity ?? c.liquidityUsd,
          lastUpdate: Date.now(),
          reason,
          imageUrl: c.imageUrl,
          pool: c.pairAddress,
          strategy,
        });
      }
      this.recordTrade({
        side: "buy",
        mint: c.mint,
        symbol: c.symbol,
        solAmount: res.solSpent,
        tokenAmount: tokens,
        priceUsd: entryPriceUsd,
        valueEur: costEur,
        trigger,
        reason,
        signature: res.signature,
        strategy,
        imageUrl: c.imageUrl,
      });
      addEvent(
        "info",
        l(
          `BUY ${c.symbol} for ${res.solSpent.toFixed(4)} SOL (€${costEur.toFixed(2)}) — ${reason}`,
          `KAUF ${c.symbol} für ${res.solSpent.toFixed(4)} SOL (${costEur.toFixed(2)} €) — ${reason}`,
        ),
      );
    } catch (e) {
      addEvent("warn", l(`Buy ${c.symbol} failed: ${errMsg(e)}`, `Kauf ${c.symbol} fehlgeschlagen: ${errMsg(e)}`));
      state.cooldowns[c.mint] = Date.now() + 60 * 60_000;
    }
    save();
  }

  async sell(pos: Position, pct: number, trigger: TradeTrigger, reason: string) {
    // Skip if this coin is already being traded or was sold in the meantime.
    if (this.trading.has(pos.mint) || !portfolio().positions.includes(pos)) return;
    this.trading.add(pos.mint);
    try {
      await this.doSell(pos, pct, trigger, reason);
    } finally {
      this.trading.delete(pos.mint);
    }
  }

  private async doSell(pos: Position, pct: number, trigger: TradeTrigger, reason: string) {
    const s = effectiveSettings(state.settings);
    const p = portfolio();
    try {
      const sol = await getSolPrice();
      const urgent = ["stop_loss", "rug_exit", "panic", "kill_switch", "trailing_stop", "auto_stop"].includes(trigger);
      const res = await executor().sell(pos, pct, s, urgent);
      const rawBefore = BigInt(pos.rawAmount);
      const fraction = rawBefore > 0n ? Number(res.rawSold) / Number(rawBefore) : 1;
      const costPartSol = pos.costSol * fraction;
      const costPartEur = pos.costEur * fraction;
      const valueEur = res.solReceived * sol.eur;
      const pnlEur = valueEur - costPartEur;
      const pnlPct = costPartEur > 0 ? (pnlEur / costPartEur) * 100 : 0;
      const tokens = Number(res.rawSold) / 10 ** pos.decimals;

      const remaining = rawBefore - res.rawSold;
      if (remaining <= 0n || fraction > 0.999) {
        p.positions = p.positions.filter((x) => x !== pos);
      } else {
        pos.rawAmount = remaining.toString();
        pos.costSol -= costPartSol;
        pos.costEur -= costPartEur;
        if (trigger === "take_profit") pos.tookProfit = true;
      }
      if (trigger === "stop_loss" || trigger === "rug_exit") {
        state.cooldowns[pos.mint] = Date.now() + s.cooldownHours * 3_600_000;
      }
      this.recordTrade({
        side: "sell",
        mint: pos.mint,
        symbol: pos.symbol,
        solAmount: res.solReceived,
        tokenAmount: tokens,
        priceUsd: tokens > 0 ? (res.solReceived * sol.usd) / tokens : pos.lastPriceUsd,
        valueEur,
        trigger,
        reason,
        pnlEur,
        pnlPct,
        signature: res.signature,
        strategy: pos.strategy ?? "momentum",
        imageUrl: pos.imageUrl,
      });
      addEvent(
        pnlEur >= 0 ? "info" : "warn",
        l(
          `SELL ${Math.round(fraction * 100)}% ${pos.symbol} for €${valueEur.toFixed(2)} (${pnlEur >= 0 ? "+" : ""}€${pnlEur.toFixed(2)}, ${pnlPct.toFixed(1)}%) — ${reason}`,
          `VERKAUF ${Math.round(fraction * 100)}% ${pos.symbol} für ${valueEur.toFixed(2)} € (${pnlEur >= 0 ? "+" : ""}${pnlEur.toFixed(2)} €, ${pnlPct.toFixed(1)}%) — ${reason}`,
        ),
      );
    } catch (e) {
      addEvent("error", l(`Sell ${pos.symbol} failed: ${errMsg(e)}`, `Verkauf ${pos.symbol} fehlgeschlagen: ${errMsg(e)}`));
    }
    save();
  }

  async sellAll(trigger: TradeTrigger, reason: string) {
    const p = portfolio();
    for (const pos of [...p.positions]) await this.sell(pos, 100, trigger, reason);
  }

  async panic() {
    state.running = false;
    addEvent("warn", l("PANIC SELL: selling everything and stopping the bot", "NOTVERKAUF: alles wird verkauft, Bot stoppt"));
    await this.sellAll("panic", l("Panic sell by owner", "Notverkauf durch Besitzer"));
    await this.computeEquity().catch(() => undefined);
    this.endSession();
    save(true);
  }

  /** Manual sell of one position from the app. */
  async manualSell(mint: string, pct: number) {
    const pos = portfolio().positions.find((x) => x.mint === mint);
    if (!pos) throw new Error("Position not found");
    await this.sell(pos, pct, "manual", l("Sold manually by owner", "Manuell vom Besitzer verkauft"));
  }

  /** Closes the current run and keeps it in the history (for the session summary). */
  private endSession() {
    const cur = state.session;
    if (!cur || cur.endedAt) return;
    cur.endedAt = Date.now();
    cur.endEquityEur = this.lastEquity?.totalEur ?? cur.startEquityEur;
    state.sessions = [...state.sessions.filter((x) => x.id !== cur.id), { ...cur }];
  }

  private recordTrade(t: Omit<Trade, "id" | "ts" | "mode">) {
    state.trades.push({ ...t, id: crypto.randomUUID(), ts: Date.now(), mode: state.mode });
  }

  isWatchlist(mint: string) {
    return mint in WATCHLIST;
  }
}

/** The live shadow test per strategy, as it trades in the given mode (for the allocator). */
function shadowEvidence(tracked: Set<StrategyId>, mode: RiskMode) {
  const cur = shadowSummary(state.shadow, Date.now(), tracked, mode).current;
  return Object.fromEntries(STRATEGY_IDS.map((id) => [id, { n: cur[id].n, profitFactor: cur[id].profitFactor }]));
}

/** The bot's own closed trades — why it bought and how it ended — so the AI learns from them. */
function trackRecordForAi(p: PortfolioState) {
  const st = tradeStats(state.trades, state.mode, new Set(p.positions.map((x) => x.mint)), 12);
  if (!st.closed) return null;
  return {
    closed_trades: st.closed,
    win_rate: st.winRate,
    avg_win_pct: st.avgWinPct,
    avg_loss_pct: st.avgLossPct,
    profit_factor: st.profitFactor,
    last_closed: st.recent.map((t) => ({
      symbol: t.symbol,
      result_pct: Math.round(t.pnlPct * 10) / 10,
      held_hours: Math.round(((t.closedAt - t.openedAt) / 3_600_000) * 10) / 10,
      exit: t.exitTriggers.join("+"),
      why_bought: t.why.slice(0, 220),
      days_ago: Math.round(((Date.now() - t.closedAt) / 86_400_000) * 10) / 10,
    })),
  };
}

export const bot = new Bot();
