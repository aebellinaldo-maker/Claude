import { View } from "react-native";
import { useApp } from "../lib/app-context";
import type { TradeStats } from "../lib/api";
import type { TKey } from "../lib/i18n";
import { eur, timeAgo } from "../lib/format";
import { colors, pnlColor } from "../lib/theme";
import { Card, Divider, Note, Row, Spacer, T } from "./ui";

const MIN_TRADES = 30;

/** Track record: is the bot actually good, or just lucky so far? */
export function StatsCard({ stats }: { stats: TradeStats }) {
  const { t, lang } = useApp();
  const s = stats;
  if (!s.closed) {
    return (
      <Card>
        <T small dim>
          {t("statsEmpty")}
        </T>
      </Card>
    );
  }
  const pct = (x: number | null) => (x === null ? "–" : `${x > 0 ? "+" : ""}${x.toFixed(1)}%`);
  const Line = ({ label, value, color }: { label: string; value: string; color?: string }) => (
    <Row>
      <T small dim>
        {label}
      </T>
      <Spacer />
      <T small bold color={color}>
        {value}
      </T>
    </Row>
  );
  const verdict = {
    too_early: <Note>{t("verdictEarly", { n: s.closed, min: MIN_TRADES })}</Note>,
    good: <Note kind="success">{t("verdictGood")}</Note>,
    breakeven: <Note kind="warn">{t("verdictEven")}</Note>,
    losing: <Note kind="error">{t("verdictLosing")}</Note>,
  }[s.verdict];

  return (
    <Card>
      <Line label={t("statTrades")} value={`${s.closed}${s.open ? ` (+${s.open} ${t("statOpen")})` : ""}`} />
      <Line label={t("statWinRate")} value={s.winRate === null ? "–" : `${Math.round(s.winRate * 100)}%`} />
      <Line label={t("statAvgWin")} value={pct(s.avgWinPct)} color={colors.green} />
      <Line label={t("statAvgLoss")} value={pct(s.avgLossPct)} color={colors.red} />
      <Line
        label={t("statProfitFactor")}
        value={s.profitFactor === null ? "–" : s.profitFactor >= 99 ? "∞" : s.profitFactor.toFixed(2)}
        color={s.profitFactor === null ? undefined : s.profitFactor >= 1 ? colors.green : colors.red}
      />
      <Line label={t("statRealized")} value={`${s.realizedEur >= 0 ? "+" : ""}${eur(s.realizedEur, lang)}`} color={pnlColor(s.realizedEur)} />
      {s.best && s.worst ? (
        <Line label={t("statBestWorst")} value={`${s.best.symbol} ${pct(s.best.pnlPct)} · ${s.worst.symbol} ${pct(s.worst.pnlPct)}`} />
      ) : null}
      <T small faint>
        {t("statPfHint")}
      </T>
      {verdict}
      <Divider />
      <T small bold>
        {t("statRecent")}
      </T>
      {s.recent.map((r) => (
        <View key={`${r.mint}-${r.closedAt}`} style={{ gap: 1 }}>
          <Row>
            <T small bold>
              {r.symbol}
            </T>
            <T small faint>
              {" "}
              · {r.exitTriggers.map((x) => t(`trigger_${x}` as TKey)).join(" + ")} · {timeAgo(r.closedAt, lang)}
            </T>
            <Spacer />
            <T small bold color={pnlColor(r.pnlPct)}>
              {pct(r.pnlPct)}
            </T>
          </Row>
          <T small faint numberOfLines={2}>
            {r.why}
          </T>
        </View>
      ))}
    </Card>
  );
}
