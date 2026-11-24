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

function list(name: string): string[] {
  return (env(name) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function num(name: string, fallback: number): number {
  const v = Number(env(name));
  return Number.isFinite(v) && env(name) !== undefined ? v : fallback;
}

const ollamaKey = env("OLLAMA_API_KEY");

export const config = {
  port: Number(env("PORT") ?? 8787),
  host: env("HOST") ?? "0.0.0.0",
  dataDir,
  apiToken: loadApiToken(),
  rpcUrl: env("RPC_URL") ?? "https://api.mainnet-beta.solana.com",
  /** Built web version of the app (served at "/" so it can be used from any phone browser). */
  webDir: path.resolve(env("WEB_DIR") ?? "../app/dist"),
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
  /**
   * Alternative AI brains (all optional). Each listed model shows up in the app's
   * model picker next to the Claude models.
   */
  ollama: {
    // Local Ollama on the same server (free), or Ollama Cloud when OLLAMA_API_KEY is set.
    url: env("OLLAMA_URL") ?? (ollamaKey ? "https://ollama.com" : "http://127.0.0.1:11434"),
    apiKey: ollamaKey,
    models: list("OLLAMA_MODELS"),
    // Only sent when set: true = thinking models reason first (smarter, much slower on a CPU).
    think: env("OLLAMA_THINK") === undefined ? undefined : env("OLLAMA_THINK") === "true",
    numCtx: num("OLLAMA_NUM_CTX", 16384),
    priceInUsd: num("OLLAMA_PRICE_IN_USD", 0),
    priceOutUsd: num("OLLAMA_PRICE_OUT_USD", 0),
  },
  openrouter: {
    baseUrl: env("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api/v1",
    apiKey: env("OPENROUTER_API_KEY"),
    models: list("OPENROUTER_MODELS"),
    priceInUsd: num("OPENROUTER_PRICE_IN_USD", 0),
    priceOutUsd: num("OPENROUTER_PRICE_OUT_USD", 0),
  },
  xai: {
    baseUrl: env("XAI_BASE_URL") ?? "https://api.x.ai/v1",
    apiKey: env("XAI_API_KEY"),
    models: list("XAI_MODELS"),
    // Used only to enforce the daily AI budget; set to your model's real price.
    priceInUsd: num("XAI_PRICE_IN_USD", 2),
    priceOutUsd: num("XAI_PRICE_OUT_USD", 6),
  },
};

export type Config = typeof config;
