/**
 * Reads and updates the bot's .env file, so API keys can be entered from the app
 * (useful when you only have a phone). Secrets are never sent back to the app.
 */
import fs from "node:fs";
import path from "node:path";

export const ENV_FILE = path.resolve(".env");

/** Keys the app may set. `secret` values are write-only. */
export const EDITABLE_KEYS: Record<string, { secret: boolean }> = {
  ANTHROPIC_API_KEY: { secret: true },
  OLLAMA_MODELS: { secret: false },
  OLLAMA_URL: { secret: false },
  OLLAMA_API_KEY: { secret: true },
  OPENROUTER_API_KEY: { secret: true },
  OPENROUTER_MODELS: { secret: false },
  XAI_API_KEY: { secret: true },
  XAI_MODELS: { secret: false },
  RPC_URL: { secret: true }, // usually contains an API key
  MOONPAY_PUBLISHABLE_KEY: { secret: false },
  MOONPAY_SECRET_KEY: { secret: true },
  TRANSAK_API_KEY: { secret: true },
  JUPITER_API_KEY: { secret: true },
};

function parse(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    out.set(m[1], v);
  }
  return out;
}

export function readEnvFile(): Map<string, string> {
  try {
    return parse(fs.readFileSync(ENV_FILE, "utf8"));
  } catch {
    return new Map();
  }
}

/** What the app may see: for each editable key, whether it's set (and the value if not secret). */
export function describeKeys(): Record<string, { set: boolean; value?: string }> {
  const file = readEnvFile();
  const out: Record<string, { set: boolean; value?: string }> = {};
  for (const [name, { secret }] of Object.entries(EDITABLE_KEYS)) {
    const v = process.env[name] ?? file.get(name) ?? "";
    out[name] = secret ? { set: v.trim() !== "" } : { set: v.trim() !== "", value: v };
  }
  return out;
}

/** Sets or removes (empty string) values in .env, keeping every other line as it is. */
export function updateEnvFile(patch: Record<string, string>) {
  let text = "";
  try {
    text = fs.readFileSync(ENV_FILE, "utf8");
  } catch {
    /* new file */
  }
  const lines = text.split("\n");
  for (const [name, value] of Object.entries(patch)) {
    if (!(name in EDITABLE_KEYS)) throw new Error(`${name} can't be changed from the app`);
    if (/[\r\n]/.test(value)) throw new Error(`${name} must be a single line`);
    const line = value === "" ? `${name}=` : `${name}="${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    const idx = lines.findIndex((l) => new RegExp(`^\\s*${name}\\s*=`).test(l));
    if (idx >= 0) lines[idx] = line;
    else lines.push(line);
  }
  const tmp = ENV_FILE + ".tmp";
  fs.writeFileSync(tmp, lines.join("\n").replace(/\n*$/, "\n"), { mode: 0o600 });
  fs.renameSync(tmp, ENV_FILE);
}

/** systemd sets INVOCATION_ID: then exiting makes it restart the bot with the new keys. */
export function canSelfRestart(): boolean {
  return !!process.env.INVOCATION_ID || process.env.SELF_RESTART === "1";
}
