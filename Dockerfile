# Crypto Pilot — one container with the bot and the web app.
# Used by Render (free web service): New → Web Service → this repo → Docker.
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates python3 python3-venv libgomp1 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY bot/package.json bot/package-lock.json bot/
COPY app/package.json app/package-lock.json app/
RUN cd bot && npm ci && cd ../app && npm ci
COPY . .
RUN cd bot && npm run build \
 && cd ../app && CI=1 npx expo export --platform web --output-dir dist \
 && cd ../bot && python3 -m venv ml/.venv && ml/.venv/bin/pip install --no-cache-dir -r ml/requirements.txt
WORKDIR /srv/bot
# Render provides PORT; files are wiped on restart, so the wallet must come from BOT_WALLET_SECRET.
ENV HOST=0.0.0.0 DATA_DIR=/srv/data EPHEMERAL_STORAGE=1 NODE_ENV=production
CMD ["node", "dist/index.js"]
