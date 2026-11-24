import { View, useWindowDimensions } from "react-native";
import { useApp } from "../lib/app-context";
import { useLoader } from "../lib/use-loader";
import { usdPrice } from "../lib/format";
import { colors } from "../lib/theme";
import { CandleChart } from "./candle-chart";
import { Card, Loading, Pill, Row, Spacer, T } from "./ui";

/** 24 h candlestick chart + technical analysis + the own model's probability. */
export function ChartCard({ mint }: { mint: string }) {
  const { t, lang, api, hasServer } = useApp();
  const { width } = useWindowDimensions();
  const { data, loading, error } = useLoader(() => api.tokenChart(mint), [api, mint], { enabled: hasServer, pollMs: 120_000 });

  if (!data) {
    return <Card>{loading ? <Loading label={t("chart24h")} /> : error ? <T small dim>{error}</T> : null}</Card>;
  }
  const ch = data.chart;
  const hi = data.candles.length ? Math.max(...data.candles.map((k) => k.h)) : 0;
  const lo = data.candles.length ? Math.min(...data.candles.map((k) => k.l)) : 0;
  const rsi = ch ? Number(ch.rsi) : null;
  const trend = ch ? String(ch.trend) : null;
  const pct = (x: number) => `${Math.round(x * 100)}%`;

  return (
    <Card>
      <Row>
        <T bold>📈 {t("chart24h")}</T>
        <Spacer />
        <T small faint>
          H {usdPrice(hi, lang)} · L {usdPrice(lo, lang)}
        </T>
      </Row>
      <View style={{ marginHorizontal: -4 }}>
        <CandleChart candles={data.candles} width={width - 64} />
      </View>
      {ch ? (
        <Row style={{ flexWrap: "wrap" }}>
          <Pill
            label={t(`trend_${trend}` as "trend_up")}
            color={trend === "up" ? colors.green : trend === "down" ? colors.red : colors.textDim}
          />
          <Pill
            label={`RSI ${rsi}${rsi !== null && rsi > 70 ? ` · ${t("overbought")}` : rsi !== null && rsi < 30 ? ` · ${t("oversold")}` : ""}`}
            color={rsi !== null && rsi > 70 ? colors.red : rsi !== null && rsi < 30 ? colors.green : colors.text}
          />
          <Pill label={`${t("volumeVsAvg")} ${ch.volume_vs_avg_1h}×`} color={Number(ch.volume_vs_avg_1h) >= 1.5 ? colors.accent : colors.textDim} />
          <Pill label={`−${ch.below_24h_high_pct}% ${t("belowHigh")}`} />
        </Row>
      ) : null}
      {data.mlProb !== null && data.model ? (
        <View style={{ gap: 6, marginTop: 4 }}>
          <Row>
            <T small bold>
              🤖 {t("ownModel")}
              {data.model.useful ? "" : ` (${t("notProven")})`}
            </T>
            <Spacer />
            <T bold color={data.mlProb >= data.model.threshold ? colors.green : data.mlProb >= data.model.baseWinRate ? colors.text : colors.red}>
              {pct(data.mlProb)}
            </T>
          </Row>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.cardAlt, overflow: "hidden" }}>
            <View
              style={{
                width: `${Math.min(100, Math.round(data.mlProb * 100))}%`,
                height: 6,
                backgroundColor: data.mlProb >= data.model.threshold ? colors.green : colors.accent,
              }}
            />
          </View>
          <T small dim>
            {t("ownModelChance", { p: pct(data.mlProb), tp: data.model.tpPct, sl: data.model.slPct, h: data.model.hours })}
          </T>
          <T small faint>
            {t("typicalChance", { p: pct(data.model.baseWinRate), t: pct(data.model.threshold) })}
          </T>
        </View>
      ) : null}
    </Card>
  );
}
