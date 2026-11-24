import { fetchJson, TtlCache } from "../util/http.js";
import { log, errMsg } from "../util/log.js";

interface GeckoPool {
  attributes: { name: string };
  relationships: { base_token: { data: { id: string } } };
}

const cache = new TtlCache<string[]>(4 * 60_000);

/**
 * Trending Solana pools on GeckoTerminal, as a list of base-token mints in rank order.
 * The free API is rate limited; on failure we just return the last good result (or []).
 */
export async function getTrendingMints(): Promise<string[]> {
  const hit = cache.get("trending");
  if (hit) return hit;
  try {
    const r = await fetchJson<{ data: GeckoPool[] }>(
      "https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?page=1",
      { retries: 1 },
    );
    const mints = (r?.data ?? [])
      .map((p) => p.relationships?.base_token?.data?.id?.replace(/^solana_/, ""))
      .filter((m): m is string => !!m);
    cache.set("trending", mints);
    return mints;
  } catch (e) {
    log.warn(`GeckoTerminal trending unavailable: ${errMsg(e)}`);
    return [];
  }
}
