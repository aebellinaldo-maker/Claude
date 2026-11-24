/**
 * Phantom wallet on iPhone via Phantom's deep-link protocol.
 *
 * Flow: we open https://phantom.app/ul/v1/<method>?… → Phantom asks the user to
 * approve → Phantom opens our app again at <redirect_link>?nonce=…&data=… (handled
 * by src/app/phantom/[action].tsx), and the encrypted answer is decrypted here.
 *
 * Encryption: X25519 key exchange + XSalsa20-Poly1305 (tweetnacl "box"); keys,
 * nonces and payloads are base58 encoded.
 */
import nacl from "tweetnacl";
import bs58 from "bs58";
import { Buffer } from "buffer";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import { storage } from "./storage";
import Constants from "expo-constants";

// tweetnacl needs a secure random source; React Native provides one via expo-crypto.
nacl.setPRNG((x: Uint8Array, n: number) => {
  x.set(Crypto.getRandomBytes(n));
});

const PHANTOM = "https://phantom.app/ul/v1";
const STORE_KEY = "phantom_session_v1";
const APP_URL: string = (Constants.expoConfig?.extra as { phantomAppUrl?: string } | undefined)?.phantomAppUrl ?? "https://expo.dev";

interface Session {
  dappSecretKey: string; // base58
  dappPublicKey: string; // base58
  phantomEncryptionPublicKey?: string;
  session?: string;
  walletAddress?: string;
}

let current: Session | null = null;
const listeners = new Set<(address: string | null) => void>();

type Pending = { resolve: (data: Record<string, unknown>) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
const pending = new Map<string, Pending>();

export class PhantomError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

async function load(): Promise<Session> {
  if (current) return current;
  const raw = await storage.get(STORE_KEY);
  if (raw) {
    current = JSON.parse(raw) as Session;
    return current;
  }
  const kp = nacl.box.keyPair();
  current = { dappSecretKey: bs58.encode(kp.secretKey), dappPublicKey: bs58.encode(kp.publicKey) };
  await persist();
  return current;
}

async function persist() {
  if (current) await storage.set(STORE_KEY, JSON.stringify(current));
}

function notify() {
  for (const l of listeners) l(current?.walletAddress ?? null);
}

export function onWalletChange(fn: (address: string | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function getWalletAddress(): Promise<string | null> {
  return (await load()).walletAddress ?? null;
}

function sharedSecret(s: Session): Uint8Array {
  if (!s.phantomEncryptionPublicKey) throw new PhantomError("Not connected to Phantom");
  return nacl.box.before(bs58.decode(s.phantomEncryptionPublicKey), bs58.decode(s.dappSecretKey));
}

function decrypt(data: string, nonce: string, secret: Uint8Array): Record<string, unknown> {
  const opened = nacl.box.open.after(bs58.decode(data), bs58.decode(nonce), secret);
  if (!opened) throw new PhantomError("Could not decrypt Phantom's response");
  return JSON.parse(Buffer.from(opened).toString("utf8")) as Record<string, unknown>;
}

function encrypt(payload: object, secret: Uint8Array): { nonce: string; payload: string } {
  const nonce = nacl.randomBytes(24);
  const box = nacl.box.after(Buffer.from(JSON.stringify(payload)), nonce, secret);
  return { nonce: bs58.encode(nonce), payload: bs58.encode(box) };
}

function redirect(action: string) {
  return Linking.createURL(`phantom/${action}`);
}

function waitFor(action: string): Promise<Record<string, unknown>> {
  const old = pending.get(action);
  if (old) {
    clearTimeout(old.timer);
    old.reject(new PhantomError("Replaced by a newer request"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(action);
      reject(new PhantomError("No answer from Phantom (timed out)"));
    }, 5 * 60_000);
    pending.set(action, { resolve, reject, timer });
  });
}

async function open(url: string) {
  try {
    await Linking.openURL(url);
  } catch {
    throw new PhantomError("Could not open Phantom. Is the Phantom app installed?");
  }
}

/**
 * Called by the deep-link route when Phantom sends the user back to the app.
 * Returns true if a waiting request was completed.
 */
export async function handlePhantomRedirect(action: string, params: Record<string, string | undefined>): Promise<boolean> {
  const p = pending.get(action);
  if (params.errorCode) {
    const err = new PhantomError(params.errorMessage || `Phantom error ${params.errorCode}`, params.errorCode);
    if (p) {
      clearTimeout(p.timer);
      pending.delete(action);
      p.reject(err);
      return true;
    }
    return false;
  }
  try {
    const s = await load();
    let data: Record<string, unknown> = {};
    if (action === "connect") {
      if (!params.phantom_encryption_public_key || !params.nonce || !params.data) throw new PhantomError("Incomplete answer from Phantom");
      s.phantomEncryptionPublicKey = params.phantom_encryption_public_key;
      data = decrypt(params.data, params.nonce, sharedSecret(s));
      s.session = String(data.session);
      s.walletAddress = String(data.public_key);
      await persist();
      notify();
    } else if (params.data && params.nonce) {
      data = decrypt(params.data, params.nonce, sharedSecret(s));
    }
    if (p) {
      clearTimeout(p.timer);
      pending.delete(action);
      p.resolve(data);
      return true;
    }
    return action === "connect";
  } catch (e) {
    if (p) {
      clearTimeout(p.timer);
      pending.delete(action);
      p.reject(e instanceof Error ? e : new PhantomError(String(e)));
    }
    return false;
  }
}

export async function connect(): Promise<string> {
  const s = await load();
  const params = new URLSearchParams({
    app_url: APP_URL,
    dapp_encryption_public_key: s.dappPublicKey,
    redirect_link: redirect("connect"),
    cluster: "mainnet-beta",
  });
  const wait = waitFor("connect");
  await open(`${PHANTOM}/connect?${params.toString()}`);
  const data = await wait;
  return String(data.public_key);
}

export async function disconnect(): Promise<void> {
  const s = await load();
  if (s.session && s.phantomEncryptionPublicKey) {
    try {
      const enc = encrypt({ session: s.session }, sharedSecret(s));
      const params = new URLSearchParams({
        dapp_encryption_public_key: s.dappPublicKey,
        nonce: enc.nonce,
        redirect_link: redirect("disconnect"),
        payload: enc.payload,
      });
      void open(`${PHANTOM}/disconnect?${params.toString()}`);
    } catch {
      /* forget locally anyway */
    }
  }
  current = { dappSecretKey: s.dappSecretKey, dappPublicKey: s.dappPublicKey };
  await persist();
  notify();
}

async function sessionRequest(method: string, payload: Record<string, unknown>) {
  const s = await load();
  if (!s.session || !s.walletAddress) throw new PhantomError("Connect Phantom first");
  const enc = encrypt({ ...payload, session: s.session }, sharedSecret(s));
  const params = new URLSearchParams({
    dapp_encryption_public_key: s.dappPublicKey,
    nonce: enc.nonce,
    redirect_link: redirect(method),
    payload: enc.payload,
  });
  const wait = waitFor(method);
  await open(`${PHANTOM}/${method}?${params.toString()}`);
  return wait;
}

/** Phantom signs AND sends the transaction. Input: base64 serialized tx. Returns the signature. */
export async function signAndSendTransaction(txBase64: string): Promise<string> {
  const data = await sessionRequest("signAndSendTransaction", {
    transaction: bs58.encode(Buffer.from(txBase64, "base64")),
  });
  return String(data.signature);
}

/** Phantom only signs; we broadcast ourselves. Returns the signed tx as base64. */
export async function signTransaction(txBase64: string): Promise<string> {
  const data = await sessionRequest("signTransaction", {
    transaction: bs58.encode(Buffer.from(txBase64, "base64")),
  });
  return Buffer.from(bs58.decode(String(data.transaction))).toString("base64");
}

/** Codes Phantom uses when the user said no — don't retry another way in that case. */
export function isUserRejection(e: unknown): boolean {
  return e instanceof PhantomError && (e.code === "4001" || /reject|declin|cancel/i.test(e.message));
}
