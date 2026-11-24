#!/usr/bin/env bash
# One-time setup of the trading bot on a fresh Ubuntu server
# (e.g. Oracle Cloud "Always Free"). Run it from the repository:
#
#   cd Claude/bot && bash deploy/setup-ubuntu.sh
#
# What it does: installs Node.js, Python and Caddy, builds the bot and the web
# version of the app, runs the bot as a service that starts on boot and restarts
# after crashes, and puts HTTPS in front of it on a free sslip.io address (or
# DOMAIN=your.domain if you set it).
#
# Optional environment variables (used by deploy/oracle-cloud-init.sh):
#   API_TOKEN=...          your own password for the app (otherwise one is generated)
#   ANTHROPIC_API_KEY=...  and other keys from .env.example — written into .env
set -euo pipefail

BOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT=8787

echo "==> Installing Node.js, Python, Caddy (HTTPS) and build tools"
sudo apt-get update -y
sudo apt-get install -y curl git build-essential cmake caddy python3 python3-venv python3-pip
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "==> Building the bot"
cd "$BOT_DIR"
npm ci
npm run build

echo "==> Building the app's web version (served by the bot, opens in any phone browser)"
(cd "$BOT_DIR/../app" && npm ci && CI=1 npx expo export --platform web --output-dir dist)

echo "==> Installing the machine-learning tools for the own model (LightGBM)"
python3 -m venv ml/.venv
ml/.venv/bin/pip install --quiet --upgrade pip
ml/.venv/bin/pip install --quiet -r ml/requirements.txt

if [ ! -f .env ]; then
  cp .env.example .env
  # Caddy is the only thing that should talk to the bot directly.
  sed -i "s/^HOST=.*/HOST=127.0.0.1/" .env
  chmod 600 .env
fi
# Values passed in the environment (e.g. from the cloud-init script) go into .env.
for name in API_TOKEN ANTHROPIC_API_KEY OPENROUTER_API_KEY OPENROUTER_MODELS XAI_API_KEY XAI_MODELS OLLAMA_MODELS RPC_URL OWNER_WALLET MOONPAY_PUBLISHABLE_KEY MOONPAY_SECRET_KEY; do
  value="${!name:-}"
  if [ -n "$value" ]; then
    grep -v "^$name=" .env > .env.tmp || true
    printf '%s="%s"\n' "$name" "$value" >> .env.tmp
    mv .env.tmp .env && chmod 600 .env
  fi
done

PUBLIC_IP="$(curl -fsS https://api.ipify.org || true)"
DOMAIN="${DOMAIN:-${PUBLIC_IP//./-}.sslip.io}"

echo "==> Creating the service (starts on boot, restarts on crash)"
sudo tee /etc/systemd/system/crypto-bot.service >/dev/null <<EOF
[Unit]
Description=Crypto trading bot
After=network-online.target
Wants=network-online.target

[Service]
User=$USER
WorkingDirectory=$BOT_DIR
ExecStart=$(command -v node) $BOT_DIR/dist/index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now crypto-bot

echo "==> HTTPS for https://$DOMAIN"
sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
$DOMAIN {
  reverse_proxy 127.0.0.1:$PORT
}
EOF
sudo systemctl restart caddy

echo "==> Opening ports 80 and 443 in the server's own firewall"
if command -v iptables >/dev/null; then
  for p in 80 443; do
    sudo iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 1 -p tcp --dport "$p" -j ACCEPT
  done
  if command -v netfilter-persistent >/dev/null; then sudo netfilter-persistent save; fi
fi

sleep 4
TOKEN="$(grep '^API_TOKEN=' .env | cut -d= -f2- | tr -d '"')"
[ -z "$TOKEN" ] && TOKEN="$(cat "$BOT_DIR/data/api-token.txt" 2>/dev/null)"
WALLET="$(sudo journalctl -u crypto-bot -n 100 --no-pager | grep -oE 'Bot wallet: +[1-9A-HJ-NP-Za-km-z]+' | tail -1 | awk '{print $3}')"

cat <<EOF

──────────────────────────────────────────────────────────────
 Done! Open this private link inside the Phantom app's browser (🌐):

   https://$DOMAIN/#token=$TOKEN

 (Or in the native app: Settings → Server URL https://$DOMAIN, API token $TOKEN)

 Bot wallet:    $WALLET
 Back it up:    $BOT_DIR/data/bot-wallet.json  (copy it somewhere safe)

 Next steps:
   1. Put your ANTHROPIC_API_KEY (and a Helius RPC_URL) into $BOT_DIR/.env
   2. sudo systemctl restart crypto-bot
   3. Watch the logs:  journalctl -u crypto-bot -f

 Oracle Cloud: also allow TCP ports 80 and 443 in your VCN's
 Security List (web console), or HTTPS can't start.
──────────────────────────────────────────────────────────────
EOF
