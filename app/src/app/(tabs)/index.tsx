import { Pressable, View } from "react-native";
import { Alert } from "../../lib/alert";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { useApp } from "../../lib/app-context";
import { useLoader } from "../../lib/use-loader";
import { eur, num, pct, shortAddr } from "../../lib/format";
import { colors, pnlColor } from "../../lib/theme";
import { SOL_MINT } from "../../lib/api";
import { Big, Button, Card, Divider, H, Loading, Note, Pill, Row, Screen, Spacer, T, TokenAvatar } from "../../components/ui";

export default function WalletScreen() {
  const { t, lang, api, hasServer, wallet, connectWallet, disconnectWallet } = useApp();
  const { data, error, loading, refreshing, reload } = useLoader(() => api.wallet(wallet!), [api, wallet], {
    pollMs: 30_000,
    enabled: hasServer && !!wallet,
  });

  const connect = async () => {
    try {
      await connectWallet();
    } catch (e) {
      Alert.alert(t("error"), (e as Error).message);
    }
  };

  const copy = async () => {
    if (!wallet) return;
    await Clipboard.setStringAsync(wallet);
    Alert.alert(t("addressCopied"), wallet);
  };

  return (
    <Screen title={t("tabWallet")} refreshing={refreshing} onRefresh={wallet && hasServer ? reload : undefined}>
      {!hasServer ? (
        <Card>
          <Note kind="warn">{t("serverMissing")}</Note>
          <Button title={t("goToSettings")} kind="secondary" onPress={() => router.navigate("/settings")} />
        </Card>
      ) : null}

      {!wallet ? (
        <Card style={{ paddingVertical: 28, gap: 14 }}>
          <T style={{ fontSize: 44, textAlign: "center" }}>👻</T>
          <T bold style={{ fontSize: 22, textAlign: "center" }}>
            Crypto Pilot
          </T>
          <T dim style={{ textAlign: "center" }}>
            {t("connectHint")}
          </T>
          <Button title={t("connectPhantom")} onPress={connect} />
        </Card>
      ) : (
        <>
          <Card>
            <Row>
              <T dim>{t("totalBalance")}</T>
              <Spacer />
              <Pressable onPress={copy}>
                <Pill label={`👻 ${shortAddr(wallet)}  ⧉`} color={colors.text} />
              </Pressable>
            </Row>
            {loading && !data ? <Loading /> : <Big>{eur(data?.totalEur, lang)}</Big>}
            {data ? (
              <T dim small>
                {num(data.sol, lang, 4)} SOL · 1 SOL = {eur(data.solPriceEur, lang)}
              </T>
            ) : null}
            <Row style={{ marginTop: 8 }}>
              <Button title={t("buyCrypto")} onPress={() => router.push("/buy")} style={{ flex: 1 }} />
              <Button title={t("fundBot")} kind="secondary" onPress={() => router.push("/fund-bot")} style={{ flex: 1 }} />
            </Row>
            <Button title={`💸 ${t("cashOut")}`} kind="secondary" onPress={() => router.push("/cash-out")} />
          </Card>

          {error ? <Note kind="error">{error}</Note> : null}

          <H>{t("holdings")}</H>
          <Card style={{ paddingVertical: 6 }}>
            {data ? (
              <>
                <Pressable
                  onPress={() => router.push({ pathname: "/token/[mint]", params: { mint: SOL_MINT } })}
                  style={{ paddingVertical: 10 }}
                >
                  <Row gap={12}>
                    <TokenAvatar symbol="SOL" />
                    <View style={{ flex: 1 }}>
                      <T bold>Solana</T>
                      <T small dim>
                        {num(data.sol, lang, 4)} SOL
                      </T>
                    </View>
                    <T bold>{eur(data.solEur, lang)}</T>
                  </Row>
                </Pressable>
                {data.tokens.map((tok) => (
                  <View key={tok.mint}>
                    <Divider />
                    <Pressable
                      onPress={() => router.push({ pathname: "/token/[mint]", params: { mint: tok.mint } })}
                      style={{ paddingVertical: 10 }}
                    >
                      <Row gap={12}>
                        <TokenAvatar uri={tok.imageUrl} symbol={tok.symbol} />
                        <View style={{ flex: 1 }}>
                          <T bold numberOfLines={1}>
                            {tok.symbol}
                          </T>
                          <T small dim numberOfLines={1}>
                            {num(tok.amount, lang, 2)} {tok.symbol}
                          </T>
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          <T bold>{eur(tok.valueEur, lang)}</T>
                          {tok.change24h !== null ? (
                            <T small color={pnlColor(tok.change24h)}>
                              {pct(tok.change24h)}
                            </T>
                          ) : null}
                        </View>
                      </Row>
                    </Pressable>
                  </View>
                ))}
                {data.sol === 0 && data.tokens.length === 0 ? (
                  <T dim style={{ paddingVertical: 10 }}>
                    {t("noHoldings")}
                  </T>
                ) : null}
              </>
            ) : loading ? (
              <Loading />
            ) : null}
          </Card>

          <Button title={t("disconnect")} kind="ghost" onPress={() => void disconnectWallet()} />
        </>
      )}

      <T faint small style={{ textAlign: "center" }}>
        {t("riskWarning")}
      </T>
    </Screen>
  );
}
