/**
 * The AI's trading knowledge: a playbook distilled from well-regarded technical-analysis
 * teaching (CMT Association curriculum, Steve Nison's candlestick work, Thomas Bulkowski's
 * pattern statistics, the Wyckoff method, Al Brooks-style price action) plus research on
 * crypto markets. Every AI brain gets it; the chart-photo analysis relies on it most.
 *
 * Sources for the numbers:
 * - Bulkowski, thepatternsite.com: Three White Soldiers ~82% bullish reversal (rank 3/103),
 *   Piercing ~64% (rank 21/103), Shooting Star rank 55/103.
 * - Solidus Labs (2025, via CoinDesk): ~98.6% of pump.fun tokens showed rug-pull or
 *   pump-and-dump characteristics; ~93% of Raydium pools showed soft-rug traits.
 * - Liu & Tsyvinski, "Risks and Returns of Cryptocurrency" (RFS 2021): time-series momentum
 *   and investor attention predict crypto returns; later studies find momentum crashes.
 */
export const TRADING_PLAYBOOK = `TRADING PLAYBOOK — distilled from the CMT curriculum, Nison (candlesticks), Bulkowski (pattern statistics), Wyckoff (accumulation/distribution), price-action trading and crypto research.

1) GROUND TRUTH ABOUT MEME COINS
- Most meme coins go to zero. A 2025 Solidus Labs study classified ~98.6% of pump.fun tokens as rug pulls or pump-and-dumps, and ~93% of Raydium pools showed soft-rug traits. Default stance: skeptical.
- The edge that research supports in crypto is short-term momentum driven by attention (Liu & Tsyvinski, Review of Financial Studies 2021) — but momentum crashes are violent, so every entry needs a predefined exit.

2) READ A CHART IN THIS ORDER
a. Timeframe and context: identify the candle interval. A pattern on 1-minute candles matters far less than on 1-hour candles. The higher-timeframe trend dominates.
b. Trend structure (Dow theory): higher highs + higher lows = uptrend; lower highs + lower lows = downtrend; otherwise range. Check price vs. the 20/50 EMA and their slope. Trade with the trend; counter-trend trades need much stronger evidence.
c. Support and resistance: prior swing highs/lows, consolidation edges, round numbers, the launch/breakout level. Broken resistance often becomes support (role reversal) and vice versa. The more touches, the more important the level.
d. Volume ("effort vs. result", Wyckoff/CMT): real breakouts come with rising volume. Price rising on falling volume is weak. A climactic volume spike with a long upper wick signals exhaustion. Selling volume drying up on a pullback is healthy.
e. Momentum: RSI above 70 is overbought (strong trends can stay overbought), below 30 oversold. Bearish divergence (price makes a higher high, RSI a lower high) warns of a top; bullish divergence the opposite.
f. Candles (Nison; Bulkowski's statistics): a candle only means something at a key level and should be confirmed by the next candle. Long upper wicks = selling/rejection; long lower wicks = buying/rejection. Engulfing candles at support/resistance, hammers and shooting stars, and dojis (indecision) are the useful ones. Even strong patterns are probabilities, not certainties: Bulkowski measured Three White Soldiers as a bullish reversal ~82% of the time and Piercing ~64%, and many patterns are close to a coin flip. Never trade one candle alone.
g. Chart patterns: bull flag/pennant (strong impulse, then tight pullback on falling volume, breakout on volume) is the classic continuation. Ascending triangles, double bottoms, inverse head-and-shoulders are bullish; double tops, head-and-shoulders, rising wedges, lower-high staircases are bearish. Measured-move target = height of the pattern projected from the breakout.
h. Wyckoff cycle: accumulation (sideways range after a decline; a "spring" dips below support and is quickly reclaimed) → markup → distribution (range at the top; an "upthrust" pokes above resistance and fails) → markdown.

3) MEME-COIN RED FLAGS ON A CHART
- One or more vertical candles (+50–200%) on a single giant volume bar, followed by long upper wicks: the pump is likely over; buying here is buying someone else's exit.
- A staircase of lower highs after the launch spike, with each bounce on less volume: distribution / slow rug.
- A single huge red candle that erases days of gains, or liquidity suddenly gone: rug pull — don't "buy the dip".
- Gappy chart, flat candles, long stretches without trades: too illiquid to exit.
- Price far above the EMA/VWAP after a parabolic run: high mean-reversion risk.

4) HIGHER-PROBABILITY SETUPS (still uncertain)
- Pullback in an established uptrend: a higher low forms at former resistance-turned-support or near the 20 EMA, selling volume dries up, then a bullish engulfing/hammer with volume returning.
- Breakout from a multi-hour consolidation or flag on volume clearly above average, RSI around 55–70 (not above 80), with room to the next resistance.
- Reclaim/spring: price briefly loses support, then quickly reclaims it with strong volume.

5) RISK MANAGEMENT (what every serious course stresses most)
- Decide where the idea is wrong before entering: the stop goes just beyond the swing low/support that invalidates the setup.
- Only take trades with reward:risk of at least 2:1 to the first target; if the nearest resistance is too close, skip.
- Keep position size small; never average down into a falling meme coin.
- Take partial profits into strength and trail a stop on the rest.
- Not trading is a valid position: when the picture is unclear, the answer is hold or avoid.

6) HONESTY
- Technical analysis gives probabilities, not certainty. Keep confidence modest (rarely above 0.75) and say when the evidence is mixed or the chart is unreadable.`;
