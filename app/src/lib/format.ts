import type { Lang } from "./i18n";

const locale = (lang: Lang) => (lang === "de" ? "de-DE" : "en-IE");

export function eur(v: number | null | undefined, lang: Lang, digits = 2) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  return new Intl.NumberFormat(locale(lang), {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(v);
}

export function usdPrice(v: number | null | undefined, lang: Lang) {
  if (v === null || v === undefined || !Number.isFinite(v) || v === 0) return "–";
  const digits = v >= 1 ? 2 : v >= 0.01 ? 4 : Math.min(10, Math.ceil(-Math.log10(v)) + 3);
  return "$" + new Intl.NumberFormat(locale(lang), { maximumFractionDigits: digits, minimumFractionDigits: Math.min(2, digits) }).format(v);
}

export function compactUsd(v: number | null | undefined, lang: Lang) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  // K / M / B abbreviations are standard in crypto in both languages.
  void lang;
  return "$" + new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
}

export function num(v: number | null | undefined, lang: Lang, digits = 4) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  return new Intl.NumberFormat(locale(lang), { maximumFractionDigits: digits }).format(v);
}

export function pct(v: number | null | undefined, digits = 1) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

export function shortAddr(a: string | null | undefined) {
  if (!a) return "";
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

export function timeAgo(ts: number | null | undefined, lang: Lang) {
  if (!ts) return "–";
  const s = Math.round((Date.now() - ts) / 1000);
  const de = lang === "de";
  if (s < 60) return de ? "gerade eben" : "just now";
  const m = Math.round(s / 60);
  if (m < 60) return de ? `vor ${m} Min.` : `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return de ? `vor ${h} Std.` : `${h} h ago`;
  const d = Math.round(h / 24);
  return de ? `vor ${d} Tagen` : `${d} days ago`;
}

/** Converts a decimal amount ("1.5") to the smallest unit as an integer string. */
export function toRaw(amount: string, decimals: number): string | null {
  const clean = amount.replace(",", ".").trim();
  if (!/^\d*\.?\d*$/.test(clean) || clean === "" || clean === ".") return null;
  const [whole, frac = ""] = clean.split(".");
  const raw = (whole || "0") + frac.padEnd(decimals, "0").slice(0, decimals);
  const trimmed = raw.replace(/^0+/, "");
  return trimmed === "" ? "0" : trimmed;
}
