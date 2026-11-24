import type { Lang } from "../types.js";

/** Picks the English or German version of a user-facing message. */
export function L(lang: Lang, en: string, de: string): string {
  return lang === "de" ? de : en;
}
