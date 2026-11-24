import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
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
        if (raw) {
          const loaded = { ...prefsRef.current, ...(JSON.parse(raw) as Partial<Prefs>) };
          prefsRef.current = loaded;
          setPrefsState(loaded);
        }
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
