# Crypto Pilot on Hugging Face Spaces (free, no credit card).
# Create a Space with SDK "Docker", then add this file as "Dockerfile".
# Secrets to add in the Space (Settings → Variables and secrets):
#   API_TOKEN          your own password (16+ letters/numbers) — REQUIRED
#   BOT_WALLET_SECRET  the bot wallet key — the app shows it to you (Settings → Bot wallet backup)
#   ANTHROPIC_API_KEY / OPENROUTER_API_KEY + OPENROUTER_MODELS / RPC_URL …  optional
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates python3 python3-venv libgomp1 \
 && rm -rf /var/lib/apt/lists/*

# Hugging Face runs containers as user 1000 (the "node" user in this image).
USER node
WORKDIR /home/node
ARG REPO=https://github.com/aebellinaldo-maker/Claude.git
ARG BRANCH=claude/crypto-trading-app-bot-lat9g9
RUN git clone --depth 1 -b "$BRANCH" "$REPO" crypto-pilot

WORKDIR /home/node/crypto-pilot/bot
RUN npm ci && npm run build
RUN cd ../app && npm ci && CI=1 npx expo export --platform web --output-dir dist
RUN python3 -m venv ml/.venv && ml/.venv/bin/pip install --no-cache-dir -r ml/requirements.txt

ENV PORT=7860 HOST=0.0.0.0 DATA_DIR=/home/node/data EPHEMERAL_STORAGE=1
EXPOSE 7860
CMD ["node", "dist/index.js"]
