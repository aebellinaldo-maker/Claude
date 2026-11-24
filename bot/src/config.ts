import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { log } from "./util/log.js";

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

const dataDir = path.resolve(env("DATA_DIR") ?? "./data");
fs.mkdirSync(dataDir, { recursive: true });

/**
 * The API token protects every endpoint the phone app uses.
 * If you don't set API_TOKEN, one is generated on first start and saved to data/api-token.txt.
 */
function loadApiToken(): string {
  const fromEnv = env("API_TOKEN");
  if (fromEnv) return fromEnv;
  const file = path.join(dataDir, "api-token.txt");
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  const token = crypto.randomBytes(24).toString("base64url");
  fs.writeFileSync(file, token + "\n", { mode: 0o600 });
  log.warn(`Generated a new API token and saved it to ${file}`);
  return token;
}

const jupiterKey = env("JUPITER_API_KEY");

export const config = {
  port: Number(env("PORT") ?? 8787),
  host: env("HOST") ?? "0.0.0.0",
  dataDir,
  apiToken: loadApiToken(),
  rpcUrl: env("RPC_URL") ?? "https://api.mainnet-beta.solana.com",
  /** Your own Phantom address. Withdrawals from the bot wallet can only go here. */
  ownerWallet: env("OWNER_WALLET"),
  botWalletSecret: env("BOT_WALLET_SECRET"),
  anthropicApiKey: env("ANTHROPIC_API_KEY"),
  jupiter: {
    apiKey: jupiterKey,
    baseUrl: env("JUPITER_BASE_URL") ?? (jupiterKey ? "https://api.jup.ag" : "https://lite-api.jup.ag"),
  },
  moonpay: {
    publishableKey: env("MOONPAY_PUBLISHABLE_KEY"),
    secretKey: env("MOONPAY_SECRET_KEY"),
  },
  transak: {
    apiKey: env("TRANSAK_API_KEY"),
  },
};

export type Config = typeof config;
