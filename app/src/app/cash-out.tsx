import { useEffect, useState } from "react";
import { Linking, View } from "react-native";
import * as Haptics from "expo-haptics";
import { Alert } from "../lib/alert";
import { useApp } from "../lib/app-context";
import { useLoader } from "../lib/use-loader";
import { eur, num } from "../lib/format";
import { colors } from "../lib/theme";
import { storage } from "../lib/storage";
import { signAndSubmit, solscanTx } from "../lib/tx";
import { isUserRejection } from "../lib/phantom";
import { Button, Card, Chip, Field, H, Note, Row, Screen, T } from "../components/ui";

const ADDRESS_KEY = "cashout_address_v1";
const isAddress = (a: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a.trim());

/**
 * Cash out to PayPal (Germany): Phantom → your Coinbase account → sell SOL for EUR →
 * withdraw to PayPal (or to your bank, then top up PayPal from the bank).
 */
export default function CashOutScreen() {
  const { t, lang, api, hasServer, wallet, connectWallet } = useApp();
  const myWallet = useLoader(() => api.wallet(wallet!), [api, wallet], { enabled: hasServer && !!wallet });
  const [address, setAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastSig, setLastSig] = useState<string | null>(null);

  useEffect(() => {
    void storage.get(ADDRESS_KEY).then((a) => a && setAddress(a));
  }, []);

  const sol = myWallet.data?.sol ?? 0;
  const solEur = myWallet.data?.solPriceEur ?? 0;
  // Keep a little SOL in Phantom for network fees.
  const maxSendable = Math.max(0, sol - 0.003);
  const amountNum = Number(amount.replace(",", "."));

  const send = async () => {
    if (!wallet) return;
    const to = address.trim();
    if (!isAddress(to)) return Alert.alert(t("error"), t("coAddressInvalid"));
    if (to === wallet) return Alert.alert(t("error"), t("coAddressSelf"));
    if (!(amountNum > 0) || amountNum > maxSendable) return Alert.alert(t("error"), t("coAmountInvalid"));
    Alert.alert(t("coConfirmTitle"), t("coConfirm", { sol: num(amountNum, lang, 4), eur: eur(amountNum * solEur, lang), to: `${to.slice(0, 6)}…${to.slice(-6)}` }), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("confirm"),
        onPress: async () => {
          setBusy(true);
          try {
            await storage.set(ADDRESS_KEY, to);
            const { transaction } = await api.buildTransfer(wallet, to, amountNum);
            const sig = await signAndSubmit(api, transaction);
            setLastSig(sig);
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setTimeout(() => void myWallet.reload(), 3000);
          } catch (e) {
            if (!isUserRejection(e)) Alert.alert(t("error"), (e as Error).message);
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  if (!wallet) {
    return (
      <Screen>
        <Note>{t("connectHint")}</Note>
        <Button title={t("connectPhantom")} onPress={() => void connectWallet().catch((e: Error) => Alert.alert(t("error"), e.message))} />
      </Screen>
    );
  }

  return (
    <Screen>
      <T dim>{t("coIntro")}</T>
      <Note kind="warn">{t("coRequirements")}</Note>

      <H>1 · {t("coStep1")}</H>
      <Card>
        <T small dim>
          {t("coStep1Text")}
        </T>
        <Button title={t("coOpenCoinbase")} kind="secondary" onPress={() => void Linking.openURL("https://www.coinbase.com/de/signup")} />
      </Card>

      <H>2 · {t("coStep2")}</H>
      <Card>
        <T small dim>
          {t("coStep2Text")}
        </T>
        <Field label={t("coAddress")} value={address} onChangeText={setAddress} placeholder="Coinbase SOL address" />
        <T small dim>
          {t("coYouHave", { sol: num(sol, lang, 4), eur: eur(sol * solEur, lang) })}
        </T>
        <Field label={t("amountSol")} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.1" />
        <Row style={{ flexWrap: "wrap" }}>
          {[0.25, 0.5, 1].map((f) => (
            <Chip key={f} label={f === 1 ? t("max") : `${f * 100}%`} onPress={() => setAmount((Math.floor(maxSendable * f * 1e4) / 1e4).toString())} />
          ))}
        </Row>
        {amountNum > 0 && solEur ? (
          <T small dim>
            ≈ {eur(amountNum * solEur, lang)}
          </T>
        ) : null}
        <Button
          title={`${t("send")} → ${t("confirmInPhantom")}`}
          loading={busy || (myWallet.loading && !myWallet.data)}
          onPress={send}
          disabled={!(amountNum > 0) || !myWallet.data}
        />
        {lastSig ? (
          <Note kind="success">
            {t("txSent")}{" "}
            <T small color={colors.accent} onPress={() => void Linking.openURL(solscanTx(lastSig))}>
              {t("viewOnSolscan")} ↗
            </T>
          </Note>
        ) : null}
      </Card>

      <H>3 · {t("coStep3")}</H>
      <Card>
        <View style={{ gap: 6 }}>
          <T small>{t("coStep3a")}</T>
          <T small>{t("coStep3b")}</T>
          <T small>{t("coStep3c")}</T>
        </View>
      </Card>

      <H>{t("coFallback")}</H>
      <Card>
        <T small dim>
          {t("coFallbackText")}
        </T>
      </Card>

      <T small faint style={{ textAlign: "center" }}>
        {t("coFromBot")}
      </T>
    </Screen>
  );
}
