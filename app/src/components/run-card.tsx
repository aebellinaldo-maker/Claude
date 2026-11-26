import { useState } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { useApp } from "../lib/app-context";
import { STRATEGY_IDS, type BotStatus, type SessionSummary, type StrategyId } from "../lib/api";
import type { TKey } from "../lib/i18n";
import { eur, timeAgo } from "../lib/format";
import { colors, pnlColor, radius } from "../lib/theme";
import { Big, Card, Chip, Divider, Pill, Row, Spacer, T, TokenAvatar } from "./ui";
import { EquityChart } from "./equity-chart";

export const STRATEGY_ICON: Record<StrategyId, string> = { sniper: "🎯", momentum: "⚡", dip: "🪝", whale: "🐋" };

export function runName(startedAt: number): TKey {
  const h = new Date(startedAt).getHours();
  return h >= 22 || h < 5 ? "run_night" : h < 11 ? "run_morning" : h < 17 ? "run_day" : "run_evening";
}

export const hhmm = (ts: number) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export function signedEur(x: number, lang: "en" | "de") {
  return `${x >= 0 ? "+" : "−"}${eur(Math.abs(x), lang)}`;
}

/** One line of the activity feed: "Dip Hunter sold $VICE · Take profit · +€4.90". */
export function ActivityRow({ a }: { a: SessionSummary["activity"][number] }) {
  const { t, lang } = useApp();
  return (
    <Row gap={10} style={{ paddingVertical: 6 }}>
      <TokenAvatar uri={a.imageUrl ?? undefined} symbol={a.symbol} />
      <View style={{ flex: 1 }}>
        <T small numberOfLines={1}>
          <T small bold>
            {t(`st_${a.strategy}` as TKey)}
          </T>{" "}
          {a.side === "sell" ? t("soldWord") : t("boughtWord")}{" "}
          <T small bold>
            ${a.symbol}
          </T>
        </T>
        <T small faint numberOfLines={1}>
          {hhmm(a.ts)} · {a.side === "sell" ? t(`trigger_${a.trigger}` as TKey) : eur(a.valueEur, lang)}
        </T>
      </View>
      {a.side === "sell" && a.pnlEur !== null ? (
        <T bold color={pnlColor(a.pnlEur)}>
          {signedEur(a.pnlEur, lang)}
        </T>
      ) : (
        <T small faint>
          {STRATEGY_ICON[a.strategy]}
        </T>
      )}
    </Row>
  );
}

/** The live "run" dashboard on the Bot tab. */
export function RunCard({ status }: { status: BotStatus }) {
  const { t, lang } = useApp();
  const { width } = useWindowDimensions();
  const [log, setLog] = useState(false);
  const r = status.session!;
  const pct = r.startEur > 0 ? (r.valueEur / r.startEur - 1) * 100 : 0;
  const latest = r.activity[0];
  const fresh = latest && Date.now() - latest.ts < 15 * 60_000 ? latest : null;
  const lastTradeStrategy = STRATEGY_IDS.reduce<StrategyId | null>(
    (best, id) => ((r.byStrategy[id].lastTradeAt ?? 0) > (best ? (r.byStrategy[best].lastTradeAt ?? 0) : 0) ? id : best),
    null,
  );
  const chartW = Math.min(width, 640) - 64;

  return (
    <Card style={{ gap: 12 }}>
      <Row>
        <View>
          <T bold style={{ fontSize: 18 }}>
            {t(runName(r.startedAt))}
          </T>
          <T small faint>
            {hhmm(r.startedAt)} – {r.live ? t("liveTag") : hhmm(r.endedAt ?? Date.now())}
          </T>
        </View>
        <Spacer />
        {r.live ? <Pill label={`● ${t("liveTag")}`} color={colors.green} bg={colors.greenDim} /> : <Pill label={t("endedTag")} />}
      </Row>

      {fresh ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            padding: 10,
            borderRadius: radius.md,
            backgroundColor: fresh.side === "sell" ? ((fresh.pnlEur ?? 0) >= 0 ? colors.greenDim : colors.redDim) : colors.cardAlt,
          }}
        >
          <TokenAvatar uri={fresh.imageUrl ?? undefined} symbol={fresh.symbol} />
          <View style={{ flex: 1 }}>
            <T small bold numberOfLines={1}>
              {t(`st_${fresh.strategy}` as TKey)} {fresh.side === "sell" ? t("soldWord") : t("boughtWord")} ${fresh.symbol}
            </T>
            <T small dim numberOfLines={1}>
              {fresh.side === "sell" ? t(`trigger_${fresh.trigger}` as TKey) : eur(fresh.valueEur, lang)} · {hhmm(fresh.ts)}
            </T>
          </View>
          {fresh.side === "sell" && fresh.pnlEur !== null ? (
            <T bold color={pnlColor(fresh.pnlEur)}>
              {signedEur(fresh.pnlEur, lang)}
            </T>
          ) : null}
        </View>
      ) : null}

      <View>
        <T small faint style={{ letterSpacing: 1 }}>
          {t("portfolioValue").toUpperCase()}
        </T>
        <Big>{eur(r.valueEur, lang)}</Big>
        <Row>
          <T bold color={pnlColor(r.profitEur)}>
            {signedEur(r.profitEur, lang)}
          </T>
          <Pill label={`${pct >= 0 ? "+" : ""}${pct.toFixed(pct > 999 ? 0 : 1)}%`} color={pnlColor(pct)} bg={pct >= 0 ? colors.greenDim : colors.redDim} />
          <Spacer />
          <T small faint>
            {t("startedWith", { eur: eur(r.startEur, lang) })}
          </T>
        </Row>
        {status.profitGoalPct > 0 && r.live ? (
          <View style={{ gap: 3, marginTop: 6 }}>
            <Row>
              <T small faint>
                🎯 {t("goalProgress", { goal: status.profitGoalPct })}
              </T>
              <Spacer />
              <T small faint>
                {`${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% / +${status.profitGoalPct}%`}
              </T>
            </Row>
            <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.cardAlt }}>
              <View
                style={{
                  height: 4,
                  borderRadius: 2,
                  width: `${Math.max(0, Math.min(100, (pct / status.profitGoalPct) * 100))}%`,
                  backgroundColor: colors.green,
                }}
              />
            </View>
          </View>
        ) : null}
      </View>

      <View style={{ backgroundColor: colors.cardAlt, borderRadius: radius.md, padding: 10, gap: 6 }}>
        <Row>
          <T small faint style={{ letterSpacing: 1 }}>
            {t("sessionEquity").toUpperCase()}
          </T>
          <Spacer />
          <Chip label={t("logScale")} active={log} onPress={() => setLog((v) => !v)} />
        </Row>
        <EquityChart points={r.equity} startEur={r.startEur} width={chartW} log={log} />
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {STRATEGY_IDS.map((id) => {
          const b = r.byStrategy[id];
          const on = status.squad[id]?.enabled && !status.squad[id]?.benched && !(status.riskMode === "winrate" && (id === "sniper" || id === "whale"));
          const hot = id === lastTradeStrategy && b.lastTradeAt && Date.now() - b.lastTradeAt < 30 * 60_000;
          return (
            <View
              key={id}
              style={{
                width: "48%",
                flexGrow: 1,
                padding: 10,
                gap: 2,
                borderRadius: radius.md,
                backgroundColor: colors.cardAlt,
                borderWidth: 1,
                borderColor: hot ? (b.profitEur >= 0 ? colors.green : colors.red) : colors.border,
                opacity: on ? 1 : 0.45,
              }}
            >
              <Row gap={6}>
                <T>{STRATEGY_ICON[id]}</T>
                <T small bold numberOfLines={1} style={{ flex: 1 }}>
                  {t(`st_${id}` as TKey)}
                </T>
              </Row>
              <T small faint numberOfLines={1}>
                {t(`stTag_${id}` as TKey)}
              </T>
              <T small faint style={{ marginTop: 4, letterSpacing: 1, fontSize: 10 }}>
                {t("profitLabel").toUpperCase()}
              </T>
              <T bold numberOfLines={1} color={pnlColor(b.profitEur)} style={{ fontSize: 17 }}>
                {signedEur(b.profitEur, lang)}
              </T>
              <T small faint numberOfLines={1}>
                {on ? (b.trades === 1 ? t("tradeOne") : t("tradesN", { n: b.trades })) : "off"}
                {b.open ? ` · ${t("openN", { n: b.open })}` : ""}
              </T>
            </View>
          );
        })}
      </View>

      <Divider />
      <Row>
        <T bold>{t("recentActivity")}</T>
        <Spacer />
        <T small faint>
          {r.trades ? t("executedN", { n: r.trades }) : r.live ? timeAgo(r.startedAt, lang) : ""}
        </T>
      </Row>
      {r.activity.length ? (
        r.activity.slice(0, 5).map((a, i) => <ActivityRow key={`${a.ts}-${i}`} a={a} />)
      ) : (
        <T small faint style={{ textAlign: "center", paddingVertical: 12 }}>
          {r.live ? t("scanningSignals") : t("noFinishedRun")}
        </T>
      )}
      <Pressable onPress={() => router.push("/session")} style={{ paddingVertical: 8 }}>
        <T color={colors.accent} bold style={{ textAlign: "center" }}>
          {t("sessionSummary")} →
        </T>
      </Pressable>
    </Card>
  );
}
