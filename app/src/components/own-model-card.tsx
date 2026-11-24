import { useState } from "react";
import { View } from "react-native";
import { Alert } from "../lib/alert";
import { useApp } from "../lib/app-context";
import { useLoader } from "../lib/use-loader";
import type { MlStats } from "../lib/api";
import type { TKey } from "../lib/i18n";
import { timeAgo } from "../lib/format";
import { colors, pnlColor } from "../lib/theme";
import { Button, Card, Divider, Loading, Note, Row, Spacer, T } from "./ui";

/** Status of the bot's own trained model: honest test results + "train now". */
export function OwnModelCard() {
  const { t, lang, api, hasServer } = useApp();
  const [starting, setStarting] = useState(false);
  const status = useLoader(() => api.mlStatus(), [api], { enabled: hasServer, pollMs: 8_000 });
  const s = status.data;
  if (!s) return <Card>{status.loading ? <Loading /> : null}</Card>;

  const m = s.model;
  const tr = s.training;
  const tStat = m?.metrics.model.tStat ?? 0;
  const luck: "low" | "medium" | "high" = tStat >= 2 ? "high" : tStat >= 1 ? "medium" : "low";
  const pct = (x: number | null | undefined) => (x === null || x === undefined ? "–" : `${Math.round(x * 100)}%`);
  const ret = (x: number | null | undefined) => (x === null || x === undefined ? "–" : `${x > 0 ? "+" : ""}${x.toFixed(2)}%`);

  const train = async () => {
    setStarting(true);
    try {
      await api.mlTrain();
      await status.reload();
    } catch (e) {
      Alert.alert(t("error"), (e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const StatRow = ({ label, st, highlight }: { label: string; st: MlStats; highlight?: boolean }) => (
    <View style={{ gap: 2 }}>
      <Row>
        <T small bold={highlight} dim={!highlight}>
          {label}
        </T>
        <Spacer />
        <T small bold color={pnlColor(st.avgReturnPct)}>
          {ret(st.avgReturnPct)}
        </T>
      </Row>
      <T small faint>
        {t("winsTrades", { w: pct(st.winRate), n: st.trades, r: ret(st.avgReturnPct) })}
      </T>
    </View>
  );

  return (
    <Card>
      <T small dim>
        {t("ownModelIntro")}
      </T>
      {m ? (
        <>
          <T small>
            {t("trainedOn", { ago: timeAgo(Date.parse(m.createdAt), lang), n: m.data.samples.toLocaleString(), c: m.data.coins, d: m.data.days })}
          </T>
          <Divider />
          <T small bold>
            {t("testHeader", { d: m.metrics.testDays, c: m.metrics.testCoins })}
          </T>
          <StatRow label={t("testPicks")} st={m.metrics.model} highlight />
          <StatRow label={t("testAll")} st={m.metrics.buyEverything} />
          <StatRow label={t("testMomentum")} st={m.metrics.momentumRule} />
          <Row>
            <T small dim>
              {t("luckLabel")}
            </T>
            <Spacer />
            <T small bold color={luck === "high" ? colors.green : luck === "medium" ? colors.yellow : colors.red}>
              {t(`luck_${luck}` as TKey)}
            </T>
          </Row>
          <Divider />
          <T small bold>
            {t("liveCheck")}
          </T>
          {m.metrics.forward.available ? (
            <>
              <StatRow label={t("testPicks")} st={m.metrics.forward.model} highlight />
              <StatRow label={t("testAll")} st={m.metrics.forward.buyEverything} />
            </>
          ) : (
            <T small faint>
              {t("liveCheckWaiting", { n: m.metrics.forward.samples })}
            </T>
          )}
          <Note kind={m.metrics.tradeReady ? "success" : m.metrics.useful ? "info" : "warn"}>
            {m.metrics.tradeReady ? t("statusTradeReady") : m.metrics.useful ? t("statusPaperOnly") : t("notProvenLong")}
          </Note>
          {m.importance.length ? (
            <T small faint>
              {t("topSignals")}: {m.importance.slice(0, 4).map((i) => i.feature.replace(/_/g, " ")).join(", ")}
            </T>
          ) : null}
        </>
      ) : !tr.running ? (
        <Note>{t("notTrained")}</Note>
      ) : null}

      {tr.running ? (
        <View style={{ gap: 4 }}>
          <Row>
            <T small bold color={colors.accent}>
              ⏳ {t(`phase_${tr.phase}` as TKey)}
            </T>
            <Spacer />
            {tr.progress ? (
              <T small faint>
                {tr.progress}
              </T>
            ) : null}
          </Row>
          {tr.log.length ? (
            <T small faint numberOfLines={2}>
              {tr.log[tr.log.length - 1].slice(9)}
            </T>
          ) : null}
        </View>
      ) : tr.phase === "failed" && tr.error ? (
        <Note kind="error">{tr.error}</Note>
      ) : null}

      <Row>
        <T small faint style={{ flex: 1 }}>
          {t("chartsArchived", { n: s.archiveCoins })}
        </T>
        <Button title={m ? t("retrain") : t("trainNow")} kind="secondary" small loading={starting} disabled={tr.running || !s.trainerAvailable} onPress={train} />
      </Row>
    </Card>
  );
}
