import crypto from "node:crypto";
import { config } from "../config.js";

/**
 * Buying crypto with card / PayPal / Apple Pay / bank transfer goes through a
 * licensed on-ramp provider. They handle the payment, ID check (KYC) and the
 * EU licensing, then send the coins straight to YOUR Phantom wallet.
 */

export type PayMethod = "card" | "paypal" | "apple_pay" | "google_pay" | "bank";
export type Provider = "moonpay" | "transak" | "moonpay_web";

const moonpayMethod: Record<PayMethod, string> = {
  card: "credit_debit_card",
  paypal: "paypal",
  apple_pay: "apple_pay",
  google_pay: "google_pay",
  bank: "sepa_bank_transfer",
};

export function availableProviders(): { id: Provider; name: string; methods: PayMethod[]; prefillsWallet: boolean }[] {
  const out: { id: Provider; name: string; methods: PayMethod[]; prefillsWallet: boolean }[] = [];
  if (config.moonpay.publishableKey && config.moonpay.secretKey) {
    out.push({ id: "moonpay", name: "MoonPay", methods: ["card", "paypal", "apple_pay", "google_pay", "bank"], prefillsWallet: true });
  }
  if (config.transak.apiKey) {
    out.push({ id: "transak", name: "Transak", methods: ["card", "apple_pay", "google_pay", "bank"], prefillsWallet: true });
  }
  // Always available: MoonPay's public website (you paste your address there).
  out.push({ id: "moonpay_web", name: "MoonPay (website)", methods: ["card", "paypal", "apple_pay", "bank"], prefillsWallet: false });
  return out;
}

export function onrampUrl(opts: {
  provider: Provider;
  wallet: string;
  currency: "sol" | "usdc";
  amountEur?: number;
  method?: PayMethod;
}): { url: string; prefillsWallet: boolean } {
  const { provider, wallet, currency, amountEur, method } = opts;

  if (provider === "moonpay") {
    const { publishableKey, secretKey } = config.moonpay;
    if (!publishableKey || !secretKey) throw new Error("MoonPay keys are not configured on the server");
    const params = new URLSearchParams({
      apiKey: publishableKey,
      currencyCode: currency === "sol" ? "sol" : "usdc_sol",
      walletAddress: wallet,
      baseCurrencyCode: "eur",
    });
    if (amountEur) params.set("baseCurrencyAmount", String(amountEur));
    if (method) params.set("paymentMethod", moonpayMethod[method]);
    const query = `?${params.toString()}`;
    // MoonPay requires URLs that contain a wallet address to be signed with the secret key.
    const signature = crypto.createHmac("sha256", secretKey).update(query).digest("base64");
    return { url: `https://buy.moonpay.com${query}&signature=${encodeURIComponent(signature)}`, prefillsWallet: true };
  }

  if (provider === "transak") {
    if (!config.transak.apiKey) throw new Error("Transak key is not configured on the server");
    const params = new URLSearchParams({
      apiKey: config.transak.apiKey,
      cryptoCurrencyCode: currency.toUpperCase(),
      network: "solana",
      walletAddress: wallet,
      disableWalletAddressForm: "true",
      fiatCurrency: "EUR",
    });
    if (amountEur) params.set("fiatAmount", String(amountEur));
    return { url: `https://global.transak.com/?${params.toString()}`, prefillsWallet: true };
  }

  return { url: `https://www.moonpay.com/buy/${currency === "sol" ? "sol" : "usdc"}`, prefillsWallet: false };
}
