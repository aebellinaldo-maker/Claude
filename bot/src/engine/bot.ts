import crypto from "node:crypto";
import { addEvent, portfolio, save, state, today } from "../store.js";
import type { Candidate, Mode, PortfolioState, Position, Trade, TradeTrigger } from "../types.js";
import { discoverCandidates, WATCHLIST } from "../market/discovery.js";
import { getPrices, SOL_MINT } from "../market/jupiter.js";
import { getSolPrice, lastSolEur, usdToEur } from "../market/prices.js";
import { marketFilter, rugCheck } from "../risk/safety.js";
import { scoreCandidate } from "../risk/scoring.js";
import { breakers, buySizeSol, exitSignal } from "../risk/rules.js";
import { aiAvailable, aiBriefing, aiBudgetLeft, aiDecide } from "../ai/claude.js";
import { LiveExecutor, PaperExecutor, TOKEN_ACCOUNT_RENT_SOL, type Executor } from "./executor.js";
import { getTokenHolding } from "../chain/solana.js";
import { botKeypair } from "../chain/solana.js";
import { log, errMsg } from "../util/log.js";
import { L } from "../util/i18n.js";

const l = (en: string, de: string) => L(state.settings.language, en, de);

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
  private busy = false;
  private lastBriefingTry = 0;
  /** Last computed equity, used by the API without hitting the RPC on every request. */
  lastEquity?: Equity;

  // ---------------------------------------------------------------- lifecycle

  boot() {
    // The loop always runs: it protects open positions even while new buys are paused.
    this.timer = setInterval(() => void this.tick(), 5_000);
    void this.tick();
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

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const s = state.settings;
      const now = Date.now();
      if (!state.lastMonitorAt || now - state.lastMonitorAt >= s.monitorIntervalSec * 1000) {
        await this.monitor();
        state.lastMonitorAt = Date.now();
      }
      if (state.running && !state.killSwitch.tripped) {
        const briefingDue =
          s.aiEnabled &&
          aiAvailable() &&
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
      }
      state.lastError = undefined;
    } catch (e) {
      state.lastError = errMsg(e);
      log.error("Bot tick failed", e);
    } finally {
      this.busy = false;
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
    const s = state.settings;
    const p = portfolio();
    if (p.positions.length) {
      const prices = await getPrices(p.positions.map((x) => x.mint));
      for (const pos of [...p.positions]) {
        const pr = prices[pos.mint];
        if (!pr) continue;
        pos.lastPriceUsd = pr.usdPrice;
        if (typeof pr.liquidity === "number") pos.lastLiquidityUsd = pr.liquidity;
        pos.lastUpdate = Date.now();
        const sig = exitSignal(pos, pr.usdPrice, pr.liquidity, Date.now(), s);
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
      }
    }
  }

  private rollDay(p: PortfolioState, equityEur: number) {
    if (p.day.date !== today()) p.day = { date: today(), startEquityEur: equityEur };
  }

  /** Finds candidates, filters them, asks the AI (or rules), and buys. */
  async scan() {
    const s = state.settings;
    const p = portfolio();
    const eq = await this.computeEquity();
    const b = breakers(p, eq.totalEur, s);

    const raw = await discoverCandidates();
    const held = new Set(p.positions.map((x) => x.mint));
    const now = Date.now();
    let passed: Candidate[] = [];
    let rejected = 0;
    for (const c of raw) {
      if (held.has(c.mint)) continue;
      if ((state.cooldowns[c.mint] ?? 0) > now) continue;
      if (marketFilter(c, s).length) {
        rejected++;
        continue;
      }
      const { score, breakdown } = scoreCandidate(c);
      c.score = score;
      c.scoreBreakdown = breakdown;
      passed.push(c);
    }
    passed.sort((a, b2) => (b2.score ?? 0) - (a.score ?? 0));

    // Deep rug check only for the best few (free API, be polite).
    const checked: Candidate[] = [];
    for (const c of passed.slice(0, 12)) {
      c.safety = await rugCheck(c, s);
      const rescored = scoreCandidate(c);
      c.score = rescored.score;
      c.scoreBreakdown = rescored.breakdown;
      if (c.safety.ok) checked.push(c);
      else rejected++;
    }
    checked.sort((a, b2) => (b2.score ?? 0) - (a.score ?? 0));
    passed = checked.slice(0, 8);
    state.lastCandidates = passed;
    log.info(`Scan: ${raw.length} coins found, ${passed.length} passed safety, ${rejected} rejected`);

    const freeSlots = Math.max(0, s.maxPositions - p.positions.length);
    const canBuy = !b.noNewBuys && freeSlots > 0 && eq.cashSol - s.feeReserveSol >= s.minTradeSol;
    if (b.noNewBuys && b.reason) addEvent("warn", b.reason);

    // The AI is consulted only when it can add value, to keep API costs small:
    // a promising coin and a free slot, or an hourly review of open positions.
    const aiReady = s.aiEnabled && aiAvailable() && aiBudgetLeft(s) >= 0.05;
    if (aiReady) {
      const sinceAi = now - (state.lastAiAt ?? 0);
      const promising = canBuy && passed.some((c) => (c.score ?? 0) >= 0.45);
      const reviewDue = p.positions.length > 0 && sinceAi >= 60 * 60_000;
      if (sinceAi < s.aiIntervalMin * 60_000 || !(promising || reviewDue)) return;
      state.lastAiAt = now;

      const solPrice = (await getPrices([SOL_MINT]).catch(() => ({})) as Record<string, { priceChange24h?: number }>)[SOL_MINT];
      const decision = await aiDecide(
        {
          candidates: canBuy ? passed : [],
          positions: p.positions.map((x) => ({
            mint: x.mint,
            symbol: x.symbol,
            pnlPct: Math.round(positionPnlPct(x) * 10) / 10,
            heldHours: Math.round(((now - x.openedAt) / 3_600_000) * 10) / 10,
            valueEur: Math.round(positionValueEur(x) * 100) / 100,
            boughtBecause: x.reason,
          })),
          freeSlots: canBuy ? freeSlots : 0,
          cashEur: eq.cashEur,
          equityEur: eq.totalEur,
          dailyPnlPct: b.dailyPnlPct,
          solChange24hPct: solPrice?.priceChange24h,
          recentTrades: state.trades
            .filter((t) => t.mode === state.mode)
            .slice(-12)
            .map((t) => ({
              symbol: t.symbol,
              side: t.side,
              trigger: t.trigger,
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
        if (canBuy) {
          const buys = decision.buys
            .filter((d) => d.action === "buy" && d.confidence >= s.aiMinConfidence)
            .sort((a, b2) => b2.confidence - a.confidence)
            .slice(0, freeSlots);
          for (const d of buys) {
            const c = passed.find((x) => x.mint === d.mint);
            if (!c) continue; // AI can only pick from the vetted list
            await this.buy(c, d.sizePct, "ai", `${d.reason} (${l("AI confidence", "KI-Sicherheit")} ${Math.round(d.confidence * 100)}%)`);
          }
          if (!buys.length) addEvent("info", l(`AI decided not to buy anything: ${decision.marketView}`, `KI hat entschieden, nichts zu kaufen: ${decision.marketView}`));
        }
        return;
      }
      addEvent("warn", l("AI unavailable this round, using rule-based decisions", "KI diese Runde nicht verfügbar, Regeln entscheiden"));
    }

    // Rule-based fallback.
    if (canBuy) {
      const picks = passed.filter((c) => (c.score ?? 0) >= 0.62).slice(0, Math.min(freeSlots, 1));
      for (const c of picks) {
        await this.buy(c, Math.round((c.score ?? 0.62) * 100), "rules", `${l("Rule score", "Regel-Score")} ${(c.score ?? 0).toFixed(2)}: ${describeBreakdown(c)}`);
      }
    }
  }

  // ---------------------------------------------------------------- trading

  async buy(c: Candidate, sizePct: number, trigger: TradeTrigger, reason: string) {
    const s = state.settings;
    const p = portfolio();
    if (p.positions.length >= s.maxPositions) return;
    const eq = await this.computeEquity();
    const solAmount = buySizeSol({ equitySol: eq.totalSol, freeSol: eq.cashSol, sizePct, s });
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
    const s = state.settings;
    const p = portfolio();
    try {
      const sol = await getSolPrice();
      const res = await executor().sell(pos, pct, s);
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
    save(true);
  }

  /** Manual sell of one position from the app. */
  async manualSell(mint: string, pct: number) {
    const pos = portfolio().positions.find((x) => x.mint === mint);
    if (!pos) throw new Error("Position not found");
    await this.sell(pos, pct, "manual", l("Sold manually by owner", "Manuell vom Besitzer verkauft"));
  }

  private recordTrade(t: Omit<Trade, "id" | "ts" | "mode">) {
    state.trades.push({ ...t, id: crypto.randomUUID(), ts: Date.now(), mode: state.mode });
  }

  isWatchlist(mint: string) {
    return mint in WATCHLIST;
  }
}

function describeBreakdown(c: Candidate): string {
  const b = c.scoreBreakdown ?? {};
  const top = Object.entries(b)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 2)
    .map(([k]) => k);
  const names: Record<string, [string, string]> = {
    momentum: ["momentum", "Momentum"],
    buyPressure: ["buy pressure", "Kaufdruck"],
    volume: ["rising volume", "steigendes Volumen"],
    liquidity: ["deep liquidity", "hohe Liquidität"],
    hype: ["hype/marketing", "Hype/Marketing"],
    safety: ["safety", "Sicherheit"],
  };
  const de = state.settings.language === "de";
  const labels = top.map((k) => (names[k] ? names[k][de ? 1 : 0] : k));
  return de
    ? `stärkste Signale: ${labels.join(", ")}; 1h ${c.priceChange.h1.toFixed(1)}%, 24h-Vol. $${Math.round(c.volume.h24 / 1000)}k`
    : `strongest signals: ${labels.join(", ")}; 1h ${c.priceChange.h1.toFixed(1)}%, 24h vol $${Math.round(c.volume.h24 / 1000)}k`;
}

export const bot = new Bot();
