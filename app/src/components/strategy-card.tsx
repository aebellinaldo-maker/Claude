import { useState } from "react";
import { Switch, View } from "react-native";
import { Alert } from "../lib/alert";
import { useApp } from "../lib/app-context";
import type { BotStatus, RiskMode, StrategyInfo, StrategyResult } from "../lib/api";
import { colors, pnlColor } from "../lib/theme";
import { Card, Chip, Divider, Note, Row, Spacer, T } from "./ui";

const pctTxt = (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(1)}%`;
const chance = (x: number) => (x <= 0 ? "0%" : x < 0.01 ? "<1%" : `${Math.round(x * 100)}%`);

/** Normal vs. Moonshot, with the honest back-test numbers for both. */
export function StrategyCard({ status, onChanged }: { status: BotStatus; onChanged: () => void }) {
  const { t, api } = useApp();
  const [busy, setBusy] = useState(false);
  const mode = status.riskMode;
  const { normal, moonshot, winrate, backtest, winrateBacktest: wb } = status.strategies;

  const auto = status.autoMode;
  const live = status.shadow;
  const setAuto = async () => {
    if (auto || busy) return;
    setBusy(true);
    try {
      await api.saveSettings({ autoMode: true });
      onChanged();
    } catch (e) {
      Alert.alert(t("error"), (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const set = (next: RiskMode) => {
    if ((next === mode && !auto) || busy) return;
    const apply = async () => {
      setBusy(true);
      try {
        // Picking a mode by hand turns Auto off.
        await api.saveSettings({ riskMode: next, autoMode: false });
        onChanged();
      } catch (e) {
        Alert.alert(t("error"), (e as Error).message);
      } finally {
        setBusy(false);
      }
    };
    if (next === "normal" || next === mode) return void apply();
    if (next === "winrate") {
      return Alert.alert(`✅ ${t("winrateMode")}`, t("winrateConfirm"), [
        { text: t("cancel"), style: "cancel" },
        { text: t("confirm"), onPress: () => void apply() },
      ]);
    }
    Alert.alert(`🚀 ${t("moonshot")}`, status.mode === "real" ? `${t("moonshotConfirm")}\n\n${t("moonshotRealWarn")}` : t("moonshotConfirm"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("confirm"), style: "destructive", onPress: () => void apply() },
    ]);
  };

  const describe = (x: StrategyInfo) =>
    t(x.trailingStopPct >= 90 ? "strategyRulesNoTrail" : "strategyRules", {
      n: x.maxPositions,
      size: x.maxPositionPct,
      tp: x.takeProfitPct,
      sell: x.takeProfitSellPct,
      sl: x.stopLossPct,
      trail: x.trailingStopPct,
      h: x.maxHoldHours,
    });

  const Result = ({ label, r, active }: { label: string; r: StrategyResult; active: boolean }) => (
    <View style={{ gap: 2 }}>
      <Row>
        <T small bold={active} dim={!active}>
          {label}
        </T>
        <Spacer />
        <T small bold color={pnlColor(r.avgPct)}>
          {t("btAvg", { x: pctTxt(r.avgPct) })}
        </T>
      </Row>
      <T small faint>
        {t("btLine", { win: chance(r.winRate), dbl: chance(r.doubled), ten: chance(r.tenXChance), half: chance(r.halfChance) })}
      </T>
    </View>
  );

  return (
    <Card>
      <Row style={{ flexWrap: "wrap" }}>
        <Chip label={`🤖 ${t("autoMode")}`} active={auto} onPress={() => void setAuto()} />
        <Chip label={`🛡️ ${t("normalMode")}`} active={!auto && mode === "normal"} onPress={() => set("normal")} />
        <Chip label={`✅ ${t("winrateMode")}`} active={!auto && mode === "winrate"} onPress={() => set("winrate")} />
        <Chip label={`🚀 ${t("moonshot")}`} active={!auto && mode === "moonshot"} onPress={() => set("moonshot")} />
      </Row>
      {auto ? (
        <Note kind="info">
          {t("autoExplain", { mode: t(mode === "normal" ? "normalMode" : mode === "winrate" ? "winrateMode" : "moonshot") })}
        </Note>
      ) : null}
      <Row>
        <View style={{ flex: 1 }}>
          <T small bold>
            🛡️ {t("edgeTitle")}
          </T>
          <T small faint>
            {status.mode === "real" ? t("edgeHintReal") : t("edgeHint")}
          </T>
        </View>
        <Switch
          value={status.requireEdge}
          disabled={busy}
          onValueChange={(v) => void api.saveSettings({ requireEdge: v }).then(onChanged, (e: Error) => Alert.alert(t("error"), e.message))}
          trackColor={{ true: colors.accent }}
        />
      </Row>
      {status.profitGoalPct > 0 ? (
        <T small faint>
          🎯 {t("goalLine", { goal: status.profitGoalPct })}
        </T>
      ) : null}
      <View style={{ gap: 4 }}>
        <Row>
          <T small bold>
            📡 {t("liveTestTitle")}
          </T>
          <Spacer />
          <T small faint>
            {t("liveTestOpen", { n: live.open })}
          </T>
        </Row>
        <T small faint>
          {t("liveTestHint", { days: live.days })}
        </T>
        {(["normal", "winrate", "moonshot"] as const).map((m) => {
          const r = live.byMode[m];
          return (
            <Row key={m}>
              <T small bold={m === mode} dim={m !== mode}>
                {m === "normal" ? `🛡️ ${t("normalMode")}` : m === "winrate" ? `✅ ${t("winrateMode")}` : `🚀 ${t("moonshot")}`}
                {live.bestMode === m ? `  ⭐ ${t("bestNow")}` : ""}
              </T>
              <Spacer />
              <T small color={r.avgPct === null ? colors.textFaint : pnlColor(r.avgPct)}>
                {r.n ? `${t("wrWins", { w: `${Math.round((r.winRate ?? 0) * 100)}%` })} · ${pctTxt(r.avgPct ?? 0)} · ${r.n}` : t("liveTestWaiting")}
              </T>
            </Row>
          );
        })}
      </View>
      <Divider />
      <T small dim>
        {mode === "moonshot" ? t("moonshotExplain") : mode === "winrate" ? t("winrateExplain", { min: winrate.minChange24hPct }) : t("normalExplain")}
      </T>
      <T small>{describe(mode === "moonshot" ? moonshot : mode === "winrate" ? winrate : normal)}</T>
      {mode === "moonshot" ? <Note kind="warn">{t("moonshotWarn")}</Note> : null}
      {mode === "winrate" ? <Note kind="warn">{t("winrateWarn")}</Note> : null}
      {mode === "winrate" && wb ? (
        <>
          <Divider />
          <T small bold>
            🧪 {t("btTitle")}
          </T>
          <T small faint>
            {t("wrIntro", { days: wb.testDays, coins: wb.coins })}
          </T>
          {(["dip", "momentum"] as const).map((k) => {
            const r = wb[k];
            if (!r) return null;
            return (
              <View key={k} style={{ gap: 2 }}>
                <Row>
                  <T small bold>
                    {k === "dip" ? "🪝 Dip Hunter" : "⚡ Momentum"}
                  </T>
                  <Spacer />
                  <T small bold color={colors.green}>
                    {t("wrWins", { w: `${Math.round(r.test.winRate * 100)}%` })}
                  </T>
                </Row>
                <T small faint>
                  {t("wrLine", { avg: pctTxt(r.test.avgPct), avg2: pctTxt(r.test2pctFees.avgPct), n: r.test.trades, streak: r.test.lossStreak })}
                </T>
              </View>
            );
          })}
        </>
      ) : null}
      {backtest && mode !== "winrate" ? (
        <>
          <Divider />
          <T small bold>
            🧪 {t("btTitle")}
          </T>
          <T small faint>
            {t("btIntro", { n: backtest.trades, coins: backtest.coins, days: backtest.testDays })}
          </T>
          <Result label={`🛡️ ${t("normalMode")}`} r={backtest.normal} active={mode === "normal"} />
          <Result label={`🚀 ${t("moonshot")}`} r={backtest.moonshot} active={mode === "moonshot"} />
          <T small color={colors.textDim}>
            {t("btTakeaway")}
          </T>
        </>
      ) : null}
    </Card>
  );
}
