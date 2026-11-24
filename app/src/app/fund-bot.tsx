import { useState } from "react";
import { Alert, Linking, Pressable } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useApp } from "../lib/app-context";
import { useLoader } from "../lib/use-loader";
import { eur, num, shortAddr } from "../lib/format";
import { colors } from "../lib/theme";
import { signAndSubmit, solscanTx } from "../lib/tx";
import { isUserRejection } from "../lib/phantom";
import { Big, Button, Card, Chip, Field, Loading, Note, Pill, Row, Screen, Spacer, T } from "../components/ui";

export default function FundBotScreen() {
  const { t, lang, api, hasServer, wallet, connectWallet } = useApp();
  const status = useLoader(() => api.status(), [api], { enabled: hasServer });
  const botAddr = status.data?.wallets.bot;
  const botWallet = useLoader(() => api.wallet(botAddr!), [api, botAddr], { enabled: hasServer && !!botAddr, pollMs: 20_000 });
  const myWallet = useLoader(() => api.wallet(wallet!), [api, wallet], { enabled: hasServer && !!wallet });

  const [amount, setAmount] = useState("0.15");
  const [busy, setBusy] = useState<string | null>(null);
  const [lastSig, setLastSig] = useState<string | null>(null);

  const solEur = botWallet.data?.solPriceEur ?? myWallet.data?.solPriceEur;
  const amountNum = Number(amount.replace(",", "."));

  const send = async () => {
    if (!wallet || !(amountNum > 0)) return;
    setBusy("send");
    try {
      const { transaction } = await api.buildFundBot(wallet, amountNum);
      const sig = await signAndSubmit(api, transaction);
      setLastSig(sig);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // A deposit isn't profit: restart the P&L baseline once the SOL has arrived.
      setTimeout(() => {
        if (status.data?.mode === "real") void api.resetBaseline().catch(() => undefined);
        void botWallet.reload();
        void myWallet.reload();
      }, 4000);
    } catch (e) {
      if (!isUserRejection(e)) Alert.alert(t("error"), (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const withdraw = () =>
    Alert.alert(t("withdrawAll"), t("withdrawConfirm"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("confirm"),
        onPress: async () => {
          setBusy("withdraw");
          try {
            const r = await api.withdraw();
            setLastSig(r.signature);
            Alert.alert(t("withdrawn", { sol: num(r.sol, lang, 4) }));
            void botWallet.reload();
            void myWallet.reload();
          } catch (e) {
            Alert.alert(t("error"), (e as Error).message);
          } finally {
            setBusy(null);
          }
        },
      },
    ]);

  if (!hasServer) {
    return (
      <Screen>
        <Note kind="warn">{t("serverMissing")}</Note>
      </Screen>
    );
  }

  return (
    <Screen>
      <T dim>{t("fundIntro")}</T>

      <Card>
        <Row>
          <T dim>{t("botBalance")}</T>
          <Spacer />
          {botAddr ? (
            <Pressable
              onPress={async () => {
                await Clipboard.setStringAsync(botAddr);
                Alert.alert(t("copied"), botAddr);
              }}
            >
              <Pill label={`🤖 ${shortAddr(botAddr)}  ⧉`} color={colors.text} />
            </Pressable>
          ) : null}
        </Row>
        {botWallet.data ? (
          <>
            <Big>{num(botWallet.data.sol, lang, 4)} SOL</Big>
            <T small dim>
              ≈ {eur(botWallet.data.totalEur, lang)}
            </T>
          </>
        ) : (
          <Loading />
        )}
        {status.data?.mode === "paper" ? (
          <Note>
            🧪 {t("modePaper")}: {t("paperExplainer")}
          </Note>
        ) : null}
      </Card>

      {!wallet ? (
        <Button title={t("connectPhantom")} onPress={() => void connectWallet().catch((e: Error) => Alert.alert(t("error"), e.message))} />
      ) : (
        <Card>
          <T bold>{t("sendToBot")}</T>
          <T small dim>
            Phantom: {num(myWallet.data?.sol, lang, 4)} SOL
          </T>
          <Field label={t("fundAmount")} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
          <Row style={{ flexWrap: "wrap" }}>
            {["0.05", "0.15", "0.3", "0.5"].map((v) => (
              <Chip key={v} label={`${v} SOL`} active={amount === v} onPress={() => setAmount(v)} />
            ))}
          </Row>
          {solEur && amountNum > 0 ? (
            <T small dim>
              ≈ {eur(amountNum * solEur, lang)}
            </T>
          ) : null}
          <T small faint>
            {t("fundKeepFees")}
          </T>
          <Button title={`${t("send")} → ${t("confirmInPhantom")}`} loading={busy === "send"} onPress={send} disabled={!(amountNum > 0)} />
        </Card>
      )}

      <Button title={t("withdrawAll")} kind="secondary" loading={busy === "withdraw"} onPress={withdraw} />
      {status.data?.wallets.owner ? (
        <T small faint style={{ textAlign: "center" }}>
          → 👻 {shortAddr(status.data.wallets.owner)}
        </T>
      ) : null}

      {lastSig ? (
        <Note kind="success">
          {t("txSent")}{" "}
          <T small color={colors.accent} onPress={() => void Linking.openURL(solscanTx(lastSig))}>
            {t("viewOnSolscan")} ↗
          </T>
        </Note>
      ) : null}
    </Screen>
  );
}
