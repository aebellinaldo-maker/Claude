import { useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as WebBrowser from "expo-web-browser";
import { useApp } from "../lib/app-context";
import { useLoader } from "../lib/use-loader";
import type { OnrampProvider, PayMethod } from "../lib/api";
import { num } from "../lib/format";
import { Button, Card, Chip, Field, Loading, Note, Row, Screen, T } from "../components/ui";

export default function BuyScreen() {
  const { t, lang, api, hasServer, wallet, connectWallet } = useApp();
  const providers = useLoader(() => api.onrampProviders(), [api], { enabled: hasServer });
  const price = useLoader(() => api.wallet(wallet!), [api, wallet], { enabled: hasServer && !!wallet });

  const [amount, setAmount] = useState("25");
  const [coin, setCoin] = useState<"sol" | "usdc">("sol");
  const [method, setMethod] = useState<PayMethod>("card");
  const [providerId, setProviderId] = useState<OnrampProvider["id"] | null>(null);
  const [busy, setBusy] = useState(false);

  const list = providers.data?.providers ?? [];
  const provider = useMemo(() => list.find((p) => p.id === providerId) ?? list[0], [list, providerId]);

  useEffect(() => {
    if (provider && !provider.methods.includes(method)) setMethod(provider.methods[0]);
  }, [provider, method]);

  const amountNum = Number(amount.replace(",", "."));
  const solPrice = price.data?.solPriceEur;

  const go = async () => {
    if (!wallet || !provider) return;
    setBusy(true);
    try {
      const r = await api.onrampUrl({
        provider: provider.id,
        wallet,
        currency: coin,
        amountEur: amountNum > 0 ? amountNum : undefined,
        method,
      });
      if (!r.prefillsWallet) {
        await Clipboard.setStringAsync(wallet);
        await new Promise<void>((resolve) => Alert.alert(t("addressCopied"), t("pasteAddressHint"), [{ text: t("ok"), onPress: () => resolve() }]));
      }
      await WebBrowser.openBrowserAsync(r.url);
      void price.reload();
    } catch (e) {
      Alert.alert(t("error"), (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!hasServer) {
    return (
      <Screen>
        <Note kind="warn">{t("serverMissing")}</Note>
      </Screen>
    );
  }
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
      <T dim>{t("buyIntro")}</T>

      <Card>
        <Field label={t("amountEur")} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
        <Row style={{ flexWrap: "wrap" }}>
          {["20", "50", "100", "250"].map((v) => (
            <Chip key={v} label={`€${v}`} active={amount === v} onPress={() => setAmount(v)} />
          ))}
        </Row>
        {coin === "sol" && solPrice && amountNum > 0 ? (
          <T small dim>
            {t("approxSol", { sol: num(amountNum / solPrice, lang, 3) })}
          </T>
        ) : null}
      </Card>

      <Card>
        <T small dim>
          {t("receiveCoin")}
        </T>
        <Row>
          <Chip label="SOL" active={coin === "sol"} onPress={() => setCoin("sol")} />
          <Chip label="USDC" active={coin === "usdc"} onPress={() => setCoin("usdc")} />
        </Row>
        <T small dim style={{ marginTop: 6 }}>
          {t("payWith")}
        </T>
        <Row style={{ flexWrap: "wrap" }}>
          {(provider?.methods ?? ["card"]).map((m) => (
            <Chip key={m} label={t(`pay_${m}`)} active={method === m} onPress={() => setMethod(m)} />
          ))}
        </Row>
        {list.length > 1 ? (
          <>
            <T small dim style={{ marginTop: 6 }}>
              {t("provider")}
            </T>
            <Row style={{ flexWrap: "wrap" }}>
              {list.map((p) => (
                <Chip key={p.id} label={p.name} active={provider?.id === p.id} onPress={() => setProviderId(p.id)} />
              ))}
            </Row>
          </>
        ) : providers.loading ? (
          <Loading />
        ) : null}
      </Card>

      <Note kind="warn">{t("feeNote")}</Note>
      <Button title={`${t("continue")} →`} loading={busy} onPress={go} disabled={!provider} />
      <T small dim>
        {t("phantomBuyHint")}
      </T>
      <T small dim>
        {t("afterBuy")}
      </T>
    </Screen>
  );
}
