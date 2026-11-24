/**
 * The own model as a trading brain: analyses each candidate's chart, asks the trained
 * model for its win probability, and picks the coins above the tested threshold.
 */
import type { Candidate, Lang, Settings } from "../types.js";
import { toGrid, updateArchive, STEP_SEC } from "./candles.js";
import { describeChart, featuresAt } from "./features.js";
import { getModel, predict } from "./model.js";

/**
 * Updates the coin's chart archive (so the bot keeps learning from it) and attaches
 * the chart analysis and the own model's probability to the candidate.
 */
export async function analyzeChart(c: Candidate): Promise<void> {
  const a = await updateArchive({ pool: c.pairAddress, mint: c.mint, symbol: c.symbol, createdAt: c.pairCreatedAt || undefined }, 1, false);
  if (!a || !a.candles.length) return;
  const grid = toGrid(a.candles);
  const nowSec = Date.now() / 1000;
  // Use the last *completed* 15-minute candle, like in training.
  let i = grid.length - 1;
  if (grid[i][0] + STEP_SEC > nowSec) i--;
  if (i < 0 || nowSec - grid[i][0] > 2 * 3600) return; // chart data is stale
  const x = featuresAt(grid, i);
  if (!x) return;
  c.chart = describeChart(x);
  const p = predict(x);
  if (p !== null) c.mlProb = p;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function chartText(c: Candidate, lang: Lang): string {
  const ch = c.chart;
  if (!ch) return "";
  const de = lang === "de";
  const trend = de ? ({ up: "Aufwärtstrend", down: "Abwärtstrend", sideways: "seitwärts" } as Record<string, string>)[String(ch.trend)] : `${ch.trend}trend`.replace("sidewaystrend", "sideways");
  return de
    ? `Chart: ${trend}, RSI ${ch.rsi}, 1h ${Number(ch.change_1h_pct) >= 0 ? "+" : ""}${ch.change_1h_pct}%, Volumen ${ch.volume_vs_avg_1h}× Durchschnitt`
    : `Chart: ${trend}, RSI ${ch.rsi}, 1h ${Number(ch.change_1h_pct) >= 0 ? "+" : ""}${ch.change_1h_pct}%, volume ${ch.volume_vs_avg_1h}× average`;
}

export interface MlPick {
  c: Candidate;
  sizePct: number;
  reason: string;
}

/** Coins the own model rates above its tested buy threshold, best first. */
export function mlPicks(cands: Candidate[], freeSlots: number, s: Settings): MlPick[] {
  const m = getModel();
  if (!m || freeSlots <= 0) return [];
  const de = s.language === "de";
  return cands
    .filter((c) => c.mlProb !== undefined && c.mlProb >= m.threshold)
    .sort((a, b) => (b.mlProb ?? 0) - (a.mlProb ?? 0))
    .slice(0, freeSlots)
    .map((c) => {
      const p = c.mlProb!;
      const strength = Math.max(0, Math.min(1, (p - m.threshold) / Math.max(0.01, 1 - m.threshold)));
      const odds = de
        ? `Eigenes Modell: ${pct(p)} Chance auf +${m.params.tpPct}% vor −${m.params.slPct}% (normal: ${pct(m.data.baseWinRate)})`
        : `Own model: ${pct(p)} chance of +${m.params.tpPct}% before −${m.params.slPct}% (typical: ${pct(m.data.baseWinRate)})`;
      return { c, sizePct: Math.round(50 + 50 * strength), reason: `${odds}. ${chartText(c, s.language)}` };
    });
}

/** "Ask the AI" answer when the own model is the selected brain. */
export function mlOpinion(c: Candidate, lang: Lang) {
  const m = getModel();
  const de = lang === "de";
  const p = c.mlProb;
  if (!m || p === undefined) return null;
  const verdict = p >= m.threshold ? "bullish" : p >= m.data.baseWinRate ? "neutral" : "bearish";
  const vol = Number(c.chart?.volatility_15m_pct ?? 0);
  const risk = c.safety && !c.safety.ok ? "extreme" : vol > 4 ? "extreme" : vol > 2 ? "high" : vol > 1 ? "medium" : "low";
  const summary = de
    ? `Das eigene Modell schätzt ${pct(p)} Chance, dass der Preis +${m.params.tpPct}% erreicht, bevor er −${m.params.slPct}% fällt (innerhalb von ${m.params.horizonBars / 4} Std.). Normal sind ${pct(m.data.baseWinRate)}; gekauft wird ab ${pct(m.threshold)}.`
    : `The own model estimates a ${pct(p)} chance that the price reaches +${m.params.tpPct}% before falling −${m.params.slPct}% (within ${m.params.horizonBars / 4}h). Typical is ${pct(m.data.baseWinRate)}; it buys from ${pct(m.threshold)}.`;
  const points = [chartText(c, lang)];
  if (c.chart) {
    points.push(
      de
        ? `${c.chart.below_24h_high_pct}% unter dem 24h-Hoch, Position im 24h-Bereich: ${c.chart.position_in_24h_range_pct}%`
        : `${c.chart.below_24h_high_pct}% below the 24h high, position in the 24h range: ${c.chart.position_in_24h_range_pct}%`,
    );
  }
  points.push(
    m.metrics.useful
      ? de
        ? `Getestet auf ${m.metrics.testDays} Tagen und ${m.metrics.testCoins} Coins, die es nie gesehen hat: Trefferquote ${pct(m.metrics.model.winRate ?? 0)} bei seinen Käufen${m.metrics.tradeReady ? ", auch live bestätigt" : " (live noch nicht bestätigt)"}.`
        : `Tested on ${m.metrics.testDays} days and ${m.metrics.testCoins} coins it never saw: ${pct(m.metrics.model.winRate ?? 0)} win rate on its picks${m.metrics.tradeReady ? ", also confirmed live" : " (not yet confirmed live)"}.`
      : de
        ? "Achtung: Das Modell hat im Test die einfachen Regeln noch nicht geschlagen — nimm seine Zahl nur als groben Hinweis."
        : "Caution: in testing, the model hasn't beaten simple rules yet — treat its number as a rough hint only.",
  );
  return { verdict, risk, summary, points } as const;
}
