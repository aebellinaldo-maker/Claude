/**
 * Sniper discovery: young Solana coins that just launched or are trending in the last
 * 5 minutes / 1 hour on GeckoTerminal (free API). Only the mints are returned; market data
 * comes from DexScreener like for every other coin.
 */
import { fetchJson, TtlCache } from "../util/http.js";
import { log, errMsg } from "../util/log.js";

interface GeckoPool {
  attributes: { address: string; pool_created_at?: string; reserve_in_usd?: string };
  relationships: { base_token: { data: { id: string } }; dex?: { data?: { id?: string } } };
}

const cache = new TtlCache<{ mint: string; source: string }[]>(2 * 60_000);
const BASE = "https://api.geckoterminal.com/api/v2/networks/solana";

/** Pools still on a launchpad bonding curve can't be traded reliably by the bot. */
const MIN_RESERVE_USD = 8_000;

async function pools(url: string): Promise<GeckoPool[]> {
  const r = await fetchJson<{ data?: GeckoPool[] }>(url, { retries: 0, timeoutMs: 15_000 });
  return r?.data ?? [];
}

export async function getLaunchMints(): Promise<{ mint: string; source: string }[]> {
  const hit = cache.get("launches");
  if (hit) return hit;
  const out = new Map<string, string>();
  const add = (list: GeckoPool[], source: string, minReserve = 0) => {
    for (const p of list) {
      const mint = p.relationships?.base_token?.data?.id?.replace(/^solana_/, "");
      if (!mint || out.has(mint)) continue;
      if (Number(p.attributes?.reserve_in_usd ?? 0) < minReserve) continue;
      out.set(mint, source);
    }
  };
  const jobs: [string, string, number][] = [
    [`${BASE}/trending_pools?duration=5m&page=1`, "trending_5m", 0],
    [`${BASE}/trending_pools?duration=1h&page=1`, "trending_1h", 0],
    [`${BASE}/new_pools?page=1`, "new_launch", MIN_RESERVE_USD],
    [`${BASE}/new_pools?page=2`, "new_launch", MIN_RESERVE_USD],
  ];
  // One after the other: the free API allows ~30 calls per minute.
  for (const [url, source, minReserve] of jobs) {
    try {
      add(await pools(url), source, minReserve);
    } catch (e) {
      log.debug(`Launch discovery (${source}) unavailable: ${errMsg(e)}`);
    }
  }
  const list = [...out].map(([mint, source]) => ({ mint, source }));
  if (list.length) cache.set("launches", list);
  return list;
}
