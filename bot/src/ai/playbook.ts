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
 *
 * Section 7 (lessons from well-known traders) is drawn from: Edwin Lefèvre, "Reminiscences of a
 * Stock Operator" (1923, Jesse Livermore); William O'Neil, "How to Make Money in Stocks" (CAN SLIM);
 * Mark Minervini, "Trade Like a Stock Market Wizard" (2013); Jack Schwager, "Market Wizards" (1989:
 * Paul Tudor Jones, Ed Seykota, Richard Dennis); Curtis Faith, "Way of the Turtle" (2007);
 * Van K. Tharp, "Trade Your Way to Financial Freedom"; J. L. Kelly, "A New Interpretation of
 * Information Rate" (1956); Stanley Druckenmiller's public interviews.
 */
export const TRADING_PLAYBOOK = `TRADING PLAYBOOK — distilled from the CMT curriculum, Nison (candlesticks), Bulkowski (pattern statistics), Wyckoff (accumulation/distribution), price-action trading, crypto research, and the published methods of well-known traders (Livermore, O'Neil, Minervini, Tudor Jones, Seykota, the Turtles, Druckenmiller, Tharp).

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

6) LESSONS FROM WELL-KNOWN TRADERS (and how they apply to meme coins)
- Jesse Livermore (Reminiscences of a Stock Operator): the big money is made by sitting through the big move, not by trading in and out; trade in the direction of the "line of least resistance" (the trend); cut losses fast; add only to winners, never to losers. → Buy coins that are already proving themselves; never "average down" a falling meme.
- William O'Neil (CAN SLIM): buy leaders as they break out of a proper base on volume well above average (he wanted 40-50%+ above normal); cut every loss at 7-8%, no exceptions; the general market decides — most stocks follow it. → Breakout + volume surge; the overall meme market (SOL trend, Fear & Greed, how many memes are green) is the "M" — in a falling market most memes fall too.
- Mark Minervini (Trade Like a Stock Market Wizard): only buy in a stage-2 uptrend (price above rising moving averages, near its highs, not in a downtrend); the Volatility Contraction Pattern — successive pullbacks get smaller and quieter (e.g. -25%, -15%, -8%) while volume dries up, then buy the breakout from the tightest point; keep the average loss far smaller than the average gain. → On a 15-minute chart: tightening range + falling volume after an impulse, then a breakout candle on strong volume.
- Paul Tudor Jones (Market Wizards and later interviews): defense first; look for setups with about 5:1 reward-to-risk; use a long moving average as a trend filter ("nothing good happens below the 200-day"); when you're losing, trade smaller. → Skip coins below their long EMA (ema21_96_gap < 0) unless there is a clear reclaim; after a losing streak in track_record, be pickier.
- Ed Seykota (Market Wizards): "The elements of good trading are: cutting losses, cutting losses, and cutting losses." Richard Dennis's Turtles (Way of the Turtle): mechanical breakout trend-following, risk ~1% of equity per volatility unit; most trades lose small and a few big winners pay for everything — so never cut winners short just to "lock in" a small gain.
- Stanley Druckenmiller (interviews; learned from George Soros): what matters is how much you make when you're right versus how much you lose when you're wrong; bet big only when the evidence lines up, otherwise stay small or out and keep the capital for the fat pitch. → Use size_pct: 25-40 for ordinary setups, 70-100 only when chart, volume, narrative and safety all agree.
- Van Tharp (Trade Your Way to Financial Freedom) and the Kelly criterion (Kelly 1956): judge a strategy by expectancy — average win × win rate minus average loss × loss rate — not by win rate alone; a 35% win rate is fine if winners are 3× the losers. Position size decides whether you grow or blow up; with no proven edge the right bet is small. Professionals bet at most half of what Kelly suggests.
- Meme-coin practice used by experienced on-chain traders: (1) "take out your initial" — at about 2x sell enough to recover the stake and let the rest ride; (2) memes move in narrative waves — the first strong coins of a new theme do best, late copycats of a fading theme usually fail; (3) rising volume AND a growing number of buyers while price holds = accumulation; price rising while buyers shrink = exhaustion; (4) don't chase a vertical green candle — wait for the first higher low after the breakout; (5) if "smart money" or influencers are visibly buying, you are probably late and may be their exit liquidity; (6) a few wallets holding a large share of supply, or the developer selling, is a reason to exit, not to buy the dip.

7) HONESTY
- Technical analysis gives probabilities, not certainty. Keep confidence modest (rarely above 0.75) and say when the evidence is mixed or the chart is unreadable.
- None of these traders won most of their trades. Their edge was small losses, rare big wins, and sitting out bad markets.`;
