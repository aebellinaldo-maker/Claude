import { useState } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import { Alert } from "../../lib/alert";
import { router } from "expo-router";
import { useApp } from "../../lib/app-context";
import { useLoader } from "../../lib/use-loader";
import type { BotPosition } from "../../lib/api";
import { eur, pct, timeAgo } from "../../lib/format";
import { colors, pnlColor } from "../../lib/theme";
import { Big, Button, Card, Divider, H, Loading, Note, Pill, Row, Screen, Spacer, Sparkline, T, TokenAvatar } from "../../components/ui";
import { OwnModelCard } from "../../components/own-model-card";
import { BudgetCard } from "../../components/budget-card";
import { StrategyCard } from "../../components/strategy-card";
import { StatsCard } from "../../components/stats-card";

export default function BotScreen() {
  const { t, lang, api, hasServer } = useApp();
  const confirm = (title: string, message: string, onYes: () => void, destructive = false) =>
    Alert.alert(title, message, [
      { text: t("cancel"), style: "cancel" },
      { text: t("confirm"), style: destructive ? "destructive" : "default", onPress: onYes },
    ]);
  const { width } = useWindowDimensions();
  const status = useLoader(() => api.status(), [api], { pollMs: 15_000, enabled: hasServer });
  const equity = useLoader(() => api.equity(72), [api], { pollMs: 60_000, enabled: hasServer });
  const [busy, setBusy] = useState<string | null>(null);
  const [showBriefing, setShowBriefing] = useState(false);
  const s = status.data;

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
      await status.reload();
      void equity.reload();
    } catch (e) {
      Alert.alert(t("error"), (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!hasServer) {
    return (
      <Screen title={t("botTitle")}>
        <Note kind="warn">{t("serverMissing")}</Note>
        <Button title={t("goToSettings")} kind="secondary" onPress={() => router.navigate("/settings")} />
      </Screen>
    );
  }
  if (!s) {
    return (
      <Screen title={t("botTitle")} onRefresh={status.reload} refreshing={status.refreshing}>
        {status.error ? <Note kind="error">{status.error}</Note> : <Loading label={t("loading")} />}
      </Screen>
    );
  }

  const stateLabel = s.killSwitch.tripped ? t("killSwitchTripped") : s.running ? t("running") : t("paused");
  const stateColor = s.killSwitch.tripped ? colors.red : s.running ? colors.green : colors.yellow;
  const points = (equity.data?.points ?? []).map((p) => p.eur);

  const toggleMode = () => {
    if (s.running) return Alert.alert(t("stopFirst"));
    if (s.mode === "paper") {
      confirm(t("switchToReal"), t("realConfirm"), () => void act("mode", () => api.setMode("real")), true);
    } else {
      void act("mode", () => api.setMode("paper"));
    }
  };

  const sellPos = (p: BotPosition) =>
    confirm(t("sellPosition"), t("sellConfirm", { symbol: p.symbol }), () => void act(`sell-${p.mint}`, () => api.sellPosition(p.mint, 100)), true);

  return (
    <Screen
      title={t("botTitle")}
      refreshing={status.refreshing}
      onRefresh={() => {
        void status.reload();
        void equity.reload();
      }}
    >
      <Row>
        <Pill label={`● ${stateLabel}`} color={stateColor} bg={colors.card} />
        {s.riskMode === "moonshot" ? <Pill label={`🚀 ${t("moonshot")}`} color={colors.yellow} bg={colors.yellowDim} /> : null}
        <Pill
          label={s.mode === "paper" ? `🧪 ${t("modePaper")}` : `💶 ${t("modeReal")}`}
          color={s.mode === "paper" ? colors.accent : colors.yellow}
          bg={s.mode === "paper" ? colors.accentDim : colors.yellowDim}
        />
      </Row>

      <Card>
        <T dim>{t("botValue")}</T>
        <Big>{eur(s.equity.totalEur, lang)}</Big>
        <Row gap={16}>
          <T small dim>
            {t("today")}{" "}
            <T small bold color={pnlColor(s.pnl.dailyPct)}>
              {pct(s.pnl.dailyPct)}
            </T>
          </T>
          <T small dim>
            {t("total")}{" "}
            <T small bold color={pnlColor(s.pnl.totalPct)}>
              {pct(s.pnl.totalPct)} ({s.pnl.totalEur >= 0 ? "+" : ""}
              {eur(s.pnl.totalEur, lang)})
            </T>
          </T>
        </Row>
        <View style={{ marginHorizontal: -4, marginTop: 6 }}>
          <Sparkline values={points} width={width - 64} color={points.length > 1 && points[points.length - 1] < points[0] ? colors.red : colors.green} />
        </View>
        <T small faint>
          {t("cash")} {eur(s.equity.cashEur, lang)} · {t("coins")} {eur(s.equity.positionsEur, lang)}
        </T>
      </Card>

      {s.killSwitch.tripped ? <Note kind="error">{s.killSwitch.reason}</Note> : null}
      {s.pnl.noNewBuys && s.pnl.breakerReason && !s.killSwitch.tripped ? <Note kind="warn">{s.pnl.breakerReason}</Note> : null}
      {!s.running && !s.killSwitch.tripped && s.positions.length > 0 ? <Note>{t("pausedNote")}</Note> : null}
      {s.lastError ? <Note kind="error">{s.lastError}</Note> : null}

      <Row>
        {s.running ? (
          <Button title={t("pauseBot")} kind="secondary" loading={busy === "stop"} onPress={() => void act("stop", api.stop)} style={{ flex: 1 }} />
        ) : (
          <Button title={t("startBot")} kind="success" loading={busy === "start"} onPress={() => void act("start", api.start)} style={{ flex: 1 }} />
        )}
        {s.running ? (
          <Button title={t("scanNow")} kind="secondary" loading={busy === "scan"} onPress={() => void act("scan", api.scanNow)} style={{ flex: 1 }} />
        ) : null}
      </Row>
      <Button
        title={t("panicSell")}
        kind="danger"
        loading={busy === "panic"}
        onPress={() => confirm(t("panicSell"), t("panicConfirm"), () => void act("panic", api.panic), true)}
      />
      {s.running && s.nextScanAt ? (
        <T small faint style={{ textAlign: "center" }}>
          {t("lastScan")}: {timeAgo(s.lastScanAt, lang)}
        </T>
      ) : null}

      <Card>
        <T small dim>
          {s.mode === "paper" ? t("paperExplainer") : t("realExplainer")}
        </T>
        <Row>
          <Button title={s.mode === "paper" ? t("switchToReal") : t("switchToPaper")} kind="secondary" small loading={busy === "mode"} onPress={toggleMode} style={{ flex: 1 }} />
          {s.mode === "paper" ? (
            <Button
              title={t("resetPaper")}
              kind="ghost"
              small
              onPress={() =>
                s.running
                  ? Alert.alert(t("stopFirst"))
                  : confirm(t("resetPaper"), t("resetPaperConfirm", { eur: eur(s.paperBudgetEur, lang) }), () => void act("reset", () => api.resetPaper()))
              }
            />
          ) : (
            <Button title={t("botWallet")} kind="ghost" small onPress={() => router.push("/fund-bot")} />
          )}
        </Row>
      </Card>

      <H>{t("budgetTitle")}</H>
      <BudgetCard mode={s.mode} running={s.running} onChanged={() => void status.reload()} />

      <H>🎯 {t("strategyTitle")}</H>
      <StrategyCard status={s} onChanged={() => void status.reload()} />

      <H>{t("positions")}</H>
      <Card style={{ paddingVertical: 6 }}>
        {s.positions.length === 0 ? (
          <T dim style={{ paddingVertical: 10 }}>
            {t("noPositions")}
          </T>
        ) : (
          s.positions.map((p, i) => (
            <View key={p.mint} style={{ paddingVertical: 10, gap: 6 }}>
              {i > 0 ? <Divider /> : null}
              <Pressable onPress={() => router.push({ pathname: "/token/[mint]", params: { mint: p.mint } })}>
                <Row gap={12}>
                  <TokenAvatar uri={p.imageUrl} symbol={p.symbol} />
                  <View style={{ flex: 1 }}>
                    <T bold>{p.symbol}</T>
                    <T small dim>
                      {t("heldFor")} {timeAgo(p.openedAt, lang)}
                      {p.tookProfit ? " · ✓ TP" : ""}
                    </T>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <T bold>{eur(p.valueEur, lang)}</T>
                    <T small bold color={pnlColor(p.pnlPct)}>
                      {pct(p.pnlPct)}
                    </T>
                  </View>
                </Row>
              </Pressable>
              <T small faint numberOfLines={3}>
                {t("why")}: {p.reason}
              </T>
              <Button title={t("sellPosition")} kind="secondary" small loading={busy === `sell-${p.mint}`} onPress={() => sellPos(p)} />
            </View>
          ))
        )}
      </Card>

      <H>📊 {t("trackRecord")}</H>
      <StatsCard stats={s.stats} />

      <H>🧠 AI</H>
      <Card>
        {!s.ai.available ? <Note>{t("aiOffNote")}</Note> : null}
        {s.marketView ? (
          <>
            <T small dim>
              {t("marketView")}
            </T>
            <T>{s.marketView}</T>
          </>
        ) : null}
        {s.briefing ? (
          <Pressable onPress={() => setShowBriefing((v) => !v)}>
            <Row>
              <T small dim>
                {t("briefing")} · {timeAgo(s.briefing.ts, lang)}
              </T>
              <Spacer />
              <T small color={colors.accent}>
                {showBriefing ? "▲" : "▼"}
              </T>
            </Row>
            <T small numberOfLines={showBriefing ? undefined : 4} style={{ marginTop: 4 }}>
              {s.briefing.text}
            </T>
          </Pressable>
        ) : null}
        {s.ai.available ? (
          <Row>
            <T small faint style={{ flex: 1 }}>
              {s.ai.modelLabel ?? s.ai.model} ·{" "}
              {s.ai.free
                ? `${t("aiFree")} · ${s.ai.callsToday} ${t("aiCalls")}`
                : `${t("aiCostToday")}: $${s.ai.spentTodayUsd.toFixed(3)} / $${s.ai.budgetUsd.toFixed(2)}`}
            </T>
            {s.ai.briefingSupported ? (
              <Button title={t("refresh")} kind="ghost" small loading={busy === "brief"} onPress={() => void act("brief", api.refreshBriefing)} />
            ) : null}
          </Row>
        ) : null}
      </Card>

      <H>🤖 {t("ownModelTitle")}</H>
      <OwnModelCard />

      <Row>
        <H>{t("activity")}</H>
        <Spacer />
        <Button title={`${t("tradeHistory")} →`} kind="ghost" small onPress={() => router.push("/trades")} />
      </Row>
      <Card>
        {s.events.slice(0, 15).map((e, i) => (
          <View key={`${e.ts}-${i}`} style={{ gap: 2 }}>
            <T small color={e.level === "error" ? colors.red : e.level === "warn" ? colors.yellow : colors.text}>
              {e.msg}
            </T>
            <T small faint>
              {timeAgo(e.ts, lang)}
            </T>
          </View>
        ))}
      </Card>
    </Screen>
  );
}
