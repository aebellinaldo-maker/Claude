import { serve } from "@hono/node-server";
import { config } from "./config.js";
import { app } from "./api/server.js";
import { bot } from "./engine/bot.js";
import { botKeypair } from "./chain/solana.js";
import { aiAvailable } from "./ai/claude.js";
import { state } from "./store.js";
import { log } from "./util/log.js";

log.info("──────────────────────────────────────────────");
log.info(" Crypto bot server");
log.info(` Mode:        ${state.mode.toUpperCase()} (${state.running ? "running" : "stopped"})`);
log.info(` Bot wallet:  ${botKeypair.publicKey.toBase58()}`);
log.info(` AI:          ${aiAvailable() ? `on (${state.settings.aiModel})` : "off — set ANTHROPIC_API_KEY to enable"}`);
log.info(` RPC:         ${config.rpcUrl.replace(/api-key=[^&]+/, "api-key=***")}`);
log.info(` API:         http://${config.host}:${config.port}  (token in data/api-token.txt or API_TOKEN)`);
log.info("──────────────────────────────────────────────");

serve({ fetch: app.fetch, port: config.port, hostname: config.host });
bot.boot();

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    log.info(`${sig} received, saving state and exiting`);
    bot.shutdown();
    process.exit(0);
  });
}

process.on("unhandledRejection", (e) => log.error("Unhandled rejection", e));
