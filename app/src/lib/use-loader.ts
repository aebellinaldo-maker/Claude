import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";

/**
 * Loads data when the screen is focused, optionally polls while focused,
 * and supports pull-to-refresh.
 */
export function useLoader<T>(fn: () => Promise<T>, deps: unknown[], opts: { pollMs?: number; enabled?: boolean } = {}) {
  const { pollMs, enabled = true } = opts;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(
    async (mode: "initial" | "refresh" | "silent" = "silent") => {
      if (!enabled) return;
      if (mode === "initial") setLoading(true);
      if (mode === "refresh") setRefreshing(true);
      try {
        const d = await fnRef.current();
        setData(d);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, ...deps],
  );

  useEffect(() => {
    if (enabled) void run("initial");
    else setData(null);
  }, [run, enabled]);

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      void run("silent");
      if (!pollMs) return;
      const id = setInterval(() => void run("silent"), pollMs);
      return () => clearInterval(id);
    }, [run, pollMs, enabled]),
  );

  return { data, error, loading, refreshing, reload: () => run("refresh"), setData };
}
