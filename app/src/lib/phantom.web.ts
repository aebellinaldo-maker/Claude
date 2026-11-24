/**
 * Phantom in the browser (web version of the app). Inside the Phantom app's own browser,
 * Phantom injects `window.phantom.solana`; we use it directly — no deep links needed.
 * Same exports as phantom.ts (Metro picks this file for web builds).
 */
import { Buffer } from "buffer";
import { VersionedTransaction } from "@solana/web3.js";

interface PhantomProvider {
  isPhantom?: boolean;
  publicKey?: { toBase58(): string } | null;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toBase58(): string } }>;
  disconnect(): Promise<void>;
  signAndSendTransaction(tx: VersionedTransaction): Promise<{ signature: string }>;
  signTransaction(tx: VersionedTransaction): Promise<VersionedTransaction>;
  on?(event: string, cb: (arg: unknown) => void): void;
}

export class PhantomError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

const listeners = new Set<(address: string | null) => void>();
let address: string | null = null;
let restored = false;

function provider(): PhantomProvider | null {
  const w = globalThis as unknown as { phantom?: { solana?: PhantomProvider }; solana?: PhantomProvider };
  const p = w.phantom?.solana ?? w.solana;
  return p && p.isPhantom ? p : null;
}

function setAddress(a: string | null) {
  address = a;
  for (const l of listeners) l(a);
}

function wrap(e: unknown): PhantomError {
  const err = e as { code?: number | string; message?: string };
  return new PhantomError(err?.message ?? String(e), err?.code !== undefined ? String(err.code) : undefined);
}

/** True when the page runs inside a browser with Phantom (e.g. the Phantom app's browser). */
export function hasInjectedWallet(): boolean {
  return provider() !== null;
}

export function onWalletChange(fn: (address: string | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function getWalletAddress(): Promise<string | null> {
  const p = provider();
  if (!p) return null;
  if (!restored) {
    restored = true;
    p.on?.("accountChanged", (pk) => setAddress(pk ? (pk as { toBase58(): string }).toBase58() : null));
    p.on?.("disconnect", () => setAddress(null));
    try {
      // Reconnects silently if the user already approved this site before.
      const r = await p.connect({ onlyIfTrusted: true });
      address = r.publicKey.toBase58();
    } catch {
      address = null;
    }
  }
  return address;
}

/** Nothing to handle on the web: Phantom answers directly, without redirects. */
export async function handlePhantomRedirect(_action: string, _params: Record<string, string | undefined>): Promise<boolean> {
  return false;
}

export async function connect(): Promise<string> {
  const p = provider();
  if (!p) throw new PhantomError("NO_PHANTOM_BROWSER", "no-provider");
  try {
    const r = await p.connect();
    const a = r.publicKey.toBase58();
    setAddress(a);
    return a;
  } catch (e) {
    throw wrap(e);
  }
}

export async function disconnect(): Promise<void> {
  try {
    await provider()?.disconnect();
  } finally {
    setAddress(null);
  }
}

function toTx(txBase64: string): VersionedTransaction {
  // Handles both versioned (Jupiter swaps) and legacy (SOL transfers) transactions.
  return VersionedTransaction.deserialize(Buffer.from(txBase64, "base64"));
}

export async function signAndSendTransaction(txBase64: string): Promise<string> {
  const p = provider();
  if (!p) throw new PhantomError("NO_PHANTOM_BROWSER", "no-provider");
  try {
    const { signature } = await p.signAndSendTransaction(toTx(txBase64));
    return signature;
  } catch (e) {
    throw wrap(e);
  }
}

export async function signTransaction(txBase64: string): Promise<string> {
  const p = provider();
  if (!p) throw new PhantomError("NO_PHANTOM_BROWSER", "no-provider");
  try {
    const signed = await p.signTransaction(toTx(txBase64));
    return Buffer.from(signed.serialize()).toString("base64");
  } catch (e) {
    throw wrap(e);
  }
}

export function isUserRejection(e: unknown): boolean {
  return e instanceof PhantomError && (e.code === "4001" || /reject|declin|cancel/i.test(e.message));
}
