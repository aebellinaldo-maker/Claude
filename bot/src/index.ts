import { serve } from "@hono/node-server";
import { config } from "./config.js";
import { app } from "./api/server.js";
import { bot } from "./engine/bot.js";
import { botKeypair } from "./chain/solana.js";
import { resolveModel } from "./ai/models.js";
import { state } from "./store.js";
import { log } from "./util/log.js";

log.info("──────────────────────────────────────────────");
log.info(" Crypto bot server");
log.info(` Mode:        ${state.mode.toUpperCase()} (${state.running ? "running" : "stopped"})`);
log.info(` Bot wallet:  ${botKeypair.publicKey.toBase58()}`);
const brain = resolveModel(state.settings);
log.info(` AI:          ${brain ? `${brain.label}` : "off — set ANTHROPIC_API_KEY, OLLAMA_MODELS, OPENROUTER_API_KEY or XAI_API_KEY"}`);
log.info(` RPC:         ${config.rpcUrl.replace(/api-key=[^&]+/, "api-key=***")}`);
log.info(` API:         http://${config.host}:${config.port}  (token in data/api-token.txt or API_TOKEN)`);
log.info("──────────────────────────────────────────────");

serve({ fetch: app.fetch, port: config.port, hostname: config.host });

// Free hosts like Render put a service to sleep after ~15 minutes without visits, which
// would stop the bot. Render tells us our public address; visit it every 10 minutes.
const publicUrl = process.env.RENDER_EXTERNAL_URL ?? process.env.KEEPALIVE_URL;
if (publicUrl) {
  setInterval(() => {
    fetch(`${publicUrl.replace(/\/+$/, "")}/api/health`).catch(() => undefined);
  }, 10 * 60_000);
  log.info(` Keep-alive:  pinging ${publicUrl} every 10 minutes`);
}
bot.boot();

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    log.info(`${sig} received, saving state and exiting`);
    bot.shutdown();
    process.exit(0);
  });
}

process.on("unhandledRejection", (e) => log.error("Unhandled rejection", e));
