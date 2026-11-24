import { Linking, Pressable, View } from "react-native";
import { useApp } from "../lib/app-context";
import { useLoader } from "../lib/use-loader";
import { eur, pct, timeAgo } from "../lib/format";
import type { TKey } from "../lib/i18n";
import { colors, pnlColor } from "../lib/theme";
import { solscanTx } from "../lib/tx";
import { Card, Divider, Loading, Note, Pill, Row, Screen, Spacer, T } from "../components/ui";

export default function TradesScreen() {
  const { t, lang, api, hasServer } = useApp();
  const { data, error, loading, refreshing, reload } = useLoader(() => api.trades(200), [api], { enabled: hasServer });
  const trades = data?.trades ?? [];

  const sells = trades.filter((x) => x.side === "sell" && x.pnlEur !== undefined);
  const wins = sells.filter((x) => (x.pnlEur ?? 0) > 0).length;
  const realized = sells.reduce((s, x) => s + (x.pnlEur ?? 0), 0);

  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      {error ? <Note kind="error">{error}</Note> : null}
      {loading && !data ? <Loading /> : null}
      {sells.length ? (
        <Card>
          <Row>
            <T dim>{t("winRate")}</T>
            <Spacer />
            <T bold>
              {wins}/{sells.length} ({Math.round((wins / sells.length) * 100)}%)
            </T>
          </Row>
          <Row>
            <T dim>{t("pnl")}</T>
            <Spacer />
            <T bold color={pnlColor(realized)}>
              {realized >= 0 ? "+" : ""}
              {eur(realized, lang)}
            </T>
          </Row>
        </Card>
      ) : null}
      {data && trades.length === 0 ? <T dim>{t("noTrades")}</T> : null}
      {trades.length ? (
        <Card>
          {trades.map((x, i) => (
            <View key={x.id} style={{ gap: 4 }}>
              {i > 0 ? <Divider /> : null}
              <Row>
                <T bold color={x.side === "buy" ? colors.accent : colors.text}>
                  {x.side === "buy" ? `↗ ${t("bought")}` : `↘ ${t("sold")}`} {x.symbol}
                </T>
                <Pill label={t(`trigger_${x.trigger}` as TKey)} />
                <Spacer />
                <View style={{ alignItems: "flex-end" }}>
                  <T bold>{eur(x.valueEur, lang)}</T>
                  {x.pnlPct !== undefined ? (
                    <T small bold color={pnlColor(x.pnlPct)}>
                      {pct(x.pnlPct)}
                    </T>
                  ) : null}
                </View>
              </Row>
              <T small dim numberOfLines={3}>
                {x.reason}
              </T>
              <Row>
                <T small faint>
                  {timeAgo(x.ts, lang)}
                </T>
                <Spacer />
                {x.signature ? (
                  <Pressable onPress={() => void Linking.openURL(solscanTx(x.signature!))}>
                    <T small color={colors.accent}>
                      Solscan ↗
                    </T>
                  </Pressable>
                ) : x.mode === "paper" ? (
                  <T small faint>
                    🧪 paper
                  </T>
                ) : null}
              </Row>
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
