# Crypto Pilot

A personal iPhone app + 24/7 trading bot for Solana and meme coins.

- **Wallet** – connect your Phantom wallet, see your coins and their value in €.
- **Buy** – buy SOL/USDC with **card, PayPal, Apple Pay or bank transfer** through a licensed payment partner (MoonPay / Transak). The coins go straight to *your* Phantom wallet.
- **Market** – trending Solana coins, a safety check for every coin (RugCheck), a 24 h candlestick chart with technical analysis, an "Ask the AI" button, and swaps (SOL ⇄ meme coin) that you approve in Phantom.
- **Chart AI** – send a screenshot or photo of any chart: the AI reads the candles, volume and indicators and answers **buy / sell / hold / avoid** with the patterns it sees, support/resistance, an entry–stop–target plan and the risks.
- **Bot** – a trading bot that runs 24/7 on a free server with its own small wallet (e.g. €10). It finds trending coins, filters out scams, lets **Claude (AI)** pick trades using live market data and a daily web-research briefing, and protects the money with hard rules (stop-loss, take-profit, daily loss limit, kill switch). **Paper mode** tests it with fake money at real prices first.
- English + German.

![Market and Bot screens (browser preview at iPhone size, German)](docs/app-preview.png)

```
 iPhone app (Expo)                 Bot server (Node.js, free cloud VM, 24/7)
 ┌─────────────────┐  HTTPS+token  ┌──────────────────────────────────────────┐
 │ Wallet / Buy    │──────────────▶│ API ─ Bot engine ─ Safety rules           │
 │ Market / Bot    │               │        │      │                           │
 │ Settings        │               │   Claude AI  Jupiter swaps ─ bot wallet   │
 └───────┬─────────┘               │        │                                  │
         │ deep links              │  DexScreener · GeckoTerminal · RugCheck   │
   Phantom app (signs YOUR trades) └──────────────────────────────────────────┘
```

---

## ⚠️ Read this first

- **No bot can guarantee profit.** Most meme-coin traders lose money. The AI is good at reading data, trends and news, but it cannot predict a coin's price. Treat the €10 as money you're OK to lose, and test in paper mode first.
- **Fees matter a lot with €10.** Card/PayPal providers charge roughly €2–4 per purchase and often have a €20–30 minimum. Each swap costs about €0.01 in network fees plus 0.1–1% slippage.
- **AI costs money too — unless you use a free brain.** Each AI decision costs about $0.05 with Claude Opus 5.5, $0.025 with Sonnet 5.5, or $0.001 with Haiku 5.5. The bot only asks the AI when a coin looks promising (and hourly to review open coins), and stops at a daily budget (default $0.50, then it uses its rules). Free alternatives: an open model running in **Ollama on your own server**, or **OpenRouter's free models** (see [Choosing the AI brain](#choosing-the-ai-brain)). You switch in Settings.
- **The bot wallet is a "hot wallet"**: its key is stored on your server. Only keep small amounts in it. The bot can only ever withdraw to *your* Phantom address.
- This is a personal tool, not financial advice. Buying crypto through MoonPay/Transak means their identity check (KYC) and terms apply.

---

## 🤗 Free setup without a credit card (Hugging Face)

1. Sign up at <https://huggingface.co/join> (email only).
2. **New Space** (<https://huggingface.co/new-space>): name `crypto-pilot`, SDK **Docker** → *Blank*, hardware **CPU basic (free)**, **Public** → *Create Space*.
3. In the Space: **Settings → Variables and secrets → New secret**: name `API_TOKEN`, value = your own password (16+ letters/numbers). Optional secrets: `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY` + `OPENROUTER_MODELS`, `RPC_URL`.
4. **Files → + Add file → Create a new file**, name `Dockerfile`, paste [this content](https://raw.githubusercontent.com/aebellinaldo-maker/Claude/claude/crypto-trading-app-bot-lat9g9/bot/deploy/huggingface/Dockerfile) → *Commit*. Building takes ~10–15 min.
5. Open `https://YOUR-HF-NAME-crypto-pilot.hf.space/#token=YOUR_PASSWORD` in **Phantom's browser** (🌐).
6. **Settings → Bot wallet backup** → copy the key → add it as the secret `BOT_WALLET_SECRET`. Until then the bot refuses real money (Hugging Face wipes files on restart).

Limits of the free tier: the Space sleeps after ~48 h without visits (open the app every day or two), and trade history / chart archive reset when it restarts. Your bot wallet is safe once `BOT_WALLET_SECRET` is saved.

## 📱 Setup with only a phone (no computer)

Your bot server also hosts the app. You open it inside **Phantom's built-in browser** (so your wallet works) — no App Store, no computer, no Apple fee.

1. **Create a free Oracle Cloud account** in Safari: <https://www.oracle.com/cloud/free/> (they verify a card; Always Free costs nothing). Tip: if a page is hard to use, tap **aA → Request Desktop Website**.
2. **Copy the setup script:** open [oracle-cloud-init.sh](https://raw.githubusercontent.com/aebellinaldo-maker/Claude/claude/crypto-trading-app-bot-lat9g9/bot/deploy/oracle-cloud-init.sh) in Safari, select all and copy.
3. **Create the server:** Compute → Instances → *Create instance*
   - Image: **Ubuntu 24.04** · Shape: **VM.Standard.A1.Flex**, 4 OCPU / 24 GB (all free)
   - *Show advanced options* → **Management** → *Paste cloud-init script* → paste, then **change `API_TOKEN`** to your own password (16+ letters/numbers, keep it secret) → *Create*.
4. **Open the web ports:** on the instance page tap the **subnet** → **Security List** → *Add Ingress Rules*: source `0.0.0.0/0`, TCP, destination port **80**; add a second rule for port **443**.
5. **Wait ~15 minutes** while it installs itself. Note the **Public IP** on the instance page, e.g. `140.238.12.34`.
6. **Open your app:** in the **Phantom** app tap the 🌐 browser tab and open
   `https://140-238-12-34.sslip.io/#token=YOUR_PASSWORD` (your IP with dashes instead of dots). Add it to Phantom's favourites.
7. In the app: **Connect Phantom**, then **Settings → Server keys** to add your Anthropic (Claude) key or a free OpenRouter key, and **Bot → Start bot** in paper mode.

If the page doesn't load after 20 minutes, check step 4 (both ports). The install log is in `/var/log/crypto-pilot-setup.log` on the server (Oracle's *Cloud Shell* can open it).

## Setup with a computer (about 1 hour, mostly clicking)

### Step 1 — Free 24/7 server (Oracle Cloud "Always Free")

1. Create an account at <https://www.oracle.com/cloud/free/>. They ask for a card for verification. Always Free resources cost nothing.
2. **Create a VM instance**: image **Ubuntu 24.04**, shape **VM.Standard.A1.Flex**. Choose **4 OCPU / 24 GB** (the whole free allowance) if you want to run a free AI with Ollama on it; otherwise 1 OCPU / 6 GB is plenty. Download the SSH key they offer.
3. In the instance's **VCN → Security List**, add ingress rules for **TCP 80** and **TCP 443** from `0.0.0.0/0`.
4. Connect: `ssh -i your-key.key ubuntu@YOUR_SERVER_IP`, then:
   ```bash
   git clone https://github.com/aebellinaldo-maker/Claude.git
   cd Claude/bot
   bash deploy/setup-ubuntu.sh
   ```
   At the end it prints your **Server URL** (`https://1-2-3-4.sslip.io`) and **API token**. Keep both.
5. Add your keys (Step 2) to `Claude/bot/.env`, then `sudo systemctl restart crypto-bot`.
6. **Back up** `Claude/bot/data/bot-wallet.json` (the bot's wallet key) somewhere safe.

> Alternative: Google Cloud's free e2-micro VM works the same way. Or just run `npm install && npm run dev` in `bot/` on your own PC (then the bot only trades while the PC is on).

### Step 2 — Keys

| Key | Needed? | Where |
|---|---|---|
| `ANTHROPIC_API_KEY` | For Claude AI decisions + web research | <https://console.anthropic.com> → API Keys (needs a few $ of prepaid credit) |
| `OLLAMA_MODELS` / `OPENROUTER_API_KEY` / `XAI_API_KEY` | Optional — free or alternative AI brains | see [Choosing the AI brain](#choosing-the-ai-brain) |
| `RPC_URL` | Recommended (faster, more reliable trades) | <https://www.helius.dev> free plan → mainnet RPC URL |
| `MOONPAY_PUBLISHABLE_KEY` + `MOONPAY_SECRET_KEY` | Optional — pre-fills your wallet address in the buy page | <https://dashboard.moonpay.com> |
| `TRANSAK_API_KEY` | Optional — second payment provider | <https://dashboard.transak.com> |

Without MoonPay/Transak keys, **Buy** still works: the app copies your wallet address and opens MoonPay's website (card, PayPal, Apple Pay). The Phantom app also has its own *Buy* button.

### Step 3 — App on your iPhone

You need a computer (Mac/Windows/Linux) with [Node.js](https://nodejs.org) once.

1. Install **Expo Go** and **Phantom** from the App Store.
2. On your computer:
   ```bash
   cd Claude/app
   npm install
   npx expo start --tunnel
   ```
3. Scan the QR code with the iPhone camera → it opens in Expo Go.

Expo Go loads the app from your computer, so keep `npx expo start` running while you use it. (No computer? Use the [phone-only setup](#-setup-with-only-a-phone-no-computer) — the bot server hosts the app.) For a real standalone app that works without your computer, you need an Apple Developer account ($99/year): run `npx eas-cli build --platform ios --profile production` and then `npx eas-cli submit --platform ios`, and install it from **TestFlight**. Change `ios.bundleIdentifier` in `app/app.json` to your own first, e.g. `com.yourname.cryptopilot`.

### Step 4 — First run

1. **Settings** → enter the Server URL + API token → *Save & test*. Choose English/Deutsch.
2. **Wallet** → *Connect Phantom* → approve in Phantom. This wallet becomes the bot's only withdrawal address.
3. **Bot** → *Start bot* in **paper mode**. Let it run for a few days and watch *Activity* and *Trade history*.
4. Happy with the results? **Bot → Pause → Switch to real money**, then **Wallet → Fund bot** to send e.g. 0.15 SOL (≈ €10) from Phantom → *Start bot*.
5. Want out? **Sell all & stop**, then **Fund bot → Withdraw everything to Phantom**.

---

## How the bot decides

Every 10 minutes (scan) and every 30 seconds (protection):

1. **Discover** — DexScreener *boosted* tokens (projects paying for promotion: a marketing/hype signal), new DexScreener profiles, GeckoTerminal trending pools, and a watchlist of big Solana memes (BONK, WIF, POPCAT, FARTCOIN, PENGU, TRUMP, BOME, JUP).
2. **Hard filters** (can't be overridden by the AI) — liquidity ≥ $50k, 24h volume ≥ $100k, coin age ≥ 24h, market cap ≥ $250k, not already +300% in 24h, not dumping, not 3× more sellers than buyers.
3. **Rug-pull check** — RugCheck.xyz: rejects mint/freeze authority, "danger" risks, high risk scores.
4. **Scoring** — momentum, buy pressure, volume acceleration, liquidity, hype (boosts, trending rank, socials).
5. **Chart analysis** — the 24 h candlestick chart of each shortlisted coin is analysed (trend, RSI, volume, range…) and the bot's own trained model estimates its chance of hitting the take-profit first (see [the own AI model](#the-own-ai-model-pilot-ml)).
6. **AI decision** — Claude gets the top coins, your open positions, recent wins/losses (to learn from them) and a research briefing (it searches the web for market mood, hot narratives, scams). It answers with buy/skip/sell, confidence and a plain-language reason (in your language). Only coins that passed the filters can be bought.
7. **Execution** — swaps through Jupiter (best price across Solana DEXes), with price-impact limits. Paper mode uses the exact same Jupiter quotes.
8. **Protection (every 30 s)** — stop-loss, take-profit (sells half), trailing stop, max hold time, instant exit if liquidity collapses (rug pull), daily loss limit, kill switch.

Defaults (all changeable in the app → Settings):

| Setting | Default |
|---|---|
| Stop-loss | −15 % |
| Take-profit | +40 % (sell 50 %, the rest runs with a 20 % trailing stop) |
| Max coins at once | 3, max 40 % of the money per coin |
| Max hold time | 24 h (if not up ≥10 %) |
| Daily loss limit | −20 % → no new buys until tomorrow |
| Kill switch | −50 % from the best value → sell everything and stop |
| AI | Claude Opus 5.5 if configured (else the first configured brain), max $0.50/day for paid models, decides at most every 20 min, min. confidence 60 % |

---

## Choosing the AI brain

Claude Opus 5.5 and Grok are closed models: they only run on Anthropic's / xAI's servers, so they can't be downloaded into Ollama (xAI published the old Grok 2.5's weights, but it's ~500 GB — far too big for a free server). What you *can* do:

| Brain | Cost | How smart | Web research | Setup (in `bot/.env`) |
|---|---|---|---|---|
| **Claude Opus 5.5** | ~$0.05 / decision | best | ✅ news & narratives | `ANTHROPIC_API_KEY` |
| **Claude Haiku 5.5** | ~$0.001 / decision | good | ✅ | `ANTHROPIC_API_KEY`, pick Haiku in Settings |
| **Ollama on your server** | free, unlimited, private | basic–ok (small model, CPU) | free market data only | `OLLAMA_MODELS=<model>` |
| **OpenRouter `:free` models** | free (50/day, or 1,000/day after a one-time $10) | ok–good (big open models) | free market data only | `OPENROUTER_API_KEY`, `OPENROUTER_MODELS=<id>:free` |
| **Grok (xAI)** | paid, ~$0.20–2 per million input tokens | good | free market data only | `XAI_API_KEY`, `XAI_MODELS=<model>` |

Every brain gets the same coin data, your recent results and free market-mood data (Crypto Fear & Greed Index, CoinGecko trending coins and categories). Only Claude also searches the web for a news briefing. Whatever the brain says, the safety filters and stop-losses still apply.

**Free AI on the Oracle server with Ollama** (needs the 4 OCPU / 24 GB shape):

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull <model>        # pick a ~4–9B model from https://ollama.com/library (Qwen, Gemma, …)
echo "OLLAMA_MODELS=<model>" >> ~/Claude/bot/.env
sudo systemctl restart crypto-bot
```

Then choose it in the app → Settings → AI model. On a free 4-core CPU a ~9B model needs roughly 2–5 minutes per decision; that's fine because the bot decides at most every 20 minutes, and stop-losses keep running in parallel. There are community models on Ollama trained to imitate Claude Opus' reasoning (search "Opus distilled" on ollama.com) — they are small Qwen models, not the real Opus, so expect clearly weaker judgement.

## Chart AI (send a chart picture)

Open the **Chart AI** tab, pick a screenshot (or take a photo of a screen), optionally add the coin/timeframe, and tap *Analyse chart*. The AI works through the playbook below — timeframe → trend → support/resistance → volume → momentum → candles → patterns → Wyckoff phase → meme-coin red flags → risk management — and returns a verdict with confidence, the patterns it found, key levels, a trade plan (entry, stop-loss, target) and the risks.

It needs an AI that can see images: any Claude model works; with Ollama/OpenRouter/Grok, choose a vision model (e.g. a Gemma 3, Qwen-VL or LLaVA model in Ollama). The app shrinks photos before sending. Cost with Claude Opus ≈ $0.03–0.08 per chart, with Haiku a fraction of a cent. It's an opinion based on probabilities — it can't see news, holders, or a team about to sell.

## The AI's trading knowledge

Every AI brain gets a **trading playbook** (`bot/src/ai/playbook.ts`) distilled from well-regarded technical-analysis teaching and research:

- **CMT Association curriculum** — trend structure, support/resistance and role reversal, volume confirmation, momentum and divergences.
- **Steve Nison's candlestick work** and **Thomas Bulkowski's pattern statistics** — which candles matter, and how reliable they really are (e.g. Three White Soldiers ≈ 82 % bullish reversal, Piercing ≈ 64 %, many patterns close to a coin flip — [thepatternsite.com](https://thepatternsite.com/ThreeWhiteSoldiers.html)).
- **Wyckoff method** — accumulation, markup, distribution, markdown; springs and upthrusts (the shape of a pump-and-dump).
- **Price-action risk management** — invalidation-based stops, reward:risk ≥ 2:1, no averaging down, partial profits.
- **Crypto research** — time-series momentum and attention effects (Liu & Tsyvinski, *Review of Financial Studies* 2021) and their crash risk; Solidus Labs' finding that ~98.6 % of pump.fun tokens showed rug-pull/pump-and-dump traits ([CoinDesk](https://www.coindesk.com/business/2025/05/07/98-of-tokens-on-pump-fun-have-been-rug-pulls-or-an-act-of-fraud-new-report-says)).

## The own AI model ("Pilot ML")

Besides the language models above, the bot trains **its own trading model** — free, private, and built only for one question: *"If I buy this coin now, will it reach the take-profit (+40 %) before the stop-loss (−15 %) within 24 hours?"*

How it works:

1. **Chart memory** — the bot saves the 15-minute price chart of every coin it looks at (from GeckoTerminal) into `data/ml/candles/`, and keeps extending it. Coins that later crash stay in the archive, so the model also learns what a rug pull looks like beforehand. The first training also collects ~20 days of charts for the most-traded Solana coins.
2. **Chart analysis** — at every moment it computes ~20 technical signals: returns over 15 min/1 h/4 h/24 h, RSI, EMA trend (9/21/96), volatility, ATR, position in the 24 h range, distance from the high/low, VWAP, volume surges, upper wicks (selling into pumps), green-candle streaks.
3. **Training** — [LightGBM](https://lightgbm.readthedocs.io) (gradient-boosted trees, a standard tool in quantitative trading) learns which combinations of signals came before a win. It retrains itself **every week** with the newly collected charts (and you can press *Retrain* in the app).
4. **Honest test** — every training is tested on the most recent days **and on coins it never saw** (with a 24 h gap so nothing leaks), against "buy everything" and a simple momentum rule, after 1 % fees. It must also pass a significance check (average return at least ~1 standard error above zero), so a lucky streak doesn't count. Passing this allows **paper trading**.
5. **Live check before real money** — charts collected from coins that are popular *today* make almost any signal look good (survivorship bias: the losers were never collected). So the bot separately tracks charts it recorded *after* it started watching a coin; the model must also win on those before it may trade **real money**. The app shows both tests on the Bot tab.
6. **Using it** — pick *Pilot ML* as the brain (Settings → AI model) and it buys what it rates above its tested threshold. Whatever brain you use, its probability and the chart analysis are also given to Claude/Ollama/OpenRouter/Grok, and the coin screen shows a candlestick chart with RSI, trend, volume and the model's estimate.

**First result (honest):** trained here on 32 coins / 26 days, the model *looked* great at first (picks winning 40 %, +5.8 % per trade) — until the checks above exposed survivorship bias through "coin age". Corrected and tested on unseen coins it was **not distinguishable from luck** (+0.4 % per trade, t = 0.08), so the bot does not trade on it yet. What *was* statistically clear: buying trending meme coins at random loses about 1.4 % per trade (t = −2.6) — which is why the filters and stop-losses matter more than any prediction. On your server it keeps collecting charts and retests itself every week.

Be realistic: a model like this finds small statistical edges at best. Meme coins are driven by hype that charts don't show, and patterns that worked last month can stop working. That's why it's tested on unseen data every week and the safety rules always apply. Train it from the command line with `npm run ml:train` (in `bot/`).

## Project layout

```
bot/    Bot server (TypeScript, Node 20+)
  src/market/   DexScreener, GeckoTerminal, RugCheck, Jupiter, prices
  src/risk/     safety filters, scoring, exit rules & circuit breakers
  src/ai/       AI brains (Claude, Ollama, OpenRouter, Grok), web-research briefing, "ask the AI"
  src/ml/       own model: chart archive, chart analysis (features), training, predictions
  ml/train.py   LightGBM training + walk-forward test
  src/engine/   bot loop, paper + real executors
  src/chain/    Solana wallet, balances, sending transactions
  src/api/      HTTP API for the app, card/PayPal on-ramp links
  deploy/       Ubuntu setup script (systemd + Caddy HTTPS)
app/    iPhone app (Expo SDK 58, expo-router, native iOS tabs)
  src/app/      screens (Wallet, Market, Bot, Settings, coin, buy, bot wallet, trades)
  src/lib/      Phantom deep links, API client, translations
```

Useful commands (in `bot/`): `npm test` (safety-rule tests), `npm run scan` (show what the bot would consider right now, no trading), `npm run dev` (run locally).

## Status / what still needs a real-world check

Tested here: all bot logic and safety rules (unit tests); the own model's tree evaluation matches LightGBM exactly; chart-photo analysis end-to-end against a mock vision model; live market data from DexScreener, Jupiter, RugCheck and CoinGecko; paper trades with real Jupiter quotes (buy → partial sell → full sell); every API endpoint; the app's TypeScript and its iOS bundle build; and every screen rendered at iPhone size.

**Not testable from my build environment. Check these yourself with small amounts:**
- the Phantom connect/sign flow on a real iPhone;
- real-money swaps from the bot wallet;
- live AI calls to Claude, Ollama, OpenRouter or Grok (only tested against mock servers here);
- MoonPay URL signing with real keys;
- the setup script on a real Oracle VM.
