import { useState } from "react";
import { Image, View } from "react-native";
import { Alert } from "../../lib/alert";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as Haptics from "expo-haptics";
import { useApp } from "../../lib/app-context";
import type { ChartRead } from "../../lib/api";
import type { TKey } from "../../lib/i18n";
import { colors, radius } from "../../lib/theme";
import { Button, Card, Field, H, Loading, Note, Pill, Row, Screen, Spacer, T } from "../../components/ui";

/** Claude reads images up to ~1568 px on the long edge; bigger only costs more. */
const MAX_EDGE = 1568;

const VERDICT_STYLE: Record<ChartRead["verdict"], { fg: string; bg: string; key: TKey }> = {
  buy: { fg: colors.green, bg: colors.greenDim, key: "verdict_buy" },
  sell: { fg: colors.red, bg: colors.redDim, key: "verdict_sell" },
  hold: { fg: colors.yellow, bg: colors.yellowDim, key: "verdict_hold" },
  avoid: { fg: colors.red, bg: colors.redDim, key: "verdict_avoid_short" },
};

export default function ChartAiScreen() {
  const { t, api, hasServer } = useApp();
  const [photo, setPhoto] = useState<{ uri: string; width: number; height: number } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ analysis: ChartRead; model: string } | null>(null);

  const pick = async (camera: boolean) => {
    if (camera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return Alert.alert(t("cameraDenied"));
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 1, allowsEditing: true };
    const res = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    setPhoto({ uri: a.uri, width: a.width, height: a.height });
    setResult(null);
  };

  const analyze = async () => {
    if (!photo) return;
    setBusy(true);
    try {
      // Shrink and compress the image before sending (faster upload, lower AI cost).
      const ctx = ImageManipulator.manipulate(photo.uri);
      const scale = Math.min(1, MAX_EDGE / Math.max(photo.width, photo.height));
      if (scale < 1) ctx.resize({ width: Math.round(photo.width * scale) });
      const img = await ctx.renderAsync();
      const saved = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
      if (!saved.base64) throw new Error("Could not read the image");
      const r = await api.analyzeChartImage(saved.base64, "image/jpeg", note.trim() || undefined);
      setResult(r);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert(t("error"), (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!hasServer) {
    return (
      <Screen title={t("chartAiTitle")}>
        <Note kind="warn">{t("serverMissing")}</Note>
        <Button title={t("goToSettings")} kind="secondary" onPress={() => router.navigate("/settings")} />
      </Screen>
    );
  }

  const a = result?.analysis;
  const v = a ? VERDICT_STYLE[a.verdict] : null;

  return (
    <Screen title={t("chartAiTitle")}>
      <T dim>{t("chartAiIntro")}</T>

      <Row>
        <Button title={`🖼️ ${t("pickScreenshot")}`} kind="secondary" onPress={() => void pick(false)} style={{ flex: 1 }} />
        <Button title={`📷 ${t("takePhoto")}`} kind="secondary" onPress={() => void pick(true)} style={{ flex: 1 }} />
      </Row>

      {photo ? (
        <Card style={{ padding: 8 }}>
          <Image
            source={{ uri: photo.uri }}
            style={{ width: "100%", aspectRatio: photo.width / photo.height, borderRadius: radius.md, maxHeight: 420 }}
            resizeMode="contain"
          />
        </Card>
      ) : null}

      {photo ? (
        <>
          <Field placeholder={t("chartNote")} value={note} onChangeText={setNote} />
          <Button title={busy ? t("analyzing") : `🧠 ${t("analyze")}`} loading={busy} onPress={analyze} />
        </>
      ) : null}

      {busy ? <Loading label={t("analyzing")} /> : null}

      {a && v ? (
        <>
          {!a.is_chart ? <Note kind="warn">{t("notAChart")}</Note> : null}
          <Card style={{ alignItems: "center", gap: 10, backgroundColor: v.bg, borderColor: v.fg }}>
            <T bold style={{ fontSize: 34, color: v.fg, letterSpacing: 1 }}>
              {t(v.key)}
            </T>
            <View style={{ width: "100%", gap: 4 }}>
              <Row>
                <T small dim>
                  {t("confidenceLabel")}
                </T>
                <Spacer />
                <T small bold>
                  {Math.round(a.confidence * 100)}%
                </T>
              </Row>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.card, overflow: "hidden" }}>
                <View style={{ width: `${Math.round(a.confidence * 100)}%`, height: 6, backgroundColor: v.fg }} />
              </View>
            </View>
          </Card>

          <Card>
            <T>{a.summary}</T>
            <Row style={{ flexWrap: "wrap" }}>
              <Pill
                label={`${t("trendLabel")}: ${a.trend}`}
                color={a.trend === "up" ? colors.green : a.trend === "down" ? colors.red : colors.textDim}
              />
              <Pill label={`${t("timeframeLabel")}: ${a.timeframe}`} />
              <Pill label={`${t("wyckoffLabel")}: ${a.wyckoff_phase}`} />
            </Row>
          </Card>

          {a.patterns.length ? (
            <>
              <H>{t("patternsLabel")}</H>
              <Card>
                {a.patterns.map((p) => (
                  <View key={p.name} style={{ gap: 2 }}>
                    <T bold small>
                      {p.name}
                    </T>
                    <T small dim>
                      {p.meaning}
                    </T>
                  </View>
                ))}
              </Card>
            </>
          ) : null}

          <Card>
            <Levels label={t("supportLabel")} items={a.support} color={colors.green} />
            <Levels label={t("resistanceLabel")} items={a.resistance} color={colors.red} />
            <T small dim>
              <T small bold>
                {t("volumeLabel")}:{" "}
              </T>
              {a.volume_read}
            </T>
            <T small dim>
              <T small bold>
                {t("momentumLabel")}:{" "}
              </T>
              {a.momentum_read}
            </T>
          </Card>

          <H>{t("planLabel")}</H>
          <Card>
            <PlanRow label={t("entryLabel")} text={a.entry_idea} color={colors.accent} />
            <PlanRow label={t("stopLabel")} text={a.stop_loss_idea} color={colors.red} />
            <PlanRow label={t("targetLabel")} text={a.take_profit_idea} color={colors.green} />
          </Card>

          {a.risks.length ? (
            <>
              <H>⚠️ {t("risksLabel")}</H>
              <Card>
                {a.risks.map((r) => (
                  <T key={r} small>
                    • {r}
                  </T>
                ))}
              </Card>
            </>
          ) : null}

          <T small faint style={{ textAlign: "center" }}>
            {t("analysedBy", { m: result!.model })}
          </T>
          <T small faint style={{ textAlign: "center" }}>
            {t("chartDisclaimer")}
          </T>
        </>
      ) : null}
    </Screen>
  );
}

function Levels({ label, items, color }: { label: string; items: string[]; color: string }) {
  if (!items.length) return null;
  return (
    <View style={{ gap: 4 }}>
      <T small dim>
        {label}
      </T>
      <Row style={{ flexWrap: "wrap" }}>
        {items.map((x) => (
          <Pill key={x} label={x} color={color} />
        ))}
      </Row>
    </View>
  );
}

function PlanRow({ label, text, color }: { label: string; text: string; color: string }) {
  return (
    <View style={{ gap: 2 }}>
      <T small bold color={color}>
        {label}
      </T>
      <T small>{text}</T>
    </View>
  );
}
