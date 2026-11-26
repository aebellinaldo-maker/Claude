import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Platform, Pressable, View, useWindowDimensions } from "react-native";
import { useApp } from "../lib/app-context";
import { useLoader } from "../lib/use-loader";
import type { TKey } from "../lib/i18n";
import { eur } from "../lib/format";
import { colors, pnlColor, radius } from "../lib/theme";
import { Big, Card, Divider, H, Loading, Note, Pill, Row, Screen, Spacer, T, TokenAvatar } from "../components/ui";
import { hhmm, runName, signedEur, STRATEGY_ICON } from "../components/run-card";

const CONFETTI = [colors.green, colors.accent, colors.yellow, "#5CC8FF", "#FF8AD8"];

/** A short burst of confetti for a run that ended in profit. */
function Confetti() {
  const { width, height } = useWindowDimensions();
  const pieces = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => ({
        x: Math.random() * width,
        delay: Math.random() * 600,
        spin: Math.random() * 720 - 360,
        color: CONFETTI[i % CONFETTI.length],
        w: 5 + Math.random() * 5,
        anim: new Animated.Value(0),
      })),
    [width],
  );
  useEffect(() => {
    Animated.stagger(
      20,
      pieces.map((p) =>
        Animated.timing(p.anim, { toValue: 1, duration: 2600, delay: p.delay, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== "web" }),
      ),
    ).start();
  }, [pieces]);
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width, height }}>
      {pieces.map((p, i) => (
        <Animated.View
          key={i}
          style={{
            position: "absolute",
            left: p.x,
            top: -20,
            width: p.w,
            height: p.w * 1.6,
            backgroundColor: p.color,
            borderRadius: 1,
            opacity: p.anim.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0] }),
            transform: [
              { translateY: p.anim.interpolate({ inputRange: [0, 1], outputRange: [0, height * 0.9] }) },
              { rotate: p.anim.interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${p.spin}deg`] }) },
            ],
          }}
        />
      ))}
    </View>
  );
}

/** Summary of the current or a past run: profit, multiple, win rate, every coin's result. */
export default function SessionScreen() {
  const { t, lang, api, hasServer } = useApp();
  const [id, setId] = useState<string | undefined>(undefined);
  const run = useLoader(() => api.session(id), [api, id], { enabled: hasServer, pollMs: 20_000 });
  const past = useLoader(() => api.sessions(), [api], { enabled: hasServer });
  const r = run.data?.session;
  const celebrated = useRef<string | null>(null);
  const [party, setParty] = useState(false);
  useEffect(() => {
    if (r && r.profitEur > 0 && celebrated.current !== r.id) {
      celebrated.current = r.id;
      setParty(true);
      const timer = setTimeout(() => setParty(false), 3500);
      return () => clearTimeout(timer);
    }
  }, [r]);

  if (!r) {
    return <Screen>{run.loading ? <Loading /> : <Note>{t("noRunYet")}</Note>}</Screen>;
  }
  const maxAbs = Math.max(0.01, ...r.coins.map((c) => Math.abs(c.pnlEur)));

  return (
    <View style={{ flex: 1 }}>
      <Screen refreshing={run.refreshing} onRefresh={run.reload}>
        <View style={{ alignItems: "center", gap: 4 }}>
          <T bold style={{ fontSize: 22 }}>
            {t("sessionSummary")}
          </T>
          <T small faint>
            {t(runName(r.startedAt))} · {hhmm(r.startedAt)} – {r.live ? t("liveTag") : hhmm(r.endedAt ?? Date.now())} · {r.mode === "paper" ? "🧪" : "💶"}
          </T>
        </View>

        <Card style={{ alignItems: "center", gap: 6 }}>
          <T small faint style={{ letterSpacing: 1 }}>
            {t("totalProfit").toUpperCase()}
          </T>
          <Big color={pnlColor(r.profitEur)}>{signedEur(r.profitEur, lang)}</Big>
          <T dim>
            {eur(r.startEur, lang)} → {eur(r.valueEur, lang)} · {r.multiple.toFixed(r.multiple >= 10 ? 1 : 2)}x
          </T>
          <Row style={{ marginTop: 6, alignSelf: "stretch" }}>
            {[
              [t("tradesLabel"), String(r.trades)],
              [t("statWinRate"), r.winRate === null ? "–" : `${Math.round(r.winRate * 100)}%`],
              [t("avgTrade"), r.avgTradeEur === null ? "–" : signedEur(r.avgTradeEur, lang)],
            ].map(([k, v]) => (
              <View key={k} style={{ flex: 1, alignItems: "center", backgroundColor: colors.cardAlt, borderRadius: radius.sm, paddingVertical: 8 }}>
                <T small faint numberOfLines={1} style={{ fontSize: 10, letterSpacing: 1 }}>
                  {k.toUpperCase()}
                </T>
                <T bold>{v}</T>
              </View>
            ))}
          </Row>
        </Card>

        <H>{t("coinPerformance")}</H>
        <Card>
          {r.coins.length ? (
            r.coins.map((c, i) => (
              <View key={`${c.mint}-${c.closedAt}`}>
                {i > 0 ? <Divider /> : null}
                <Row gap={10} style={{ paddingVertical: 8 }}>
                  <TokenAvatar uri={c.imageUrl} symbol={c.symbol} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <Row>
                      <T bold>${c.symbol}</T>
                      <Spacer />
                      <T bold color={pnlColor(c.pnlEur)}>
                        {signedEur(c.pnlEur, lang)}
                      </T>
                    </Row>
                    <Row>
                      <T small faint style={{ flex: 1 }} numberOfLines={1}>
                        {STRATEGY_ICON[c.strategy]} {t(`st_${c.strategy}` as TKey)} · {c.exitTriggers.map((x) => t(`trigger_${x}` as TKey)).join(" + ")}
                      </T>
                      <T small color={pnlColor(c.pnlPct)}>
                        {c.pnlPct >= 0 ? "+" : ""}
                        {c.pnlPct.toFixed(0)}%
                      </T>
                    </Row>
                    <View style={{ height: 3, borderRadius: 2, backgroundColor: colors.cardAlt }}>
                      <View
                        style={{
                          height: 3,
                          borderRadius: 2,
                          width: `${Math.max(4, (Math.abs(c.pnlEur) / maxAbs) * 100)}%`,
                          backgroundColor: c.pnlEur >= 0 ? colors.green : colors.red,
                        }}
                      />
                    </View>
                  </View>
                </Row>
              </View>
            ))
          ) : (
            <T small faint>
              {t("noFinishedRun")}
            </T>
          )}
        </Card>

        {past.data && past.data.sessions.length ? (
          <>
            <H>{t("pastRuns")}</H>
            <Card>
              {past.data.sessions.slice(0, 10).map((x, i) => {
                const profit = (x.endEur ?? x.startEur) - x.startEur;
                return (
                  <Pressable key={x.id} onPress={() => setId(x.id)}>
                    {i > 0 ? <Divider /> : null}
                    <Row style={{ paddingVertical: 8 }}>
                      <T small bold={x.id === r.id}>
                        {t(runName(x.startedAt))} · {new Date(x.startedAt).toLocaleDateString(lang === "de" ? "de-DE" : "en-GB", { day: "2-digit", month: "2-digit" })}{" "}
                        {hhmm(x.startedAt)}
                      </T>
                      <Spacer />
                      <Pill label={signedEur(profit, lang)} color={pnlColor(profit)} />
                    </Row>
                  </Pressable>
                );
              })}
            </Card>
          </>
        ) : null}
      </Screen>
      {party ? <Confetti /> : null}
    </View>
  );
}
