import { useEffect, useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useApp } from "../../lib/app-context";
import { useLoader } from "../../lib/use-loader";
import type { Candidate } from "../../lib/api";
import { Button, Card, Divider, Field, H, Loading, Note, Screen, T } from "../../components/ui";
import { CoinRow } from "../../components/coin-row";

function List({ coins }: { coins: Candidate[] }) {
  return (
    <Card style={{ paddingVertical: 4 }}>
      {coins.map((c, i) => (
        <View key={c.mint}>
          {i > 0 ? <Divider /> : null}
          <CoinRow c={c} />
        </View>
      ))}
    </Card>
  );
}

export default function MarketScreen() {
  const { t, api, hasServer } = useApp();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Candidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const { data, error, loading, refreshing, reload } = useLoader(() => api.trending(), [api], {
    pollMs: 120_000,
    enabled: hasServer,
  });

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setResults(null);
      return;
    }
    const id = setTimeout(async () => {
      setSearching(true);
      try {
        setResults((await api.search(query)).coins);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 500);
    return () => clearTimeout(id);
  }, [q, api]);

  if (!hasServer) {
    return (
      <Screen title={t("tabMarket")}>
        <Note kind="warn">{t("serverMissing")}</Note>
        <Button title={t("goToSettings")} kind="secondary" onPress={() => router.navigate("/settings")} />
      </Screen>
    );
  }

  return (
    <Screen title={t("tabMarket")} refreshing={refreshing} onRefresh={reload}>
      <Field placeholder={t("searchPlaceholder")} value={q} onChangeText={setQ} clearButtonMode="while-editing" returnKeyType="search" />

      {results !== null || searching ? (
        searching && !results ? (
          <Loading />
        ) : results && results.length ? (
          <List coins={results} />
        ) : (
          <T dim>{t("noResults")}</T>
        )
      ) : (
        <>
          {error ? <Note kind="error">{error}</Note> : null}
          {loading && !data ? <Loading label={t("loading")} /> : null}
          {data?.botPicks?.length ? (
            <>
              <H>🤖 {t("botPicks")}</H>
              <T dim small>
                {t("botPicksHint")}
              </T>
              <List coins={data.botPicks} />
            </>
          ) : null}
          {data?.coins?.length ? (
            <>
              <H>🔥 {t("trending")}</H>
              <List coins={data.coins} />
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}
