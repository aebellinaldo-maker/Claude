import crypto from "node:crypto";
import { tradeStats } from "../engine/stats.js";
import { strategies, WINRATE_STRATEGIES } from "../risk/profiles.js";
import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { cors } from "hono/cors";
import { z } from "zod";
import { config } from "../config.js";
import { addEvent, portfolio, save, state } from "../store.js";
import { bot, positionPnlPct, positionValueEur } from "../engine/bot.js";
import { breakers } from "../risk/rules.js";
import { aiAvailable, aiBudgetLeft, aiCanSpend, aiChartImage, aiOpinion, briefingSupported, visionModel } from "../ai/claude.js";
import { availableModels, resolveModel } from "../ai/models.js";
import { discoverCandidates, pairToCandidate } from "../market/discovery.js";
import { getBestPairs, searchPairs } from "../market/dexscreener.js";
import { buildSwapTx, getPrices, getQuote } from "../market/jupiter.js";
import { getSolPrice, usdToEur } from "../market/prices.js";
import { marketFilter, rugCheck } from "../risk/safety.js";
import { scoreCandidate } from "../risk/scoring.js";
import {
  botKeypair,
  botTransferSol,
  botWalletSecretBase58,
  walletBackupNeeded,
  buildTransferTx,
  getSolBalance,
  getTokenHoldings,
  isValidAddress,
  sendUserSigned,
} from "../chain/solana.js";
import { availableProviders, onrampUrl } from "./onramp.js";
import type { Candidate } from "../types.js";
import { TtlCache } from "../util/http.js";
import { L } from "../util/i18n.js";
import { training, trainModel, trainerAvailable } from "../ml/trainer.js";
import { getModel } from "../ml/model.js";
import { listArchives, loadArchive, toGrid } from "../ml/candles.js";
import { analyzeChart } from "../ml/brain.js";
import { canSelfRestart, describeKeys, EDITABLE_KEYS, updateEnvFile } from "../util/envfile.js";
import { log } from "../util/log.js";
import { sessionSummary } from "../engine/session.js";
import { learnedThreshold, shadowSummary } from "../engine/shadow.js";
import { edgeCheck, exitProfile, squadBacktest, standings, STRATEGY_IDS } from "../strategies/squad.js";
import type { RunSession, StrategyId } from "../types.js";

class UserError extends Error {}

const app = new Hono();

app.onError((err, c) => {
  const status = err instanceof UserError || err instanceof z.ZodError ? 400 : 500;
  const message = err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : err.message;
  return c.json({ error: message }, status);
});

// Lets the app also run in a web browser. Safe: every endpoint still requires the API token
// (sent as a header, never as a cookie), so other websites can't use your bot.
app.use("/api/*", cors({ origin: "*", allowHeaders: ["authorization", "content-type"], allowMethods: ["GET", "POST", "PUT"] }));

app.get("/api/health", (c) => c.json({ ok: true, name: "crypto-bot-server", time: Date.now() }));

// Every other endpoint needs the API token (Authorization: Bearer <token>).
app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/health" || c.req.method === "OPTIONS") return next();
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(token);
  const b = Buffer.from(config.apiToken);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return c.json({ error: "Unauthorized" }, 401);
  return next();
});

const addr = z.string().refine(isValidAddress, "invalid Solana address");

function ownerWallet(): string | undefined {
  return config.ownerWallet ?? state.ownerWallet;
}

// ------------------------------------------------------------------ bot status

app.get("/api/bot/status", async (c) => {
  const eq = bot.lastEquity ?? (await bot.computeEquity());
  const p = portfolio();
  const s = state.settings;
  const b = breakers(p, eq.totalEur, s);
  return c.json({
    running: state.running,
    paperBudgetEur: s.paperBudgetEur,
    mode: state.mode,
    riskMode: s.riskMode,
    strategies: strategies(s),
    squad: squadStatus(),
    autoMode: s.autoMode,
    requireEdge: s.requireEdge,
    profitGoalPct: s.stopAtProfitPct,
    shadow: shadowSummary(state.shadow, Date.now(), new Set(STRATEGY_IDS.filter((id) => s.strategies[id])), s.riskMode),
    squadBacktest: squadBacktest(),
    session: state.session ? runSummary(state.session, eq.totalEur) : null,
    stats: tradeStats(state.trades, state.mode, new Set(p.positions.map((x) => x.mint)), 5),
    killSwitch: state.killSwitch,
    lastScanAt: state.lastScanAt ?? null,
    nextScanAt: state.running && state.lastScanAt ? state.lastScanAt + s.scanIntervalMin * 60_000 : null,
    lastMonitorAt: state.lastMonitorAt ?? null,
    lastError: state.lastError ?? null,
    equity: eq,
    pnl: {
      startEur: p.startEquityEur,
      totalEur: p.startEquityEur > 0 ? eq.totalEur - p.startEquityEur : 0,
      totalPct: b.totalPnlPct,
      dailyPct: b.dailyPnlPct,
      drawdownPct: b.drawdownPct,
      noNewBuys: b.noNewBuys,
      breakerReason: b.reason ?? null,
    },
    positions: p.positions.map((x) => ({
      mint: x.mint,
      symbol: x.symbol,
      name: x.name,
      imageUrl: x.imageUrl ?? null,
      valueEur: positionValueEur(x),
      costEur: x.costEur,
      pnlPct: positionPnlPct(x),
      pnlEur: positionValueEur(x) - x.costEur,
      priceUsd: x.lastPriceUsd,
      entryPriceUsd: x.entryPriceUsd,
      openedAt: x.openedAt,
      tookProfit: x.tookProfit,
      reason: x.reason,
    })),
    wallets: { bot: botKeypair.publicKey.toBase58(), owner: ownerWallet() ?? null },
    ai: {
      available: aiAvailable(),
      enabled: s.aiEnabled,
      model: resolveModel(s)?.id ?? s.aiModel,
      modelLabel: resolveModel(s)?.label ?? null,
      free: resolveModel(s)?.free ?? false,
      briefingSupported: briefingSupported(s),
      spentTodayUsd: state.aiSpend.usd,
      callsToday: state.aiSpend.calls,
      budgetUsd: s.aiDailyBudgetUsd,
      budgetLeftUsd: aiBudgetLeft(s),
    },
    briefing: state.briefing ?? null,
    marketView: state.marketView ?? null,
    events: state.events.slice(-30).reverse(),
  });
});

app.post("/api/bot/start", async (c) => {
  try {
    await bot.start();
  } catch (e) {
    throw new UserError((e as Error).message);
  }
  return c.json({ ok: true });
});

app.post("/api/bot/stop", (c) => {
  bot.stop();
  return c.json({ ok: true });
});

app.post("/api/bot/panic", async (c) => {
  await bot.panic();
  return c.json({ ok: true });
});

app.post("/api/bot/mode", async (c) => {
  const { mode } = z.object({ mode: z.enum(["paper", "real"]) }).parse(await c.req.json());
  if (mode === "real" && walletBackupNeeded()) {
    throw new UserError("First save the bot wallet key as the BOT_WALLET_SECRET secret (Settings → Bot wallet backup), or a restart would lose the money.");
  }
  try {
    await bot.setMode(mode);
  } catch (e) {
    throw new UserError((e as Error).message);
  }
  return c.json({ ok: true, mode: state.mode });
});

app.post("/api/bot/paper/reset", async (c) => {
  const body = z.object({ budgetEur: z.number().min(1).max(100_000).optional() }).parse(await c.req.json().catch(() => ({})));
  if (state.running && state.mode === "paper") throw new UserError("Stop the bot first.");
  if (body.budgetEur) state.settings.paperBudgetEur = body.budgetEur;
  await bot.resetPaper();
  return c.json({ ok: true });
});

app.post("/api/bot/baseline/reset", async (c) => {
  await bot.resetBaseline();
  return c.json({ ok: true });
});

app.post("/api/bot/scan", (c) => {
  if (!state.running) throw new UserError("Start the bot first.");
  state.lastScanAt = 0;
  return c.json({ ok: true });
});

app.post("/api/bot/briefing", async (c) => {
  if (!briefingSupported(state.settings)) {
    throw new UserError("The research briefing needs a Claude model (it uses Claude's web search). Other models use the free market data instead.");
  }
  await bot.refreshBriefing();
  return c.json({ briefing: state.briefing ?? null });
});

app.post("/api/bot/sell", async (c) => {
  const { mint, pct } = z.object({ mint: addr, pct: z.number().min(1).max(100) }).parse(await c.req.json());
  await bot.manualSell(mint, pct);
  return c.json({ ok: true });
});

function runSummary(sess: RunSession, valueNowEur: number) {
  const positions = sess.mode === state.mode ? portfolio().positions.map((pos) => ({ pos, valueEur: positionValueEur(pos) })) : [];
  return sessionSummary(sess, state.trades, state.equity, positions, valueNowEur);
}

/** Each strategy: on/off, benched, money weight, exits and its own record (current mode). */
function squadStatus() {
  const s = state.settings;
  const sum = shadowSummary(state.shadow, Date.now(), new Set(STRATEGY_IDS.filter((id) => s.strategies[id])), s.riskMode);
  const cur = sum.current;
  const sitsOut = (id: StrategyId) => s.riskMode === "winrate" && !WINRATE_STRATEGIES.has(id);
  const st = standings(state.trades, state.mode, new Set(portfolio().positions.map((x) => x.mint)), cur);
  return Object.fromEntries(
    STRATEGY_IDS.map((id) => [
      id,
      {
        enabled: s.strategies[id],
        benched: st[id].benched,
        weight: st[id].weight,
        exits: exitProfile(sitsOut(id) ? { ...s, riskMode: "normal" } : s, id),
        closed: st[id].stats.closed,
        winRate: st[id].stats.winRate,
        profitFactor: st[id].stats.profitFactor,
        realizedEur: st[id].stats.realizedEur,
        basis: st[id].basis,
        // A strategy that sits out in High win rate mode is shown with its own (normal) rules.
        liveTest: sitsOut(id) ? sum.byStrategy[id].normal : cur[id],
        learned: learnedThreshold(state.shadow, Date.now(), id, sitsOut(id) ? "normal" : s.riskMode),
        edge: s.requireEdge && !sitsOut(id) ? edgeCheck(cur[id], state.mode, s.language) : { ok: true },
      },
    ]),
  );
}

/** The current run (or a past one by id), with the full summary. */
app.get("/api/session", async (c) => {
  const id = c.req.query("id");
  const sess = id ? (state.sessions.find((x) => x.id === id) ?? (state.session?.id === id ? state.session : undefined)) : state.session;
  if (!sess) return c.json({ session: null });
  const eq = bot.lastEquity ?? (await bot.computeEquity());
  return c.json({ session: runSummary(sess, eq.totalEur) });
});

app.get("/api/sessions", (c) =>
  c.json({
    sessions: [...state.sessions].reverse().map((x) => ({
      id: x.id,
      mode: x.mode,
      startedAt: x.startedAt,
      endedAt: x.endedAt ?? null,
      startEur: x.startEquityEur,
      endEur: x.endEquityEur ?? null,
    })),
  }),
);

app.get("/api/bot/trades", (c) => {
  const limit = Math.min(500, Number(c.req.query("limit") ?? 100));
  const mode = c.req.query("mode") ?? state.mode;
  return c.json({ trades: state.trades.filter((t) => t.mode === mode).slice(-limit).reverse() });
});

app.get("/api/bot/equity", (c) => {
  const mode = c.req.query("mode") ?? state.mode;
  const hours = Number(c.req.query("hours") ?? 72);
  const since = Date.now() - hours * 3_600_000;
  return c.json({ points: state.equity.filter((e) => e.mode === mode && e.ts >= since) });
});

app.post("/api/bot/withdraw", async (c) => {
  const body = z.object({ sol: z.number().positive().optional() }).parse(await c.req.json().catch(() => ({})));
  const owner = ownerWallet();
  if (!owner) throw new UserError("Connect your Phantom wallet in the app first (it becomes the only withdrawal address).");
  const balance = await getSolBalance(botKeypair.publicKey);
  const keep = portfolio().positions.length > 0 && state.mode === "real" ? state.settings.feeReserveSol : 0;
  const fee = 0.00001;
  const max = Math.max(0, balance - keep - fee);
  const amount = Math.min(body.sol ?? max, max);
  if (amount <= 0.0001) throw new UserError("Nothing to withdraw.");
  const signature = await botTransferSol(owner, Math.floor(amount * 1e9));
  addEvent("info", L(state.settings.language, `Withdrew ${amount.toFixed(4)} SOL to your Phantom wallet`, `${amount.toFixed(4)} SOL an dein Phantom-Wallet ausgezahlt`));
  if (state.mode === "real") await bot.resetBaseline();
  return c.json({ ok: true, signature, sol: amount });
});

// ------------------------------------------------------------------ settings

const SettingsPatch = z
  .object({
    language: z.enum(["en", "de"]),
    paperBudgetEur: z.number().min(1).max(100_000),
    realBudgetEur: z.number().min(0).max(1_000_000),
    stopAtProfitPct: z.number().min(0).max(100_000),
    stopAtLossPct: z.number().min(0).max(100),
    stopAt: z.number().min(0),
    closeOnStop: z.boolean(),
    riskMode: z.enum(["normal", "moonshot", "winrate"]),
    autoMode: z.boolean(),
    requireEdge: z.boolean(),
    strategies: z.object({ sniper: z.boolean(), momentum: z.boolean(), dip: z.boolean(), whale: z.boolean() }).partial(),
    scanIntervalMin: z.number().min(2).max(240),
    monitorIntervalSec: z.number().min(10).max(600),
    maxPositions: z.number().int().min(1).max(10),
    maxPositionPct: z.number().min(5).max(100),
    minTradeSol: z.number().min(0.001).max(10),
    feeReserveSol: z.number().min(0.005).max(1),
    slippageBps: z.number().int().min(10).max(1000),
    maxPriceImpactPct: z.number().min(0.1).max(15),
    stopLossPct: z.number().min(2).max(90),
    takeProfitPct: z.number().min(5).max(1000),
    takeProfitSellPct: z.number().min(10).max(100),
    trailingStopPct: z.number().min(2).max(90),
    maxHoldHours: z.number().min(1).max(24 * 30),
    breakevenAfterPct: z.number().min(0).max(100),
    maxDailyLossPct: z.number().min(1).max(100),
    maxDrawdownPct: z.number().min(5).max(100),
    cooldownHours: z.number().min(0).max(168),
    minLiquidityUsd: z.number().min(5_000),
    minVolume24hUsd: z.number().min(0),
    minPairAgeHours: z.number().min(0).max(24 * 365),
    minMarketCapUsd: z.number().min(0),
    maxMarketCapUsd: z.number().min(0),
    maxRugScore: z.number().min(0).max(100),
    maxPump24hPct: z.number().min(10).max(100_000),
    aiEnabled: z.boolean(),
    aiModel: z.string().refine((id) => availableModels().some((m) => m.id === id), "this AI model is not configured on the server"),
    aiEffort: z.enum(["low", "medium", "high"]),
    aiDailyBudgetUsd: z.number().min(0).max(100),
    aiIntervalMin: z.number().min(5).max(24 * 60),
    aiMinConfidence: z.number().min(0).max(1),
    webResearch: z.boolean(),
    briefingIntervalHours: z.number().min(1).max(48),
  })
  .partial();

app.get("/api/settings", (c) =>
  c.json({
    // Show the brain actually in use (the first configured one if the saved choice isn't available).
    settings: { ...state.settings, aiModel: resolveModel(state.settings)?.id ?? state.settings.aiModel },
    aiModels: availableModels().map((m) => ({ id: m.id, label: m.label, provider: m.provider, inUsd: m.inUsd, outUsd: m.outUsd, free: m.free })),
    aiAvailable: aiAvailable(),
    wallets: { bot: botKeypair.publicKey.toBase58(), owner: ownerWallet() ?? null, ownerLockedByServer: !!config.ownerWallet },
  }),
);

app.put("/api/settings", async (c) => {
  const patch = SettingsPatch.parse(await c.req.json());
  const { strategies: sp, ...rest } = patch;
  Object.assign(state.settings, rest);
  if (sp) state.settings.strategies = { ...state.settings.strategies, ...sp };
  save(true);
  return c.json({ settings: state.settings });
});

/** The first Phantom wallet that connects becomes the owner (withdrawal) address. */
app.post("/api/owner", async (c) => {
  const { wallet } = z.object({ wallet: addr }).parse(await c.req.json());
  if (config.ownerWallet) {
    if (config.ownerWallet !== wallet) throw new UserError("A different owner wallet is set in the server's OWNER_WALLET setting.");
  } else if (state.ownerWallet && state.ownerWallet !== wallet) {
    throw new UserError(
      "Another wallet is already registered as owner. To change it, set OWNER_WALLET on the server or delete ownerWallet from data/state.json.",
    );
  } else if (!state.ownerWallet) {
    state.ownerWallet = wallet;
    addEvent("info", L(state.settings.language, "Owner wallet registered", "Besitzer-Wallet registriert") + `: ${wallet.slice(0, 4)}…${wallet.slice(-4)}`);
  }
  return c.json({ owner: ownerWallet() });
});

// ------------------------------------------------------------------ market

const marketCache = new TtlCache<Candidate[]>(5 * 60_000);

async function enrich(cands: Candidate[], withRug: number): Promise<Candidate[]> {
  const s = state.settings;
  for (const c of cands) {
    const r = scoreCandidate(c);
    c.score = r.score;
    c.scoreBreakdown = r.breakdown;
  }
  cands.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  for (const c of cands.slice(0, withRug)) c.safety = await rugCheck(c, s);
  return cands;
}

app.get("/api/market/trending", async (c) => {
  const s = state.settings;
  let list = marketCache.get("trending");
  if (!list) {
    const all = await discoverCandidates();
    list = await enrich(all, 0);
    marketCache.set("trending", list);
  }
  return c.json({
    coins: list.slice(0, 40).map((x) => ({ ...x, filterReasons: marketFilter(x, s) })),
    botPicks: state.lastCandidates,
  });
});

app.get("/api/market/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.json({ coins: [] });
  let pairs;
  if (isValidAddress(q)) pairs = [...(await getBestPairs([q])).values()];
  else pairs = await searchPairs(q);
  const seen = new Map<string, Candidate>();
  for (const p of pairs) {
    const cand = pairToCandidate(p);
    const cur = seen.get(cand.mint);
    if (!cur || cand.liquidityUsd > cur.liquidityUsd) seen.set(cand.mint, cand);
  }
  const list = await enrich([...seen.values()].slice(0, 20), 0);
  return c.json({ coins: list.map((x) => ({ ...x, filterReasons: marketFilter(x, state.settings) })) });
});

async function tokenDetail(mint: string): Promise<Candidate> {
  const pairs = await getBestPairs([mint]);
  const pair = pairs.get(mint);
  if (!pair) throw new UserError("No trading pair found for this token.");
  const cand = pairToCandidate(pair);
  await enrich([cand], 1);
  return cand;
}

app.get("/api/token/:mint", async (c) => {
  const mint = addr.parse(c.req.param("mint"));
  const cand = await tokenDetail(mint);
  return c.json({ coin: { ...cand, filterReasons: marketFilter(cand, state.settings) } });
});

app.post("/api/token/:mint/ai", async (c) => {
  const mint = addr.parse(c.req.param("mint"));
  if (!aiAvailable()) throw new UserError("No AI is configured on the server (set ANTHROPIC_API_KEY, OLLAMA_MODELS, OPENROUTER_API_KEY or XAI_API_KEY).");
  if (!aiCanSpend(state.settings, 0.03)) throw new UserError("Today's AI budget is used up.");
  const cand = await tokenDetail(mint);
  await analyzeChart(cand).catch(() => undefined);
  const opinion = await aiOpinion(cand, state.settings);
  if (!opinion) throw new UserError("The AI could not give an opinion right now. Try again later.");
  return c.json({ opinion });
});

/** Chart photo analysis: the app sends a screenshot, the AI reads the candles. */
app.post("/api/chart/analyze", async (c) => {
  const body = z
    .object({
      // ~5 MB image limit (base64 is 4/3 of the size); the app resizes photos well below this.
      image: z.string().min(100).max(7_000_000),
      mediaType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]).default("image/jpeg"),
      note: z.string().max(300).optional(),
    })
    .parse(await c.req.json());
  const m = visionModel(state.settings);
  if (!m) throw new UserError("No AI is configured on the server (set ANTHROPIC_API_KEY, OLLAMA_MODELS, OPENROUTER_API_KEY or XAI_API_KEY).");
  if (!m.free && aiBudgetLeft(state.settings) < 0.05) throw new UserError("Today's AI budget is used up.");
  const r = await aiChartImage({ base64: body.image.replace(/^data:[^;]+;base64,/, ""), mediaType: body.mediaType }, body.note, state.settings);
  if (!r.read) {
    throw new UserError(
      `The AI couldn't read this chart${r.error ? ` (${r.error.slice(0, 160)})` : ""}.` +
        (m.provider === "claude" ? "" : " With Ollama/OpenRouter/Grok, pick a model that can see images."),
    );
  }
  return c.json({ analysis: r.read, model: r.model });
});

/** Last 24 h price chart + chart analysis + own-model probability for one coin. */
app.get("/api/token/:mint/chart", async (c) => {
  const mint = addr.parse(c.req.param("mint"));
  const cand = await tokenDetail(mint);
  await analyzeChart(cand);
  const grid = toGrid(loadArchive(cand.pairAddress)?.candles ?? []).slice(-96);
  const m = getModel();
  return c.json({
    candles: grid.map((k) => ({ t: k[0], o: k[1], h: k[2], l: k[3], c: k[4], v: Math.round(k[5]) })),
    chart: cand.chart ?? null,
    mlProb: cand.mlProb ?? null,
    model: m
      ? {
          threshold: m.threshold,
          baseWinRate: m.data.baseWinRate,
          tpPct: m.params.tpPct,
          slPct: m.params.slPct,
          hours: m.params.horizonBars / 4,
          useful: m.metrics.useful,
          tradeReady: m.metrics.tradeReady,
        }
      : null,
  });
});

// ------------------------------------------------------------------ own trained model

app.get("/api/ml/status", (c) => {
  const m = getModel();
  return c.json({
    model: m
      ? { createdAt: m.createdAt, params: m.params, threshold: m.threshold, data: m.data, metrics: m.metrics, importance: m.importance }
      : null,
    training: {
      running: training.running,
      phase: training.phase,
      startedAt: training.startedAt ?? null,
      finishedAt: training.finishedAt ?? null,
      progress: training.progress ?? null,
      error: training.error ?? null,
      log: training.log.slice(-15),
    },
    archiveCoins: listArchives().length,
    trainerAvailable: trainerAvailable(),
  });
});

app.post("/api/ml/train", async (c) => {
  const body = z.object({ collect: z.boolean().optional() }).parse(await c.req.json().catch(() => ({})));
  if (!trainerAvailable()) throw new UserError("The trainer (ml/train.py) is missing on the server.");
  if (training.running) return c.json({ started: false, running: true });
  void trainModel({ collect: body.collect });
  return c.json({ started: true });
});

// ------------------------------------------------------------------ wallet & swaps (your Phantom wallet)

app.get("/api/wallet/:address", async (c) => {
  const address = addr.parse(c.req.param("address"));
  const [sol, solPrice, holdings] = await Promise.all([getSolBalance(address), getSolPrice(), getTokenHoldings(address)]);
  const nonEmpty = holdings.filter((h) => h.raw > 0n);
  const mints = nonEmpty.map((h) => h.mint);
  const [prices, pairs] = await Promise.all([
    mints.length ? getPrices(mints).catch(() => ({})) : Promise.resolve({}),
    mints.length ? getBestPairs(mints).catch(() => new Map()) : Promise.resolve(new Map()),
  ]);
  const tokens = nonEmpty
    .map((h) => {
      const pr = (prices as Record<string, { usdPrice: number }>)[h.mint];
      const pair = (pairs as Map<string, { baseToken: { symbol: string; name: string }; info?: { imageUrl?: string }; priceChange?: Record<string, number> }>).get(h.mint);
      const valueEur = pr ? usdToEur(pr.usdPrice * h.uiAmount) : 0;
      return {
        mint: h.mint,
        symbol: pair?.baseToken.symbol ?? h.mint.slice(0, 4) + "…",
        name: pair?.baseToken.name ?? "Unknown token",
        imageUrl: pair?.info?.imageUrl ?? null,
        amount: h.uiAmount,
        decimals: h.decimals,
        raw: h.raw.toString(),
        priceUsd: pr?.usdPrice ?? null,
        change24h: pair?.priceChange?.h24 ?? null,
        valueEur,
      };
    })
    .sort((a, b) => b.valueEur - a.valueEur);
  const solEur = sol * solPrice.eur;
  return c.json({
    sol,
    solEur,
    solPriceEur: solPrice.eur,
    tokens,
    totalEur: solEur + tokens.reduce((s, t) => s + t.valueEur, 0),
  });
});

const SwapReq = z.object({
  inputMint: addr,
  outputMint: addr,
  amount: z.string().regex(/^\d+$/, "amount must be an integer in the token's smallest unit"),
  slippageBps: z.number().int().min(10).max(1000).default(100),
});

app.post("/api/swap/quote", async (c) => {
  const r = SwapReq.parse(await c.req.json());
  const q = await getQuote(r);
  return c.json({ quote: await summarizeQuote(q) });
});

app.post("/api/swap/build", async (c) => {
  const r = SwapReq.extend({ userPublicKey: addr }).parse(await c.req.json());
  const q = await getQuote(r);
  const tx = await buildSwapTx(q, r.userPublicKey);
  return c.json({ transaction: tx.swapTransaction, quote: await summarizeQuote(q), simulationError: tx.simulationError ?? null });
});

async function summarizeQuote(q: Awaited<ReturnType<typeof getQuote>>) {
  const prices = await getPrices([q.inputMint, q.outputMint]).catch(() => ({}) as Awaited<ReturnType<typeof getPrices>>);
  const inDecimals = prices[q.inputMint]?.decimals ?? null;
  const outDecimals = prices[q.outputMint]?.decimals ?? null;
  const outPrice = prices[q.outputMint]?.usdPrice;
  return {
    inDecimals,
    outDecimals,
    outValueUsd: outPrice && outDecimals !== null ? (Number(q.outAmount) / 10 ** outDecimals) * outPrice : null,
    inputMint: q.inputMint,
    outputMint: q.outputMint,
    inAmount: q.inAmount,
    outAmount: q.outAmount,
    minOutAmount: q.otherAmountThreshold,
    priceImpactPct: Number(q.priceImpactPct) * 100,
    slippageBps: q.slippageBps,
    route: (q.routePlan as { swapInfo?: { label?: string } }[]).map((r) => r.swapInfo?.label ?? "?").join(" → "),
  };
}

/** Unsigned transfer from your Phantom wallet to the bot wallet (you sign it in Phantom). */
app.post("/api/transfer/fund-bot", async (c) => {
  const { from, sol } = z.object({ from: addr, sol: z.number().positive().max(1000) }).parse(await c.req.json());
  if (walletBackupNeeded()) {
    throw new UserError("First save the bot wallet key as the BOT_WALLET_SECRET secret (Settings → Bot wallet backup), or a restart would lose the money.");
  }
  const transaction = await buildTransferTx(from, botKeypair.publicKey.toBase58(), Math.floor(sol * 1e9));
  return c.json({ transaction, to: botKeypair.publicKey.toBase58() });
});

/** Unsigned SOL transfer from your Phantom wallet to any address (e.g. your Coinbase deposit address). You sign it in Phantom. */
app.post("/api/transfer/build", async (c) => {
  const { from, to, sol } = z.object({ from: addr, to: addr, sol: z.number().positive().max(100_000) }).parse(await c.req.json());
  if (from === to) throw new UserError("From and to are the same address.");
  const transaction = await buildTransferTx(from, to, Math.floor(sol * 1e9));
  return c.json({ transaction });
});

/** Broadcasts a transaction you signed in Phantom (used when Phantom returns a signed tx instead of sending it). */
app.post("/api/tx/send", async (c) => {
  const { transaction } = z.object({ transaction: z.string().min(50) }).parse(await c.req.json());
  const signature = await sendUserSigned(transaction);
  return c.json({ signature });
});

app.get("/api/prices/sol", async (c) => c.json(await getSolPrice()));

// ------------------------------------------------------------------ buy crypto (card / PayPal / Apple Pay)

app.get("/api/onramp/providers", (c) => c.json({ providers: availableProviders() }));

app.post("/api/onramp/url", async (c) => {
  const r = z
    .object({
      provider: z.enum(["moonpay", "transak", "moonpay_web"]),
      wallet: addr,
      currency: z.enum(["sol", "usdc"]).default("sol"),
      amountEur: z.number().min(1).max(20_000).optional(),
      method: z.enum(["card", "paypal", "apple_pay", "google_pay", "bank"]).optional(),
    })
    .parse(await c.req.json());
  try {
    return c.json(onrampUrl(r));
  } catch (e) {
    throw new UserError((e as Error).message);
  }
});

// ------------------------------------------------------------------ server keys (enter API keys from the app)

app.get("/api/keys", (c) => c.json({ keys: describeKeys(), canRestart: canSelfRestart(), hostSecrets: config.ephemeral }));

/** Wallet backup on hosts that wipe files: shows the generated key once so it can be saved as a secret. */
app.get("/api/wallet-backup", (c) =>
  c.json({ needed: walletBackupNeeded(), ephemeral: config.ephemeral, address: botKeypair.publicKey.toBase58() }),
);
app.post("/api/wallet-backup/reveal", (c) => {
  if (!walletBackupNeeded()) throw new UserError("The bot wallet is already saved as a secret.");
  return c.json({ name: "BOT_WALLET_SECRET", value: botWalletSecretBase58() });
});

app.put("/api/keys", async (c) => {
  const body = z.record(z.string(), z.string().max(600)).parse(await c.req.json());
  const patch: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!(k in EDITABLE_KEYS)) throw new UserError(`${k} can't be changed from the app`);
    patch[k] = v.trim();
  }
  if (!Object.keys(patch).length) throw new UserError("Nothing to save.");
  if (config.ephemeral) throw new UserError("On this host, add keys as secrets in the host's settings (e.g. Hugging Face → Settings → Variables and secrets).");
  updateEnvFile(patch);
  addEvent("info", L(state.settings.language, `Server keys updated: ${Object.keys(patch).join(", ")}`, `Server-Schlüssel aktualisiert: ${Object.keys(patch).join(", ")}`));
  const restarting = canSelfRestart();
  if (restarting) {
    // The service manager (systemd) starts the bot again with the new keys.
    setTimeout(() => {
      log.info("Restarting to apply new keys");
      bot.shutdown();
      process.exit(0);
    }, 500);
  }
  return c.json({ ok: true, restarting });
});

// ------------------------------------------------------------------ web version of the app

if (fs.existsSync(path.join(config.webDir, "index.html"))) {
  const root = path.relative(process.cwd(), config.webDir) || ".";
  app.use("/*", serveStatic({ root }));
  // Single-page app: unknown paths (e.g. /bot, /token/…) load the app, which routes itself.
  app.get("*", (c) => {
    if (c.req.path.startsWith("/api/")) return c.json({ error: "Not found" }, 404);
    return c.html(fs.readFileSync(path.join(config.webDir, "index.html"), "utf8"));
  });
  log.info(`Serving the web app from ${config.webDir}`);
}

export { app };
