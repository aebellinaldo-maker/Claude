/**
 * Small fetch wrapper: timeout, JSON parsing, retries on 429/5xx, and a
 * per-host minimum spacing between requests so we stay inside free API limits.
 */

export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
    public body: string,
  ) {
    super(`HTTP ${status} for ${url}: ${body.slice(0, 200)}`);
  }
}

const lastCallByHost = new Map<string, number>();
const minSpacingMs: Record<string, number> = {
  "api.dexscreener.com": 250, // 300 req/min on pair endpoints, 60/min on boosts/profiles
  "api.geckoterminal.com": 2500, // ~30 req/min on the free tier
  "api.rugcheck.xyz": 600,
  "api.coingecko.com": 3000,
  "lite-api.jup.ag": 200,
  "api.jup.ag": 100,
};

async function respectSpacing(url: string) {
  const host = new URL(url).host;
  const spacing = minSpacingMs[host] ?? 0;
  if (!spacing) return;
  const last = lastCallByHost.get(host) ?? 0;
  const wait = last + spacing - Date.now();
  lastCallByHost.set(host, Math.max(Date.now(), last + spacing));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

export interface FetchOpts {
  method?: "GET" | "POST";
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
}

export async function fetchJson<T = unknown>(url: string, opts: FetchOpts = {}): Promise<T> {
  const { method = "GET", body, headers = {}, timeoutMs = 15_000, retries = 2 } = opts;
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await respectSpacing(url);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          accept: "application/json",
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        const retryable = res.status === 429 || res.status >= 500;
        if (retryable && attempt < retries) {
          attempt++;
          await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
          continue;
        }
        throw new HttpError(res.status, url, text);
      }
      return (text ? JSON.parse(text) : null) as T;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (attempt < retries) {
        attempt++;
        await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
        continue;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Tiny time-based cache for API responses. */
export class TtlCache<V> {
  private map = new Map<string, { v: V; exp: number }>();
  constructor(private ttlMs: number) {}
  get(k: string): V | undefined {
    const hit = this.map.get(k);
    if (!hit) return undefined;
    if (hit.exp < Date.now()) {
      this.map.delete(k);
      return undefined;
    }
    return hit.v;
  }
  set(k: string, v: V) {
    this.map.set(k, { v, exp: Date.now() + this.ttlMs });
    if (this.map.size > 2000) {
      const now = Date.now();
      for (const [key, val] of this.map) if (val.exp < now) this.map.delete(key);
    }
  }
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
