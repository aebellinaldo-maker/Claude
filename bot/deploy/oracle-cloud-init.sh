#!/bin/bash
# ───────────────────────────────────────────────────────────────────────────────
#  Crypto Pilot — automatic server setup (works from a phone).
#
#  Paste this whole text into Oracle Cloud when creating your server:
#  Create instance → "Show advanced options" → Management →
#  "Paste cloud-init script". The server installs everything by itself on its
#  first start (about 10–15 minutes).
#
#  1) REQUIRED: replace the password below with your own long, random password:
#     at least 16 characters, only letters, numbers, - and _ (it becomes part of
#     your private app link). It protects your bot — keep it secret.
API_TOKEN="CHANGE-ME-to-a-long-random-password"
#
#  2) Optional: your Anthropic key for the Claude AI. You can also add keys later
#     in the app (Settings → Server keys).
ANTHROPIC_API_KEY=""
# ───────────────────────────────────────────────────────────────────────────────

LOG=/var/log/crypto-pilot-setup.log
if [ "$API_TOKEN" = "CHANGE-ME-to-a-long-random-password" ] || [ ${#API_TOKEN} -lt 16 ] || [[ ! "$API_TOKEN" =~ ^[A-Za-z0-9_-]+$ ]]; then
  echo "Set your own API_TOKEN (16+ characters: letters, numbers, - and _) in the cloud-init script first." > "$LOG"
  exit 1
fi

apt-get update -y >> "$LOG" 2>&1
apt-get install -y git >> "$LOG" 2>&1
sudo -iu ubuntu git clone https://github.com/aebellinaldo-maker/Claude.git >> "$LOG" 2>&1
sudo -iu ubuntu env API_TOKEN="$API_TOKEN" ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  bash Claude/bot/deploy/setup-ubuntu.sh >> "$LOG" 2>&1
