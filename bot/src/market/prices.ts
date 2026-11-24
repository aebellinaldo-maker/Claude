import { fetchJson } from "../util/http.js";
import { getPrices, SOL_MINT } from "./jupiter.js";
import { log, errMsg } from "../util/log.js";

interface SolPrice {
  usd: number;
  eur: number;
  /** EUR per 1 USD */
  eurPerUsd: number;
  ts: number;
}

let cached: SolPrice | undefined;
let eurPerUsd = 0.92; // sensible fallback until the first CoinGecko response

/**
 * SOL price in USD and EUR. CoinGecko gives EUR; Jupiter is the fallback for USD
 * (EUR then derived from the last known EUR/USD rate). Cached for 60 seconds.
 */
export async function getSolPrice(): Promise<SolPrice> {
  if (cached && Date.now() - cached.ts < 60_000) return cached;
  try {
    const r = await fetchJson<{ solana: { usd: number; eur: number } }>(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=eur,usd",
      { retries: 0, timeoutMs: 8000 },
    );
    if (r?.solana?.usd && r.solana.eur) {
      eurPerUsd = r.solana.eur / r.solana.usd;
      cached = { usd: r.solana.usd, eur: r.solana.eur, eurPerUsd, ts: Date.now() };
      return cached;
    }
  } catch (e) {
    log.debug(`CoinGecko price failed, using Jupiter: ${errMsg(e)}`);
  }
  try {
    const p = await getPrices([SOL_MINT]);
    const usd = p[SOL_MINT]?.usdPrice;
    if (usd) {
      cached = { usd, eur: usd * eurPerUsd, eurPerUsd, ts: Date.now() };
      return cached;
    }
  } catch (e) {
    log.warn(`Jupiter SOL price failed: ${errMsg(e)}`);
  }
  if (cached) return cached;
  throw new Error("SOL price unavailable");
}

export function usdToEur(usd: number): number {
  return usd * (cached?.eurPerUsd ?? eurPerUsd);
}
