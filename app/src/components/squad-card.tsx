import { useState } from "react";
import { Switch, View } from "react-native";
import { Alert } from "../lib/alert";
import { useApp } from "../lib/app-context";
import { STRATEGY_IDS, type BotStatus, type StrategyId } from "../lib/api";
import type { TKey } from "../lib/i18n";
import { colors } from "../lib/theme";
import { Card, Divider, Note, Pill, Row, T } from "./ui";
import { STRATEGY_ICON } from "./run-card";

const pct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}%`;

/** The four strategies: on/off, their exit rules, their own record and money weight. */
export function SquadCard({ status, onChanged }: { status: BotStatus; onChanged: () => void }) {
  const { t, api } = useApp();
  const [busy, setBusy] = useState<StrategyId | null>(null);
  const squad = status.squad;
  const bt = status.squadBacktest;

  const toggle = async (id: StrategyId, on: boolean) => {
    setBusy(id);
    try {
      const strategies = Object.fromEntries(STRATEGY_IDS.map((x) => [x, x === id ? on : squad[x].enabled])) as Record<StrategyId, boolean>;
      await api.saveSettings({ strategies });
      onChanged();
    } catch (e) {
      Alert.alert(t("error"), (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <T small dim>
        {t("squadHint")}
      </T>
      {STRATEGY_IDS.every((id) => !squad[id].enabled) ? <Note kind="warn">{t("squadOffAll")}</Note> : null}
      {STRATEGY_IDS.map((id, i) => {
        const q = squad[id];
        const x = q.exits;
        return (
          <View key={id} style={{ gap: 3 }}>
            {i > 0 ? <Divider /> : null}
            <Row>
              <T style={{ fontSize: 20 }}>{STRATEGY_ICON[id]}</T>
              <View style={{ flex: 1 }}>
                <T bold>{t(`st_${id}` as TKey)}</T>
                <T small faint>
                  {t(`stTag_${id}` as TKey)}
                </T>
              </View>
              <Switch value={q.enabled} disabled={busy === id} onValueChange={(v) => void toggle(id, v)} trackColor={{ true: colors.accent }} />
            </Row>
            <T small dim>
              {t("exitsLine", { sl: x.stopLossPct, sell: x.takeProfitSellPct, tp: x.takeProfitPct, trail: x.trailingStopPct, h: x.maxHoldHours })}
            </T>
            <Row style={{ flexWrap: "wrap" }}>
              <T small faint style={{ flex: 1 }}>
                {q.closed
                  ? t("squadRecord", {
                      n: q.closed,
                      w: q.winRate === null ? "–" : `${Math.round(q.winRate * 100)}%`,
                      pf: q.profitFactor === null ? "–" : q.profitFactor >= 99 ? "∞" : q.profitFactor.toFixed(2),
                      m: q.weight.toFixed(1),
                    })
                  : t("squadNoTrades")}
              </T>
              {q.benched ? <Pill label={t("benchedTag")} color={colors.red} bg={colors.redDim} /> : null}
            </Row>
          </View>
        );
      })}
      {bt ? (
        <>
          <Divider />
          <T small faint>
            🧪{" "}
            {t("dipTested", {
              days: bt.testDays,
              dip: pct(bt.dip.avgPct),
              win: `${Math.round(bt.dip.winRate * 100)}%`,
              mom: pct(bt.momentum.avgPct),
              base: pct(bt.baseline.avgPct),
            })}
          </T>
        </>
      ) : null}
    </Card>
  );
}
