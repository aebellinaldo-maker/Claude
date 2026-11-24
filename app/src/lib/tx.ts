import type { Api } from "./api";
import * as phantom from "./phantom";

/**
 * Gets a transaction (built by the server, unsigned, base64) approved in Phantom
 * and onto the blockchain. Tries "sign and send" first; if Phantom doesn't support
 * that request, falls back to "sign only" and lets the server broadcast it.
 */
export async function signAndSubmit(api: Api, txBase64: string): Promise<string> {
  try {
    return await phantom.signAndSendTransaction(txBase64);
  } catch (e) {
    if (phantom.isUserRejection(e)) throw e;
    if (e instanceof phantom.PhantomError && e.code && e.code !== "-32603") {
      const signed = await phantom.signTransaction(txBase64);
      const { signature } = await api.sendSigned(signed);
      return signature;
    }
    throw e;
  }
}

export function solscanTx(signature: string) {
  return `https://solscan.io/tx/${signature}`;
}
