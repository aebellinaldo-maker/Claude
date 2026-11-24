import { useEffect, useState } from "react";
import { Platform, Switch, View } from "react-native";
import { Alert } from "../../lib/alert";
import * as Clipboard from "expo-clipboard";
import { ServerKeysCard } from "../../components/server-keys-card";
import { useApp } from "../../lib/app-context";
import type { BotSettings } from "../../lib/api";
import type { TKey } from "../../lib/i18n";
import { colors } from "../../lib/theme";
import { Button, Card, Chip, Field, H, Note, Row, Screen, Spacer, T } from "../../components/ui";

const RISK_FIELDS: (keyof BotSettings & TKey)[] = [
  "stopLossPct",
  "takeProfitPct",
  "takeProfitSellPct",
  "trailingStopPct",
  "maxPositions",
  "maxPositionPct",
  "maxDailyLossPct",
  "maxDrawdownPct",
  "maxHoldHours",
  "minLiquidityUsd",
  "minPairAgeHours",
  "scanIntervalMin",
  "paperBudgetEur",
];

export default function SettingsScreen() {
  const { t, prefs, setPrefs, api, hasServer, lang } = useApp();
  const [url, setUrl] = useState(prefs.serverUrl);
  const [token, setToken] = useState(prefs.apiToken);
  const [conn, setConn] = useState<"unknown" | "ok" | "fail">("unknown");
  const [connMsg, setConnMsg] = useState("");
  const [testing, setTesting] = useState(false);

  const [bot, setBot] = useState<BotSettings | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [models, setModels] = useState<{ id: string; label: string }[]>([]);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setUrl(prefs.serverUrl);
    setToken(prefs.apiToken);
  }, [prefs.serverUrl, prefs.apiToken]);

  const loadBotSettings = async () => {
    try {
      const r = await api.settings();
      setBot(r.settings);
      setModels(r.aiModels);
      setAiAvailable(r.aiAvailable);
      setDraft(Object.fromEntries(RISK_FIELDS.map((k) => [k, String(r.settings[k])])));
      setConn("ok");
    } catch (e) {
      setConn("fail");
      setConnMsg((e as Error).message);
    }
  };

  useEffect(() => {
    if (hasServer) void loadBotSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, hasServer]);

  const saveServer = async () => {
    setTesting(true);
    const clean = url.trim().replace(/\/+$/, "");
    await setPrefs({ serverUrl: clean, apiToken: token.trim() });
    setTesting(false);
    // loadBotSettings runs via the effect once `api` changes.
  };

  const setLang = async (l: "en" | "de") => {
    await setPrefs({ lang: l });
    if (hasServer) {
      try {
        // The AI writes its explanations in this language too.
        await api.saveSettings({ language: l });
      } catch {
        /* ignore */
      }
    }
  };

  const patchBot = async (patch: Partial<BotSettings>) => {
    try {
      const r = await api.saveSettings(patch);
      setBot(r.settings);
    } catch (e) {
      Alert.alert(t("error"), (e as Error).message);
    }
  };

  const saveRisk = async () => {
    const patch: Partial<BotSettings> = {};
    for (const k of RISK_FIELDS) {
      const v = Number((draft[k] ?? "").replace(",", "."));
      if (!Number.isFinite(v)) return Alert.alert(t("error"), `${t(k)}: ?`);
      (patch as Record<string, number>)[k] = v;
    }
    setSaving(true);
    try {
      const r = await api.saveSettings(patch);
      setBot(r.settings);
      Alert.alert(t("saved"));
    } catch (e) {
      Alert.alert(t("error"), (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen title={t("tabSettings")}>
      <H>{t("server")}</H>
      <Card>
        <T small dim>
          {t("serverHint")}
        </T>
        <Field label={t("serverUrl")} value={url} onChangeText={setUrl} placeholder="https://mybot.duckdns.org" keyboardType="url" />
        <Field label={t("apiToken")} value={token} onChangeText={setToken} secureTextEntry placeholder="••••••••" />
        <Button title={t("saveAndTest")} loading={testing} onPress={saveServer} disabled={!url.trim() || !token.trim()} />
        {hasServer ? (
          conn === "ok" ? (
            <Note kind="success">✓ {t("connected")}</Note>
          ) : conn === "fail" ? (
            <Note kind="error">
              {t("notConnected")}: {connMsg}
            </Note>
          ) : null
        ) : null}
      </Card>

      {Platform.OS === "web" && hasServer && conn === "ok" ? (
        <>
          <H>🔗 {t("privateLink")}</H>
          <Card>
            <T small dim>
              {t("privateLinkHint")}
            </T>
            <Button
              title={t("copyLink")}
              kind="secondary"
              onPress={async () => {
                await Clipboard.setStringAsync(`${prefs.serverUrl}/#token=${encodeURIComponent(prefs.apiToken)}`);
                Alert.alert(t("copied"));
              }}
            />
          </Card>
        </>
      ) : null}

      <H>{t("language")}</H>
      <Row>
        <Chip label="English" active={lang === "en"} onPress={() => void setLang("en")} />
        <Chip label="Deutsch" active={lang === "de"} onPress={() => void setLang("de")} />
      </Row>

      {bot ? (
        <>
          <H>🧠 {t("aiSettings")}</H>
          <Card>
            {!aiAvailable ? <Note>{t("aiOffNote")}</Note> : null}
            <Row>
              <T>{t("aiEnabled")}</T>
              <Spacer />
              <Switch value={bot.aiEnabled} onValueChange={(v) => void patchBot({ aiEnabled: v })} trackColor={{ true: colors.accent }} />
            </Row>
            <Row>
              <T>{t("webResearch")}</T>
              <Spacer />
              <Switch value={bot.webResearch} onValueChange={(v) => void patchBot({ webResearch: v })} trackColor={{ true: colors.accent }} />
            </Row>
            <T small dim>
              {t("aiModel")}
            </T>
            <View style={{ gap: 8 }}>
              {models.map((m) => (
                <Chip key={m.id} label={m.label} active={bot.aiModel === m.id} onPress={() => void patchBot({ aiModel: m.id })} />
              ))}
            </View>
            <T small dim>
              {t("aiEffort")}
            </T>
            <Row>
              {(["low", "medium", "high"] as const).map((e) => (
                <Chip key={e} label={t(`effort_${e}`)} active={bot.aiEffort === e} onPress={() => void patchBot({ aiEffort: e })} />
              ))}
            </Row>
            <Row>
              <View style={{ flex: 1 }}>
                <Field
                  label={t("aiDailyBudgetUsd")}
                  defaultValue={String(bot.aiDailyBudgetUsd)}
                  keyboardType="decimal-pad"
                  onEndEditing={(e) => void patchBot({ aiDailyBudgetUsd: Number(e.nativeEvent.text.replace(",", ".")) })}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label={t("aiIntervalMin")}
                  defaultValue={String(bot.aiIntervalMin)}
                  keyboardType="number-pad"
                  onEndEditing={(e) => void patchBot({ aiIntervalMin: Number(e.nativeEvent.text) })}
                />
              </View>
            </Row>
            <Row>
              <View style={{ flex: 1 }}>
                <Field
                  label={t("aiMinConfidence")}
                  defaultValue={String(bot.aiMinConfidence)}
                  keyboardType="decimal-pad"
                  onEndEditing={(e) => void patchBot({ aiMinConfidence: Number(e.nativeEvent.text.replace(",", ".")) })}
                />
              </View>
            </Row>
            <T small faint>
              {t("aiCostNote")}
            </T>
          </Card>

          <H>🛡️ {t("riskSettings")}</H>
          <Card>
            {RISK_FIELDS.map((k) => (
              <Row key={k}>
                <T style={{ flex: 1 }}>{t(k)}</T>
                <Field
                  value={draft[k] ?? ""}
                  onChangeText={(v) => setDraft((d) => ({ ...d, [k]: v }))}
                  keyboardType="decimal-pad"
                  style={{ width: 110, textAlign: "right", paddingVertical: 8 }}
                />
              </Row>
            ))}
            <Button title={t("save")} loading={saving} onPress={saveRisk} />
          </Card>
        </>
      ) : null}

      {hasServer && conn === "ok" ? (
        <>
          <H>🔑 {t("serverKeys")}</H>
          <ServerKeysCard />
        </>
      ) : null}

      <H>{t("about")}</H>
      <Card>
        <T small dim>
          {t("disclaimer")}
        </T>
      </Card>
    </Screen>
  );
}
