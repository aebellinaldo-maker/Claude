import { useEffect, useState } from "react";
import { Switch, View } from "react-native";
import { Alert } from "../lib/alert";
import { useApp } from "../lib/app-context";
import type { BotSettings } from "../lib/api";
import { eur } from "../lib/format";
import { colors } from "../lib/theme";
import { Button, Card, Divider, Field, Row, Spacer, T } from "./ui";

/** How much money the bot may use (paper or real) and when it should stop ("close"). */
export function BudgetCard({ mode, running, onChanged }: { mode: "paper" | "real"; running: boolean; onChanged: () => void }) {
  const { t, lang, api } = useApp();
  const [s, setS] = useState<BotSettings | null>(null);
  const [paper, setPaper] = useState("");
  const [real, setReal] = useState("");
  const [profit, setProfit] = useState("");
  const [loss, setLoss] = useState("");
  const [hours, setHours] = useState("");
  const [close, setClose] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const r = await api.settings();
    const x = r.settings;
    setS(x);
    setPaper(String(x.paperBudgetEur));
    setReal(x.realBudgetEur > 0 ? String(x.realBudgetEur) : "");
    setProfit(x.stopAtProfitPct > 0 ? String(x.stopAtProfitPct) : "");
    setLoss(x.stopAtLossPct > 0 ? String(x.stopAtLossPct) : "");
    setHours("");
    setClose(x.closeOnStop);
  };

  useEffect(() => {
    void load().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  if (!s) return null;
  const n = (v: string) => {
    const x = Number(v.replace(",", ".").trim());
    return Number.isFinite(x) && x > 0 ? x : 0;
  };

  const restartPaper = () => {
    const amount = n(paper);
    if (!(amount >= 1)) return Alert.alert(t("error"), t("budgetInvalid"));
    if (running) return Alert.alert(t("stopFirst"));
    Alert.alert(t("resetPaper"), t("resetPaperConfirm", { eur: eur(amount, lang) }), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("confirm"),
        onPress: async () => {
          setBusy(true);
          try {
            await api.resetPaper(amount);
            await load();
            onChanged();
          } catch (e) {
            Alert.alert(t("error"), (e as Error).message);
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const save = async () => {
    setBusy(true);
    try {
      const h = n(hours);
      await api.saveSettings({
        realBudgetEur: n(real),
        stopAtProfitPct: n(profit),
        stopAtLossPct: Math.min(100, n(loss)),
        closeOnStop: close,
        // Empty "hours" keeps an existing end time; 0 isn't possible (n() returns 0 for empty).
        ...(h > 0 ? { stopAt: Date.now() + h * 3_600_000 } : {}),
      });
      await load();
      onChanged();
      Alert.alert(t("saved"));
    } catch (e) {
      Alert.alert(t("error"), (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const clearEndTime = async () => {
    await api.saveSettings({ stopAt: 0 });
    await load();
  };

  const endTime = s.stopAt > Date.now() ? new Date(s.stopAt) : null;

  return (
    <Card>
      {mode === "paper" ? (
        <>
          <T bold>💶 {t("paperAmount")}</T>
          <T small dim>
            {t("paperAmountHint")}
          </T>
          <Row>
            <View style={{ flex: 1 }}>
              <Field value={paper} onChangeText={setPaper} keyboardType="decimal-pad" placeholder="10" />
            </View>
            <Button title={t("restartWithAmount")} kind="secondary" small loading={busy} onPress={restartPaper} />
          </Row>
        </>
      ) : (
        <>
          <T bold>💶 {t("realBudget")}</T>
          <T small dim>
            {t("realBudgetHint")}
          </T>
          <Field value={real} onChangeText={setReal} keyboardType="decimal-pad" placeholder={t("realBudgetAll")} />
        </>
      )}

      <Divider />
      <T bold>⏹️ {t("autoStop")}</T>
      <T small dim>
        {t("autoStopHint")}
      </T>
      <Row>
        <View style={{ flex: 1 }}>
          <Field label={t("stopAtProfit")} value={profit} onChangeText={setProfit} keyboardType="decimal-pad" placeholder={t("off")} />
        </View>
        <View style={{ flex: 1 }}>
          <Field label={t("stopAtLoss")} value={loss} onChangeText={setLoss} keyboardType="decimal-pad" placeholder={t("off")} />
        </View>
      </Row>
      <Field label={t("stopAfterHours")} value={hours} onChangeText={setHours} keyboardType="decimal-pad" placeholder={endTime ? "" : t("off")} />
      {endTime ? (
        <Row>
          <T small color={colors.accent}>
            {t("stopsAt", { time: endTime.toLocaleString(lang === "de" ? "de-DE" : "en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" }) })}
          </T>
          <Spacer />
          <Button title={t("remove")} kind="ghost" small onPress={() => void clearEndTime()} />
        </Row>
      ) : null}
      <Row>
        <T small style={{ flex: 1 }}>
          {t("closeOnStop")}
        </T>
        <Switch value={close} onValueChange={setClose} trackColor={{ true: colors.accent }} />
      </Row>
      <Button title={t("save")} loading={busy} onPress={save} />
    </Card>
  );
}
