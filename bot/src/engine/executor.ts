import { LAMPORTS_PER_SOL, SOL_MINT, buildSwapTx, getQuote, type JupQuote } from "../market/jupiter.js";
import {
  botKeypair,
  closeEmptyTokenAccount,
  getSolBalance,
  getTokenHolding,
  signAndSendBot,
} from "../chain/solana.js";
import { state } from "../store.js";
import type { Position, Settings } from "../types.js";
import { log, errMsg } from "../util/log.js";

/** Approximate costs used to make paper trading realistic. */
export const PAPER_TX_FEE_SOL = 0.000005 + 0.0001; // base fee + typical priority fee
export const TOKEN_ACCOUNT_RENT_SOL = 0.00203928;

export interface BuyResult {
  rawReceived: bigint;
  solSpent: number;
  signature?: string;
}

export interface SellResult {
  rawSold: bigint;
  solReceived: number;
  signature?: string;
}

export interface Executor {
  readonly mode: "paper" | "real";
  /** SOL available for trading (before the fee reserve is subtracted). */
  cashSol(): Promise<number>;
  buy(mint: string, solAmount: number, s: Settings): Promise<BuyResult>;
  sell(pos: Position, pct: number, s: Settings): Promise<SellResult>;
}

function checkImpact(q: JupQuote, s: Settings) {
  const impact = Number(q.priceImpactPct) * 100; // Jupiter returns a fraction (0.01 = 1%)
  if (impact > s.maxPriceImpactPct) {
    throw new Error(`Price impact ${impact.toFixed(2)}% is above the ${s.maxPriceImpactPct}% limit`);
  }
}

function sellAmount(pos: Position, pct: number): bigint {
  const raw = BigInt(pos.rawAmount);
  if (pct >= 99.9) return raw;
  return (raw * BigInt(Math.round(pct * 100))) / 10_000n;
}

/** Fake money, real prices: every trade is quoted by Jupiter exactly like a real one. */
export class PaperExecutor implements Executor {
  readonly mode = "paper" as const;

  async cashSol() {
    return state.paper.solBalance;
  }

  async buy(mint: string, solAmount: number, s: Settings): Promise<BuyResult> {
    const lamports = BigInt(Math.floor(solAmount * LAMPORTS_PER_SOL));
    const q = await getQuote({ inputMint: SOL_MINT, outputMint: mint, amount: lamports, slippageBps: s.slippageBps });
    checkImpact(q, s);
    const isNew = !state.paper.positions.some((p) => p.mint === mint);
    const fees = PAPER_TX_FEE_SOL + (isNew ? TOKEN_ACCOUNT_RENT_SOL : 0);
    const solSpent = solAmount + fees;
    if (solSpent > state.paper.solBalance) throw new Error("Not enough paper SOL");
    state.paper.solBalance -= solSpent;
    return { rawReceived: BigInt(q.outAmount), solSpent };
  }

  async sell(pos: Position, pct: number, s: Settings): Promise<SellResult> {
    const amount = sellAmount(pos, pct);
    if (amount <= 0n) throw new Error("Nothing to sell");
    const q = await getQuote({ inputMint: pos.mint, outputMint: SOL_MINT, amount, slippageBps: s.slippageBps });
    const full = amount === BigInt(pos.rawAmount);
    const solReceived = Number(q.outAmount) / LAMPORTS_PER_SOL - PAPER_TX_FEE_SOL + (full ? TOKEN_ACCOUNT_RENT_SOL : 0);
    state.paper.solBalance += solReceived;
    return { rawSold: amount, solReceived };
  }
}

/** Real money: swaps via Jupiter, signed by the bot's own wallet. */
export class LiveExecutor implements Executor {
  readonly mode = "real" as const;
  private owner = botKeypair.publicKey;

  async cashSol() {
    return getSolBalance(this.owner);
  }

  async buy(mint: string, solAmount: number, s: Settings): Promise<BuyResult> {
    const lamports = BigInt(Math.floor(solAmount * LAMPORTS_PER_SOL));
    const solBefore = await getSolBalance(this.owner);
    if (solBefore - solAmount < 0.003) throw new Error("Not enough SOL left for fees");
    const tokBefore = (await getTokenHolding(this.owner, mint))?.raw ?? 0n;

    const q = await getQuote({ inputMint: SOL_MINT, outputMint: mint, amount: lamports, slippageBps: s.slippageBps });
    checkImpact(q, s);
    const swap = await buildSwapTx(q, this.owner.toBase58());
    if (swap.simulationError) throw new Error(`Swap simulation failed: ${swap.simulationError.error ?? swap.simulationError.errorCode}`);
    const signature = await signAndSendBot(swap.swapTransaction, swap.lastValidBlockHeight);

    // Measure what actually happened on-chain (fees, slippage).
    await new Promise((r) => setTimeout(r, 1500));
    const tokAfter = (await getTokenHolding(this.owner, mint))?.raw ?? 0n;
    const solAfter = await getSolBalance(this.owner);
    const rawReceived = tokAfter - tokBefore > 0n ? tokAfter - tokBefore : BigInt(q.outAmount);
    return { rawReceived, solSpent: Math.max(0, solBefore - solAfter) || solAmount, signature };
  }

  async sell(pos: Position, pct: number, s: Settings): Promise<SellResult> {
    const holding = await getTokenHolding(this.owner, pos.mint);
    if (!holding || holding.raw === 0n) throw new Error(`No ${pos.symbol} in the bot wallet`);
    // Use the on-chain balance as truth for a full exit.
    let amount = pct >= 99.9 ? holding.raw : sellAmount(pos, pct);
    if (amount > holding.raw) amount = holding.raw;
    const solBefore = await getSolBalance(this.owner);

    const q = await getQuote({ inputMint: pos.mint, outputMint: SOL_MINT, amount, slippageBps: Math.max(s.slippageBps, 300) });
    const swap = await buildSwapTx(q, this.owner.toBase58());
    if (swap.simulationError) throw new Error(`Swap simulation failed: ${swap.simulationError.error ?? swap.simulationError.errorCode}`);
    const signature = await signAndSendBot(swap.swapTransaction, swap.lastValidBlockHeight);

    await new Promise((r) => setTimeout(r, 1500));
    if (amount === holding.raw) {
      try {
        const left = await getTokenHolding(this.owner, pos.mint);
        if (left && left.raw === 0n) await closeEmptyTokenAccount(left.account, left.programId);
      } catch (e) {
        log.warn(`Could not close empty ${pos.symbol} account: ${errMsg(e)}`);
      }
    }
    const solAfter = await getSolBalance(this.owner);
    const solReceived = solAfter - solBefore > 0 ? solAfter - solBefore : Number(q.outAmount) / LAMPORTS_PER_SOL;
    return { rawSold: amount, solReceived, signature };
  }
}
