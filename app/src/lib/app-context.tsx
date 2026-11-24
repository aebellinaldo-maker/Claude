import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import * as Clipboard from "expo-clipboard";
import { storage } from "./storage";
import { getLocales } from "expo-localization";
import { createApi, type Api } from "./api";
import { translate, type Lang, type TKey } from "./i18n";
import * as phantom from "./phantom";

interface Prefs {
  serverUrl: string;
  apiToken: string;
  lang: Lang;
}

interface AppCtx {
  ready: boolean;
  prefs: Prefs;
  setPrefs: (p: Partial<Prefs>) => Promise<void>;
  api: Api;
  hasServer: boolean;
  t: (key: TKey, vars?: Record<string, string | number>) => string;
  lang: Lang;
  wallet: string | null;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => Promise<void>;
}

const PREFS_KEY = "app_prefs_v1";

/** On the web build served by the bot server, the server is simply this site. */
function webOrigin(): string {
  if (Platform.OS !== "web") return "";
  const loc = (globalThis as { location?: { origin?: string; protocol?: string } }).location;
  return loc?.protocol?.startsWith("http") ? (loc.origin ?? "") : "";
}

/** A private link like https://my-bot/#token=abc logs this browser in once. */
function tokenFromUrl(): string | null {
  if (Platform.OS !== "web") return null;
  const g = globalThis as { location?: { hash?: string; pathname?: string }; history?: { replaceState(a: unknown, b: string, c: string): void } };
  const m = /token=([^&]+)/.exec(g.location?.hash ?? "");
  if (!m) return null;
  // Remove the token from the address bar so it isn't shared by accident. The router
  // restores the initial URL once while starting up, so clean it again afterwards.
  const clean = () => {
    if (/token=/.test(g.location?.hash ?? "")) g.history?.replaceState(null, "", g.location?.pathname ?? "/");
  };
  for (const ms of [0, 800, 2000]) setTimeout(clean, ms);
  return decodeURIComponent(m[1]);
}
const Ctx = createContext<AppCtx | null>(null);

function deviceLang(): Lang {
  try {
    return getLocales()[0]?.languageCode === "de" ? "de" : "en";
  } catch {
    return "en";
  }
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [prefs, setPrefsState] = useState<Prefs>({ serverUrl: "", apiToken: "", lang: deviceLang() });
  const [wallet, setWallet] = useState<string | null>(null);
  const prefsRef = useRef(prefs);

  useEffect(() => {
    (async () => {
      try {
        const raw = await storage.get(PREFS_KEY);
        let loaded: Prefs = { ...prefsRef.current, ...(raw ? (JSON.parse(raw) as Partial<Prefs>) : {}) };
        const origin = webOrigin();
        if (origin && !loaded.serverUrl) loaded = { ...loaded, serverUrl: origin };
        const urlToken = tokenFromUrl();
        if (urlToken) loaded = { ...loaded, serverUrl: origin || loaded.serverUrl, apiToken: urlToken };
        prefsRef.current = loaded;
        setPrefsState(loaded);
        if (raw || urlToken || origin) await storage.set(PREFS_KEY, JSON.stringify(loaded));
        setWallet(await phantom.getWalletAddress());
      } finally {
        setReady(true);
      }
    })();
    return phantom.onWalletChange(setWallet);
  }, []);

  const setPrefs = useCallback(async (patch: Partial<Prefs>) => {
    const next = { ...prefsRef.current, ...patch };
    prefsRef.current = next;
    setPrefsState(next);
    await storage.set(PREFS_KEY, JSON.stringify(next));
  }, []);

  const api = useMemo(() => createApi(prefs.serverUrl, prefs.apiToken), [prefs.serverUrl, prefs.apiToken]);
  const hasServer = !!prefs.serverUrl && !!prefs.apiToken;
  const t = useCallback((key: TKey, vars?: Record<string, string | number>) => translate(prefs.lang, key, vars), [prefs.lang]);

  const connectWallet = useCallback(async () => {
    if (Platform.OS === "web" && !phantom.hasInjectedWallet()) {
      // In Safari/Chrome there's no wallet: the app has to be opened inside Phantom's browser.
      const link = `${webOrigin()}/#token=${encodeURIComponent(prefsRef.current.apiToken)}`;
      await Clipboard.setStringAsync(link).catch(() => undefined);
      throw new Error(translate(prefsRef.current.lang, "openInPhantom"));
    }
    const address = await phantom.connect();
    setWallet(address);
    // The first connected wallet becomes the bot's only withdrawal address.
    if (hasServer) {
      try {
        await api.registerOwner(address);
      } catch {
        /* shown later on the bot screen */
      }
    }
  }, [api, hasServer]);

  const disconnectWallet = useCallback(async () => {
    await phantom.disconnect();
    setWallet(null);
  }, []);

  const value: AppCtx = {
    ready,
    prefs,
    setPrefs,
    api,
    hasServer,
    t,
    lang: prefs.lang,
    wallet,
    connectWallet,
    disconnectWallet,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}
