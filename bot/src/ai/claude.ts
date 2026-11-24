/**
 * The bot's AI brain. Claude is called through the Anthropic SDK (with web search for
 * the market briefing); Ollama / OpenRouter / Grok go through ./providers.ts. All of
 * them return the same validated JSON decisions.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { config } from "../config.js";
import { save, state, today } from "../store.js";
import type { AiDecision, AiExit, Candidate, Lang, Settings } from "../types.js";
import { log, errMsg } from "../util/log.js";
import { availableModels, costUsd, resolveModel, type ModelInfo } from "./models.js";
import { structuredChat } from "./providers.js";
import { getMarketContext } from "../market/context.js";
import { getModel } from "../ml/model.js";
import { mlOpinion } from "../ml/brain.js";

const WEB_SEARCH_USD = 0.01; // $10 per 1,000 searches

const client = config.anthropicApiKey ? new Anthropic({ apiKey: config.anthropicApiKey }) : null;

/** True when at least one AI brain is configured on the server. */
export function aiAvailable(): boolean {
  return availableModels().length > 0;
}

/** Whether the selected brain can make another call now (free models are never budget-limited). */
export function aiCanSpend(s: Settings, minUsd = 0.05): boolean {
  const m = resolveModel(s);
  if (!m) return false;
  return m.free || aiBudgetLeft(s) >= minUsd;
}

/** Beta flags + server-side refusal fallback for Claude models that support it. */
function fallbackParams(m: ModelInfo) {
  return m.fallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : { betas: [] as string[] };
}

function resetSpendIfNewDay() {
  if (state.aiSpend.date !== today()) state.aiSpend = { date: today(), usd: 0, calls: 0 };
}

export function aiBudgetLeft(s: Settings): number {
  resetSpendIfNewDay();
  return Math.max(0, s.aiDailyBudgetUsd - state.aiSpend.usd);
}

function addSpend(m: ModelInfo, usd: number, detail: string): number {
  resetSpendIfNewDay();
  state.aiSpend.usd += usd;
  state.aiSpend.calls += 1;
  save();
  log.info(`AI call (${m.id}): ${detail} ≈ $${usd.toFixed(4)}`);
  return usd;
}

function recordClaudeUsage(m: ModelInfo, usage: Anthropic.Beta.BetaUsage): number {
  const inTok = usage.input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const outTok = usage.output_tokens ?? 0;
  const searches = usage.server_tool_use?.web_search_requests ?? 0;
  const usd = costUsd(m, inTok + cacheWrite * 1.25 + cacheRead * 0.1, outTok) + searches * WEB_SEARCH_USD;
  return addSpend(m, usd, `${inTok + cacheRead + cacheWrite} in / ${outTok} out tokens, ${searches} searches`);
}

function langLine(lang: Lang) {
  return lang === "de"
    ? "Write every human-readable text field (reason, market_view, summary, points) in German."
    : "Write every human-readable text field in English.";
}

/** Runs one structured request on whichever brain is selected. */
async function ask<T extends z.ZodType>(
  m: ModelInfo,
  what: string,
  system: string,
  userText: string,
  schema: T,
): Promise<{ data: z.infer<T> | null; usd: number }> {
  try {
    if (m.provider === "claude") {
      if (!client) return { data: null, usd: 0 };
      const res = await client.beta.messages.parse({
        model: m.id,
        max_tokens: 16000,
        ...fallbackParams(m),
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        output_config: { effort: state.settings.aiEffort, format: betaZodOutputFormat(schema) },
        messages: [{ role: "user", content: userText }],
      });
      const usd = recordClaudeUsage(m, res.usage);
      if (res.stop_reason === "refusal") {
        log.warn(`AI declined the ${what} request (${res.stop_details?.category ?? "no category"})`);
        return { data: null, usd };
      }
      if (!res.parsed_output) log.warn(`AI ${what} could not be parsed (stop_reason=${res.stop_reason})`);
      return { data: (res.parsed_output ?? null) as z.infer<T> | null, usd };
    }
    const r = await structuredChat(m, system, userText, schema);
    const usd = addSpend(m, r.usd, `${r.inTokens} in / ${r.outTokens} out tokens`);
    if (!r.data) log.warn(`AI ${what} (${m.id}) answer unusable: ${r.error ?? "unknown"}`);
    return { data: r.data as z.infer<T> | null, usd };
  } catch (e) {
    logApiError(what, e);
    return { data: null, usd: 0 };
  }
}

// ---------------------------------------------------------------------------
// Trading decisions
// ---------------------------------------------------------------------------

const DECISION_SYSTEM = `You are the decision engine of a small, fully automated Solana meme-coin trading bot that runs 24/7 for one private person. The account is tiny (around 10 EUR), so every fee matters and capital preservation comes first: a skipped opportunity costs nothing, a bad entry costs real money.

How the bot works (you cannot change this):
- Code has already removed coins that fail hard safety filters (liquidity, volume, age, RugCheck dangers like mint/freeze authority, extreme pumps). The candidates you see passed these filters, but meme coins are still extremely risky.
- Code enforces stop-loss, take-profit, trailing stop, max hold time, daily loss limit and position limits on every trade. You don't need to set them.
- You choose WHICH candidates to buy (if any), how strongly (size_pct 25-100 of the max position size), and whether any open position should be sold early.

What the data means:
- price_change_pct / volume_usd / txns: momentum and participation. Rising price WITH rising volume and more buyers than sellers is constructive. Price up on falling volume, or a vertical 1h candle, often precedes a dump.
- boost: tokens that paid DexScreener for promotion. It is a marketing signal: it brings attention and short-term flows, but heavy boosting on a weak chart is also a classic pump-and-dump setup.
- trending_rank: position on GeckoTerminal trending (1 = hottest). new_profile: the team just paid for a DexScreener profile.
- rule_score: a 0-1 heuristic of momentum, buy pressure, volume acceleration, liquidity, hype and safety. Use it as one input, not the answer.
- chart_24h: technical analysis of the last 24h of 15-minute candles: trend (EMA 9/21/96), RSI(14), position in the 24h range, distance below the 24h high, volume vs. average, volatility, green candles, upper wicks (selling into pumps), price vs. VWAP. Buying right after a vertical move with RSI > 80 and long upper wicks is usually late; a fresh uptrend with rising volume and room to the 24h high is better.
- own_model_win_probability: output of the bot's own machine-learning model trained on thousands of past Solana charts (see own_model for what it means and how well it tested). Compare it with own_model.base_win_rate; trust it more when own_model.beats_simple_baselines is true.
- safety: RugCheck result. "warn" items (e.g. mutable metadata) are common; weigh them.
- market_context: the Crypto Fear & Greed Index (0 = extreme fear, 100 = extreme greed) and coins/categories trending on CoinGecko right now. Meme coins do best in greed phases; in fear, be much more selective.
- briefing: a recent research summary of the crypto/meme market and narratives (may be missing). Coins that fit the narratives currently getting attention have better odds.
- recent_trades: the bot's own latest results. Learn from them: avoid repeating losing patterns and re-buying coins that just stopped out.

Rules for your answer:
- Buy at most as many coins as there are free slots. Buying nothing is often correct, especially in a weak market (SOL falling, most memes red).
- Only use action "buy" when you have real conviction; confidence is your honest probability-like estimate (0-1) that the trade reaches its take-profit before its stop-loss.
- Every candidate you were given must appear in "buys" (as buy or skip); every open position must appear in "exits" (hold or sell). Copy each "mint" exactly.
- Keep each reason to one or two short sentences that a non-expert can understand.`;

const DecisionSchema = z.object({
  market_view: z.string().describe("One or two sentences on current market conditions for meme coins."),
  buys: z.array(
    z.object({
      mint: z.string(),
      action: z.enum(["buy", "skip"]),
      confidence: z.number().describe("0 to 1"),
      size_pct: z.number().describe("25 to 100: share of the maximum position size"),
      reason: z.string(),
    }),
  ),
  exits: z.array(
    z.object({
      mint: z.string(),
      action: z.enum(["hold", "sell"]),
      sell_pct: z.number().describe("0 to 100"),
      reason: z.string(),
    }),
  ),
});

export interface DecisionInput {
  candidates: Candidate[];
  positions: { mint: string; symbol: string; pnlPct: number; heldHours: number; valueEur: number; boughtBecause: string }[];
  freeSlots: number;
  cashEur: number;
  equityEur: number;
  dailyPnlPct: number;
  solChange24hPct?: number;
  recentTrades: { symbol: string; side: string; trigger: string; pnlPct?: number; hoursAgo: number }[];
}

function compactCandidate(c: Candidate) {
  const r = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
  return {
    mint: c.mint,
    symbol: c.symbol,
    name: c.name,
    price_usd: c.priceUsd,
    market_cap_usd: Math.round(c.marketCapUsd),
    liquidity_usd: Math.round(c.liquidityUsd),
    age_hours: r(c.ageHours, 0),
    price_change_pct: { m5: r(c.priceChange.m5), h1: r(c.priceChange.h1), h6: r(c.priceChange.h6), h24: r(c.priceChange.h24) },
    volume_usd: { h1: Math.round(c.volume.h1), h6: Math.round(c.volume.h6), h24: Math.round(c.volume.h24) },
    txns: { h1: c.txns.h1, h24: c.txns.h24 },
    boost: c.boostAmount,
    trending_rank: c.trendingRank ?? null,
    sources: c.sources,
    socials: c.socials,
    safety: c.safety ? { level: c.safety.level, rug_score: c.safety.rugScore ?? null, risks: c.safety.risks.map((x) => `${x.level}: ${x.name}`) } : null,
    rule_score: c.score ?? null,
    chart_24h: c.chart ?? null,
    own_model_win_probability: c.mlProb !== undefined ? Math.round(c.mlProb * 1000) / 1000 : null,
  };
}

/** Tells the language model how far it can trust the own model's probabilities. */
function ownModelInfo() {
  const m = getModel();
  if (!m) return null;
  return {
    meaning: `probability that price reaches +${m.params.tpPct}% before -${m.params.slPct}% within ${m.params.horizonBars / 4}h`,
    buy_threshold: Math.round(m.threshold * 1000) / 1000,
    base_win_rate: m.data.baseWinRate,
    tested_on_unseen_days: m.metrics.testDays,
    test_win_rate_of_its_picks: m.metrics.model.winRate,
    beats_simple_baselines: m.metrics.useful,
  };
}

export interface DecisionResult {
  marketView: string;
  buys: AiDecision[];
  exits: AiExit[];
  costUsd: number;
}

export async function aiDecide(input: DecisionInput, s: Settings): Promise<DecisionResult | null> {
  const m = resolveModel(s);
  if (!m) return null;
  // Small local models get fewer candidates so the prompt stays short and fast on a CPU.
  const maxCandidates = m.provider === "ollama" && !config.ollama.apiKey ? 5 : 8;
  const payload = {
    portfolio: {
      equity_eur: Math.round(input.equityEur * 100) / 100,
      cash_eur: Math.round(input.cashEur * 100) / 100,
      free_slots: input.freeSlots,
      daily_pnl_pct: Math.round(input.dailyPnlPct * 10) / 10,
      open_positions: input.positions,
    },
    market: { sol_change_24h_pct: input.solChange24hPct ?? null },
    market_context: await getMarketContext().catch(() => null),
    own_model: ownModelInfo(),
    briefing: state.briefing ? { written_hours_ago: Math.round((Date.now() - state.briefing.ts) / 3_600_000), text: state.briefing.text } : null,
    recent_trades: input.recentTrades,
    candidates: input.candidates.slice(0, maxCandidates).map(compactCandidate),
  };
  const userText = `Current time: ${new Date().toISOString()}\n${langLine(s.language)}\n\n${JSON.stringify(payload)}`;

  const { data: out, usd } = await ask(m, "decision", DECISION_SYSTEM, userText, DecisionSchema);
  if (!out) return null;
  const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(x) ? x : lo));
  return {
    marketView: out.market_view,
    buys: out.buys.map((b) => ({
      mint: b.mint,
      action: b.action,
      confidence: clamp(b.confidence, 0, 1),
      sizePct: clamp(b.size_pct, 25, 100),
      reason: b.reason,
    })),
    exits: out.exits.map((e) => ({ mint: e.mint, action: e.action, sellPct: clamp(e.sell_pct, 0, 100), reason: e.reason })),
    costUsd: usd,
  };
}

// ---------------------------------------------------------------------------
// Market briefing (Claude only: uses Claude's web search to read news & narratives)
// ---------------------------------------------------------------------------

const BRIEFING_PROMPT = `Research the current state of the crypto market with a focus on Solana meme coins, using web search. Today is {DATE}.

Find out:
1. Overall market mood right now (BTC/SOL trend, risk-on or risk-off, major macro or crypto news from the last 24-48 hours).
2. Which meme-coin narratives and themes are getting attention on Solana right now (e.g. AI agents, celebrity/political coins, animal coins, specific launchpads), and which are fading.
3. Specific Solana meme coins with notable news, listings, hacks, rug pulls or scandals in the last 48 hours.
4. Any risks a small automated trader should watch out for today.

Write a compact briefing (max ~250 words) for a trading bot: bullet points, concrete coin names/tickers where relevant, no filler. {LANG}`;

/** True when the selected brain can write a web-research briefing. */
export function briefingSupported(s: Settings): boolean {
  return !!resolveModel(s)?.webSearch && !!client;
}

export async function aiBriefing(s: Settings): Promise<string | null> {
  const m = resolveModel(s);
  if (!client || !m || m.provider !== "claude") return null;
  const tools: Anthropic.Beta.BetaToolUnion[] = s.webResearch ? [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }] : [];
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: BRIEFING_PROMPT.replace("{DATE}", new Date().toISOString().slice(0, 10)).replace("{LANG}", langLine(s.language)),
    },
  ];
  try {
    for (let i = 0; i < 4; i++) {
      const res = await client.beta.messages.create({
        model: m.id,
        max_tokens: 16000,
        ...fallbackParams(m),
        output_config: { effort: s.aiEffort },
        tools,
        messages,
      });
      recordClaudeUsage(m, res.usage);
      if (res.stop_reason === "pause_turn") {
        // Server-side search loop paused; send the partial turn back to let it continue.
        messages.push({ role: "assistant", content: res.content });
        continue;
      }
      if (res.stop_reason === "refusal") {
        log.warn("AI declined the briefing request");
        return null;
      }
      const text = res.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      return text || null;
    }
    return null;
  } catch (e) {
    logApiError("briefing", e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// "Ask AI" about one coin (from the app)
// ---------------------------------------------------------------------------

const OpinionSchema = z.object({
  verdict: z.enum(["bullish", "neutral", "bearish", "avoid"]),
  risk: z.enum(["low", "medium", "high", "extreme"]),
  summary: z.string(),
  points: z.array(z.string()).describe("3 to 5 short bullet points"),
});

export type Opinion = z.infer<typeof OpinionSchema>;

export async function aiOpinion(c: Candidate, s: Settings): Promise<Opinion | null> {
  const m = resolveModel(s);
  if (!m) return null;
  if (m.provider === "ml") return mlOpinion(c, s.language);
  const userText = `The owner asks for your honest view on ONE coin (not a trade instruction). Explain the opportunity and the risks plainly for a beginner. ${langLine(s.language)}\n\n${JSON.stringify({
    coin: compactCandidate(c),
    market_context: await getMarketContext().catch(() => null),
    briefing: state.briefing?.text ?? null,
  })}`;
  const { data } = await ask(m, "opinion", DECISION_SYSTEM, userText, OpinionSchema);
  return data;
}

function logApiError(what: string, e: unknown) {
  if (e instanceof Anthropic.AuthenticationError) log.error(`AI ${what}: invalid ANTHROPIC_API_KEY`);
  else if (e instanceof Anthropic.RateLimitError) log.warn(`AI ${what}: rate limited, will retry next cycle`);
  else if (e instanceof Anthropic.BadRequestError) log.error(`AI ${what}: bad request: ${e.message}`);
  else if (e instanceof Anthropic.APIError) log.error(`AI ${what}: API error ${e.status}: ${e.message}`);
  else log.error(`AI ${what} failed: ${errMsg(e)}`);
}
