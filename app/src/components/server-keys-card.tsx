import { useEffect, useState } from "react";
import { View } from "react-native";
import { Alert } from "../lib/alert";
import { useApp } from "../lib/app-context";
import type { TKey } from "../lib/i18n";
import { colors } from "../lib/theme";
import { Button, Card, Field, Note, Row, Spacer, T } from "./ui";

/** Fields shown in the app; secrets are write-only (the server only says whether they're set). */
const FIELDS: { name: string; label: TKey; secret: boolean; placeholder?: string }[] = [
  { name: "ANTHROPIC_API_KEY", label: "key_anthropic", secret: true, placeholder: "sk-ant-…" },
  { name: "OPENROUTER_API_KEY", label: "key_openrouter", secret: true, placeholder: "sk-or-…" },
  { name: "OPENROUTER_MODELS", label: "key_openrouter_models", secret: false, placeholder: "model-id:free" },
  { name: "XAI_API_KEY", label: "key_xai", secret: true, placeholder: "xai-…" },
  { name: "XAI_MODELS", label: "key_xai_models", secret: false, placeholder: "grok-…" },
  { name: "OLLAMA_MODELS", label: "key_ollama_models", secret: false, placeholder: "model:tag" },
  { name: "RPC_URL", label: "key_rpc", secret: true, placeholder: "https://mainnet.helius-rpc.com/?api-key=…" },
  { name: "MOONPAY_PUBLISHABLE_KEY", label: "key_moonpay_pk", secret: false, placeholder: "pk_live_…" },
  { name: "MOONPAY_SECRET_KEY", label: "key_moonpay_sk", secret: true, placeholder: "sk_live_…" },
];

export function ServerKeysCard() {
  const { t, api } = useApp();
  const [keys, setKeys] = useState<Record<string, { set: boolean; value?: string }> | null>(null);
  const [canRestart, setCanRestart] = useState(false);
  const [hostSecrets, setHostSecrets] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await api.getKeys();
      setKeys(r.keys);
      setCanRestart(r.canRestart);
      setHostSecrets(r.hostSecrets);
      setDraft(Object.fromEntries(FIELDS.filter((f) => !f.secret).map((f) => [f.name, r.keys[f.name]?.value ?? ""])));
    } catch {
      setKeys(null);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  if (!keys) return null;
  if (hostSecrets) {
    return (
      <Card>
        <T small dim>
          {t("keysHostSecrets")}
        </T>
        {FIELDS.map((f) => (
          <T key={f.name} small color={keys[f.name]?.set ? colors.green : colors.textFaint}>
            {keys[f.name]?.set ? "✓" : "○"} {f.name}
          </T>
        ))}
      </Card>
    );
  }

  const save = async () => {
    const patch: Record<string, string> = {};
    for (const f of FIELDS) {
      const v = (draft[f.name] ?? "").trim();
      if (f.secret ? v !== "" : v !== (keys[f.name]?.value ?? "")) patch[f.name] = v;
    }
    if (!Object.keys(patch).length) return;
    setSaving(true);
    try {
      const r = await api.saveKeys(patch);
      setNote(r.restarting ? t("keysRestarting") : t("keysSavedRestart"));
      setDraft((d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, FIELDS.find((f) => f.name === k)?.secret ? "" : v])));
      setTimeout(() => void load(), r.restarting ? 9000 : 500);
    } catch (e) {
      Alert.alert(t("error"), (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <T small dim>
        {t("keysIntro")}
      </T>
      {FIELDS.map((f) => (
        <View key={f.name} style={{ gap: 4 }}>
          <Row>
            <T small>{t(f.label)}</T>
            <Spacer />
            {f.secret ? (
              <T small color={keys[f.name]?.set ? colors.green : colors.textFaint}>
                {keys[f.name]?.set ? `✓ ${t("keySet")}` : t("keyNotSet")}
              </T>
            ) : null}
          </Row>
          <Field
            value={draft[f.name] ?? ""}
            onChangeText={(v) => setDraft((d) => ({ ...d, [f.name]: v }))}
            placeholder={f.secret && keys[f.name]?.set ? t("keyKeep") : f.placeholder}
            secureTextEntry={f.secret}
            style={{ paddingVertical: 9, fontSize: 14 }}
          />
        </View>
      ))}
      {!canRestart ? <T small faint>{t("keysManualRestart")}</T> : null}
      <Button title={t("save")} loading={saving} onPress={save} />
      {note ? <Note kind="success">{note}</Note> : null}
    </Card>
  );
}
