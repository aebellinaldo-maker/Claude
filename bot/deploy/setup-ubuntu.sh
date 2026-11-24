#!/usr/bin/env bash
# One-time setup of the trading bot on a fresh Ubuntu server
# (e.g. Oracle Cloud "Always Free"). Run it from the repository:
#
#   cd Claude/bot && bash deploy/setup-ubuntu.sh
#
# What it does: installs Node.js and Caddy, builds the bot, runs it as a
# service that starts on boot and restarts after crashes, and puts HTTPS in
# front of it on a free sslip.io address (or DOMAIN=your.domain if you set it).
set -euo pipefail

BOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT=8787

echo "==> Installing Node.js, Caddy (HTTPS) and build tools"
sudo apt-get update -y
sudo apt-get install -y curl git build-essential caddy
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "==> Building the bot"
cd "$BOT_DIR"
npm ci
npm run build

if [ ! -f .env ]; then
  cp .env.example .env
  # Caddy is the only thing that should talk to the bot directly.
  sed -i "s/^HOST=.*/HOST=127.0.0.1/" .env
  chmod 600 .env
fi

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
TOKEN="$(cat "$BOT_DIR/data/api-token.txt" 2>/dev/null || grep '^API_TOKEN=' .env | cut -d= -f2-)"
WALLET="$(sudo journalctl -u crypto-bot -n 100 --no-pager | grep -oE 'Bot wallet: +[1-9A-HJ-NP-Za-km-z]+' | tail -1 | awk '{print $3}')"

cat <<EOF

──────────────────────────────────────────────────────────────
 Done! Enter these in the app (Settings → Bot server):

   Server URL:  https://$DOMAIN
   API token:   $TOKEN

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
