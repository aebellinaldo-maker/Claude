import { useEffect, useState } from "react";
import * as Clipboard from "expo-clipboard";
import { Alert } from "../lib/alert";
import { useApp } from "../lib/app-context";
import { Button, Card, H, Note, T } from "./ui";

/**
 * On hosts that wipe files on restart (Hugging Face), the bot wallet must be saved as
 * the BOT_WALLET_SECRET secret before it may hold money. This card walks through it.
 */
export function WalletBackupCard() {
  const { t, api } = useApp();
  const [needed, setNeeded] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);

  useEffect(() => {
    api
      .walletBackup()
      .then((r) => setNeeded(r.needed))
      .catch(() => setNeeded(false));
  }, [api]);

  if (!needed) return null;

  const reveal = () =>
    Alert.alert(t("backupRevealTitle"), t("backupRevealWarn"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("confirm"),
        onPress: async () => {
          try {
            const r = await api.revealWalletBackup();
            setSecret(r.value);
            await Clipboard.setStringAsync(r.value).catch(() => undefined);
          } catch (e) {
            Alert.alert(t("error"), (e as Error).message);
          }
        },
      },
    ]);

  return (
    <>
      <H>🔐 {t("backupTitle")}</H>
      <Card>
        <Note kind="warn">{t("backupIntro")}</Note>
        {!secret ? (
          <Button title={t("backupReveal")} kind="secondary" onPress={reveal} />
        ) : (
          <>
            <T small bold>
              BOT_WALLET_SECRET
            </T>
            <T small selectable style={{ fontFamily: "monospace" }}>
              {secret}
            </T>
            <Note kind="success">{t("backupCopied")}</Note>
          </>
        )}
      </Card>
    </>
  );
}
