/**
 * Whale Tail: who is buying big right now? Reads the latest large trades of a pool from
 * GeckoTerminal (free) and keeps a book of the wallets behind them. Six hours after a
 * wallet's big buy the bot checks whether the price went up — wallets that keep buying
 * before rises become "smart wallets", and their buys count extra.
 */
import type { WhaleBook, WhaleInfo } from "../types.js";
import { fetchJson, TtlCache } from "../util/http.js";
import { log, errMsg } from "../util/log.js";

interface GeckoTrade {
  attributes: {
    kind: "buy" | "sell";
    volume_in_usd: string;
    tx_from_address: string;
    block_timestamp: string;
    price_to_in_usd?: string;
    price_from_in_usd?: string;
  };
}

export const WHALE_WINDOW_MIN = 60;
const EVALUATE_AFTER_MS = 6 * 3_600_000;
const cache = new TtlCache<WhaleInfo>(2 * 60_000);

/** A "big" trade: about 1% of the pool's liquidity, at least $1,000, at most $25,000. */
export function whaleThresholdUsd(liquidityUsd: number): number {
  return Math.round(Math.min(25_000, Math.max(1_000, liquidityUsd * 0.01)));
}

export function isSmartWallet(w: { n: number; wins: number; sumRet: number } | undefined): boolean {
  return !!w && w.n >= 3 && w.wins / w.n >= 0.5 && w.sumRet / w.n >= 0.15;
}

/** Pure part: summarise trades (newest first) into whale activity. */
export function summariseTrades(
  trades: GeckoTrade[],
  thresholdUsd: number,
  now: number,
  book: WhaleBook,
): { info: WhaleInfo; buys: { wallet: string; priceUsd: number; ts: number }[] } {
  const since = now - WHALE_WINDOW_MIN * 60_000;
  let bigBuys = 0,
    bigSells = 0,
    buyUsd = 0,
    sellUsd = 0;
  const buyers = new Map<string, { priceUsd: number; ts: number }>();
  for (const t of trades) {
    const a = t.attributes;
    const ts = Date.parse(a.block_timestamp);
    if (!(ts >= since)) continue;
    const usd = Number(a.volume_in_usd);
    if (!(usd >= thresholdUsd)) continue;
    if (a.kind === "buy") {
      bigBuys++;
      buyUsd += usd;
      if (!buyers.has(a.tx_from_address)) buyers.set(a.tx_from_address, { priceUsd: Number(a.price_to_in_usd ?? 0), ts });
    } else {
      bigSells++;
      sellUsd += usd;
    }
  }
  const wallets = [...buyers.keys()];
  return {
    info: {
      windowMin: WHALE_WINDOW_MIN,
      thresholdUsd,
      bigBuys,
      bigSells,
      buyUsd: Math.round(buyUsd),
      sellUsd: Math.round(sellUsd),
      whales: wallets.length,
      smartWallets: wallets.filter((w) => isSmartWallet(book.wallets[w])).length,
      wallets: wallets.slice(0, 10),
      checkedAt: now,
    },
    buys: [...buyers].map(([wallet, v]) => ({ wallet, ...v })),
  };
}

/** Large-wallet activity in a pool over the last hour (cached 2 minutes). */
export async function getWhaleInfo(pool: string, mint: string, liquidityUsd: number, book: WhaleBook): Promise<WhaleInfo | undefined> {
  const hit = cache.get(pool);
  if (hit) return hit;
  const threshold = whaleThresholdUsd(liquidityUsd);
  try {
    const r = await fetchJson<{ data?: GeckoTrade[] }>(
      `https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/trades?trade_volume_in_usd_greater_than=${threshold}`,
      { retries: 0, timeoutMs: 15_000 },
    );
    const { info, buys } = summariseTrades(r?.data ?? [], threshold, Date.now(), book);
    // Remember each big buy once per wallet and coin, to check later whether it was smart.
    for (const b of buys) {
      if (!(b.priceUsd > 0)) continue;
      if (book.pending.some((x) => x.wallet === b.wallet && x.mint === mint)) continue;
      book.pending.push({ wallet: b.wallet, mint, priceUsd: b.priceUsd, ts: b.ts });
    }
    cache.set(pool, info);
    return info;
  } catch (e) {
    log.debug(`Whale trades for ${pool} unavailable: ${errMsg(e)}`);
    return undefined;
  }
}

/**
 * Grades big buys that are at least 6 hours old: did the price go up? `prices` maps
 * mint → current USD price. Returns how many were graded.
 */
export function gradeWhaleBuys(book: WhaleBook, prices: Record<string, number | undefined>, now: number): number {
  let graded = 0;
  const keep: WhaleBook["pending"] = [];
  for (const p of book.pending) {
    const age = now - p.ts;
    if (age < EVALUATE_AFTER_MS) {
      keep.push(p);
      continue;
    }
    const price = prices[p.mint];
    if (!(price && price > 0)) {
      if (age < 4 * EVALUATE_AFTER_MS) keep.push(p); // try again later, give up after a day
      continue;
    }
    const ret = price / p.priceUsd - 1;
    const w = book.wallets[p.wallet] ?? { n: 0, wins: 0, sumRet: 0, last: 0 };
    w.n++;
    if (ret > 0.1) w.wins++;
    w.sumRet += Math.max(-1, Math.min(5, ret)); // cap one lucky moonshot
    w.last = now;
    book.wallets[p.wallet] = w;
    graded++;
  }
  book.pending = keep;
  return graded;
}

/** Mints whose big buys are due for grading. */
export function mintsToGrade(book: WhaleBook, now: number, max = 60): string[] {
  const out = new Set<string>();
  for (const p of book.pending) {
    if (now - p.ts >= EVALUATE_AFTER_MS) out.add(p.mint);
    if (out.size >= max) break;
  }
  return [...out];
}
