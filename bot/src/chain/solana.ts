import fs from "node:fs";
import path from "node:path";
import bs58 from "bs58";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  type ParsedAccountData,
} from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createCloseAccountInstruction } from "@solana/spl-token";
import { config } from "../config.js";
import { log } from "../util/log.js";

export const connection = new Connection(config.rpcUrl, "confirmed");

/**
 * The bot's own hot wallet. It only ever holds the small amount you send it.
 * Created on first start and stored in data/bot-wallet.json (keep a backup!).
 */
export function loadBotKeypair(): Keypair {
  if (config.botWalletSecret) {
    return Keypair.fromSecretKey(bs58.decode(config.botWalletSecret));
  }
  const file = path.join(config.dataDir, "bot-wallet.json");
  if (fs.existsSync(file)) {
    const arr = JSON.parse(fs.readFileSync(file, "utf8")) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }
  const kp = Keypair.generate();
  fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  log.warn(`Created a NEW bot wallet ${kp.publicKey.toBase58()} — back up ${file}!`);
  return kp;
}

export const botKeypair = loadBotKeypair();

export function isValidAddress(addr: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) return false;
  try {
    new PublicKey(addr);
    return true;
  } catch {
    return false;
  }
}

export async function getSolBalance(owner: PublicKey | string): Promise<number> {
  const lamports = await connection.getBalance(new PublicKey(owner), "confirmed");
  return lamports / 1e9;
}

export interface TokenHolding {
  mint: string;
  raw: bigint;
  decimals: number;
  uiAmount: number;
  account: string;
  programId: string;
}

/** All SPL + Token-2022 balances of a wallet (empty accounts included). */
export async function getTokenHoldings(owner: PublicKey | string): Promise<TokenHolding[]> {
  const pk = new PublicKey(owner);
  const out: TokenHolding[] = [];
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const res = await connection.getParsedTokenAccountsByOwner(pk, { programId }, "confirmed");
    for (const { pubkey, account } of res.value) {
      const info = (account.data as ParsedAccountData).parsed?.info;
      if (!info) continue;
      const amt = info.tokenAmount;
      out.push({
        mint: info.mint,
        raw: BigInt(amt.amount),
        decimals: amt.decimals,
        uiAmount: Number(amt.uiAmountString ?? amt.uiAmount ?? 0),
        account: pubkey.toBase58(),
        programId: programId.toBase58(),
      });
    }
  }
  return out;
}

export async function getTokenHolding(owner: PublicKey | string, mint: string): Promise<TokenHolding | undefined> {
  const res = await connection.getParsedTokenAccountsByOwner(new PublicKey(owner), { mint: new PublicKey(mint) }, "confirmed");
  let best: TokenHolding | undefined;
  for (const { pubkey, account } of res.value) {
    const info = (account.data as ParsedAccountData).parsed?.info;
    if (!info) continue;
    const h: TokenHolding = {
      mint,
      raw: BigInt(info.tokenAmount.amount),
      decimals: info.tokenAmount.decimals,
      uiAmount: Number(info.tokenAmount.uiAmountString ?? 0),
      account: pubkey.toBase58(),
      programId: account.owner.toBase58(),
    };
    if (!best || h.raw > best.raw) best = h;
  }
  return best;
}

/**
 * Sends an already-signed transaction and waits for confirmation, re-broadcasting
 * every 2 seconds (Solana drops transactions under load) until it lands or expires.
 */
export async function sendAndConfirm(raw: Uint8Array, blockhash: string, lastValidBlockHeight: number): Promise<string> {
  const signature = await connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 0, preflightCommitment: "confirmed" });
  let done = false;
  const rebroadcast = (async () => {
    while (!done) {
      await new Promise((r) => setTimeout(r, 2000));
      if (done) break;
      try {
        await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
      } catch {
        /* already processed or expired */
      }
    }
  })();
  try {
    const res = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    if (res.value.err) throw new Error(`Transaction failed on-chain: ${JSON.stringify(res.value.err)}`);
    return signature;
  } finally {
    done = true;
    await rebroadcast.catch(() => undefined);
  }
}

/** Signs a base64 unsigned versioned transaction (e.g. a Jupiter swap) with the bot wallet and sends it. */
export async function signAndSendBot(txBase64: string, lastValidBlockHeight: number): Promise<string> {
  const tx = VersionedTransaction.deserialize(Buffer.from(txBase64, "base64"));
  tx.sign([botKeypair]);
  return sendAndConfirm(tx.serialize(), tx.message.recentBlockhash, lastValidBlockHeight);
}

/** Broadcasts a transaction the user already signed in Phantom (base64). */
export async function sendUserSigned(txBase64: string): Promise<string> {
  const bytes = Buffer.from(txBase64, "base64");
  let blockhash: string;
  try {
    blockhash = VersionedTransaction.deserialize(bytes).message.recentBlockhash;
  } catch {
    blockhash = Transaction.from(bytes).recentBlockhash!;
  }
  const { lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  // The user's blockhash may be a bit older than ours; give it ~150 blocks of grace.
  return sendAndConfirm(bytes, blockhash, lastValidBlockHeight);
}

/** Unsigned SOL transfer the user signs in Phantom (used to fund the bot wallet). */
export async function buildTransferTx(from: string, to: string, lamports: number): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: new PublicKey(from), blockhash, lastValidBlockHeight }).add(
    SystemProgram.transfer({ fromPubkey: new PublicKey(from), toPubkey: new PublicKey(to), lamports }),
  );
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}

/** Sends SOL from the bot wallet (withdrawals to your own Phantom wallet). */
export async function botTransferSol(to: string, lamports: number): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: botKeypair.publicKey, blockhash, lastValidBlockHeight }).add(
    SystemProgram.transfer({ fromPubkey: botKeypair.publicKey, toPubkey: new PublicKey(to), lamports }),
  );
  tx.sign(botKeypair);
  return sendAndConfirm(tx.serialize(), blockhash, lastValidBlockHeight);
}

/** Closes an empty token account to get its ~0.002 SOL rent back (matters with a €10 budget). */
export async function closeEmptyTokenAccount(account: string, programId: string): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: botKeypair.publicKey, blockhash, lastValidBlockHeight }).add(
    createCloseAccountInstruction(
      new PublicKey(account),
      botKeypair.publicKey,
      botKeypair.publicKey,
      [],
      new PublicKey(programId),
    ),
  );
  tx.sign(botKeypair);
  return sendAndConfirm(tx.serialize(), blockhash, lastValidBlockHeight);
}
