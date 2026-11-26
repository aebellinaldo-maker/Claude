import { config } from "../config.js";
import { chunk, fetchJson } from "../util/http.js";

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qJxyKBUuBWT3Z7xL3oPrEXTt1v";
export const LAMPORTS_PER_SOL = 1_000_000_000;

function headers(): Record<string, string> {
  return config.jupiter.apiKey ? { "x-api-key": config.jupiter.apiKey } : {};
}

export interface JupPrice {
  usdPrice: number;
  liquidity?: number;
  decimals: number;
  priceChange24h?: number;
}

/** USD prices (+ decimals and liquidity) for up to 50 mints per call. */
export async function getPrices(mints: string[]): Promise<Record<string, JupPrice>> {
  const out: Record<string, JupPrice> = {};
  for (const group of chunk([...new Set(mints)], 50)) {
    const r = await fetchJson<Record<string, JupPrice | null>>(
      `${config.jupiter.baseUrl}/price/v3?ids=${group.join(",")}`,
      { headers: headers() },
    );
    for (const [mint, p] of Object.entries(r ?? {})) if (p && typeof p.usdPrice === "number") out[mint] = p;
  }
  return out;
}

export interface JupQuote {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: unknown[];
  [k: string]: unknown;
}

export async function getQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: bigint | string;
  slippageBps: number;
}): Promise<JupQuote> {
  const qs = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount.toString(),
    slippageBps: String(params.slippageBps),
    restrictIntermediateTokens: "true",
  });
  return fetchJson<JupQuote>(`${config.jupiter.baseUrl}/swap/v1/quote?${qs}`, { headers: headers() });
}

export interface JupSwapTx {
  swapTransaction: string; // base64 serialized VersionedTransaction (unsigned)
  lastValidBlockHeight: number;
  prioritizationFeeLamports?: number;
  simulationError?: { errorCode?: string; error?: string } | null;
}

/** Builds an unsigned swap transaction for `userPublicKey` from a quote. */
export type PriorityLevel = "medium" | "high" | "veryHigh";

export async function buildSwapTx(quote: JupQuote, userPublicKey: string, maxPriorityLamports = 100_000, priorityLevel: PriorityLevel = "medium") {
  return fetchJson<JupSwapTx>(`${config.jupiter.baseUrl}/swap/v1/swap`, {
    method: "POST",
    headers: headers(),
    timeoutMs: 25_000,
    body: {
      quoteResponse: quote,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      dynamicSlippage: false,
      prioritizationFeeLamports: {
        priorityLevelWithMaxLamports: { maxLamports: maxPriorityLamports, priorityLevel },
      },
    },
  });
}
