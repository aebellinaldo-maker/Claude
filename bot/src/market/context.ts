import { fetchJson, TtlCache } from "../util/http.js";

export interface MarketContext {
  fearGreed: { value: number; label: string } | null;
  trendingCoins: { name: string; symbol: string; change24hPct: number | null }[];
  trendingCategories: string[];
}

const cache = new TtlCache<MarketContext>(15 * 60_000);

/**
 * Free market-mood data that every AI brain gets (models without web search rely on it):
 * the Crypto Fear & Greed Index and CoinGecko's trending coins/categories.
 */
export async function getMarketContext(): Promise<MarketContext> {
  const hit = cache.get("ctx");
  if (hit) return hit;

  const [fng, trending] = await Promise.allSettled([
    fetchJson<{ data?: { value: string; value_classification: string }[] }>("https://api.alternative.me/fng/?limit=1", {
      retries: 0,
      timeoutMs: 8000,
    }),
    fetchJson<{
      coins?: { item: { name: string; symbol: string; data?: { price_change_percentage_24h?: { usd?: number } } } }[];
      categories?: { name: string }[];
    }>("https://api.coingecko.com/api/v3/search/trending", { retries: 0, timeoutMs: 8000 }),
  ]);

  const f = fng.status === "fulfilled" ? fng.value?.data?.[0] : undefined;
  const t = trending.status === "fulfilled" ? trending.value : undefined;
  const ctx: MarketContext = {
    fearGreed: f ? { value: Number(f.value), label: f.value_classification } : null,
    trendingCoins: (t?.coins ?? []).slice(0, 10).map((c) => ({
      name: c.item.name,
      symbol: c.item.symbol,
      change24hPct:
        typeof c.item.data?.price_change_percentage_24h?.usd === "number"
          ? Math.round(c.item.data.price_change_percentage_24h.usd * 10) / 10
          : null,
    })),
    trendingCategories: (t?.categories ?? []).slice(0, 6).map((c) => c.name),
  };
  if (ctx.fearGreed || ctx.trendingCoins.length) cache.set("ctx", ctx);
  return ctx;
}
