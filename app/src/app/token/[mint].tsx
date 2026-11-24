import { useState } from "react";
import { Linking, View } from "react-native";
import { Alert } from "../../lib/alert";
import { Stack, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { useApp } from "../../lib/app-context";
import { useLoader } from "../../lib/use-loader";
import { SOL_MINT, type Opinion, type QuoteSummary } from "../../lib/api";
import { compactUsd, eur, num, pct, toRaw, usdPrice } from "../../lib/format";
import { colors, pnlColor } from "../../lib/theme";
import { signAndSubmit, solscanTx } from "../../lib/tx";
import { isUserRejection } from "../../lib/phantom";
import { Big, Button, Card, Chip, Field, H, KV, Loading, Note, Pill, Row, Screen, Spacer, T, TokenAvatar } from "../../components/ui";
import { ChartCard } from "../../components/chart-card";

export default function TokenScreen() {
  const { mint } = useLocalSearchParams<{ mint: string }>();
  const { t, lang, api, wallet, hasServer } = useApp();
  const coin = useLoader(() => api.token(mint), [api, mint], { enabled: hasServer, pollMs: 30_000 });
  const walletInfo = useLoader(() => api.wallet(wallet!), [api, wallet], { enabled: hasServer && !!wallet });
  const c = coin.data?.coin;

  const [opinion, setOpinion] = useState<Opinion | null>(null);
  const [asking, setAsking] = useState(false);

  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("0.05");
  const [quote, setQuote] = useState<QuoteSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastSig, setLastSig] = useState<string | null>(null);

  const holding = walletInfo.data?.tokens.find((x) => x.mint === mint);
  const solBalance = walletInfo.data?.sol ?? 0;
  const isSol = mint === SOL_MINT;

  const ask = async () => {
    setAsking(true);
    try {
      setOpinion((await api.askAi(mint)).opinion);
    } catch (e) {
      Alert.alert(t("error"), (e as Error).message);
    } finally {
      setAsking(false);
    }
  };

  const swapParams = () => {
    if (side === "buy") {
      const raw = toRaw(amount, 9);
      return raw && raw !== "0" ? { input: SOL_MINT, output: mint, raw } : null;
    }
    if (!holding) return null;
    const raw = toRaw(amount, holding.decimals);
    return raw && raw !== "0" ? { input: mint, output: SOL_MINT, raw } : null;
  };

  const getQuote = async () => {
    const p = swapParams();
    if (!p) return;
    setBusy(true);
    try {
      setQuote((await api.quote(p.input, p.output, p.raw)).quote);
    } catch (e) {
      Alert.alert(t("error"), (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const execute = async () => {
    const p = swapParams();
    if (!p || !wallet) return;
    setBusy(true);
    try {
      const built = await api.buildSwap(wallet, p.input, p.output, p.raw);
      if (built.simulationError) throw new Error(built.simulationError.error ?? "Swap simulation failed");
      const sig = await signAndSubmit(api, built.transaction);
      setLastSig(sig);
      setQuote(null);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => void walletInfo.reload(), 2500);
    } catch (e) {
      if (!isUserRejection(e)) Alert.alert(t("error"), (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!c) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "" }} />
        {coin.error ? <Note kind="error">{coin.error}</Note> : <Loading />}
      </Screen>
    );
  }

  const quoteOut = quote ? Number(quote.outAmount) / 10 ** (quote.outDecimals ?? (side === "sell" ? 9 : 6)) : 0;
  const safetyLevel = c.safety?.level ?? "unknown";
  const safetyColor =
    safetyLevel === "good" ? colors.green : safetyLevel === "warn" ? colors.yellow : safetyLevel === "danger" ? colors.red : colors.textDim;

  return (
    <Screen refreshing={coin.refreshing} onRefresh={coin.reload}>
      <Stack.Screen options={{ title: c.symbol }} />

      <Card>
        <Row gap={12}>
          <TokenAvatar uri={c.imageUrl} symbol={c.symbol} size={48} />
          <View style={{ flex: 1 }}>
            <T bold style={{ fontSize: 20 }} numberOfLines={1}>
              {c.name}
            </T>
            <T dim small numberOfLines={1} selectable>
              {mint}
            </T>
          </View>
        </Row>
        <Row style={{ alignItems: "flex-end" }}>
          <Big>{usdPrice(c.priceUsd, lang)}</Big>
          <Spacer />
          <T bold color={pnlColor(c.priceChange.h24)} style={{ marginBottom: 8 }}>
            {pct(c.priceChange.h24)} 24h
          </T>
        </Row>
        <Row style={{ flexWrap: "wrap" }}>
          <Pill label={`5m ${pct(c.priceChange.m5)}`} color={pnlColor(c.priceChange.m5)} />
          <Pill label={`1h ${pct(c.priceChange.h1)}`} color={pnlColor(c.priceChange.h1)} />
          <Pill label={`6h ${pct(c.priceChange.h6)}`} color={pnlColor(c.priceChange.h6)} />
          {c.boostAmount > 0 ? <Pill label={`⚡ ${t("boosted")}`} color={colors.yellow} bg={colors.yellowDim} /> : null}
        </Row>
      </Card>

      {!isSol ? <ChartCard mint={mint} /> : null}

      <Card>
        <KV k={t("mcap")} v={compactUsd(c.marketCapUsd, lang)} />
        <KV k={t("liquidity")} v={compactUsd(c.liquidityUsd, lang)} />
        <KV k={t("volume24h")} v={compactUsd(c.volume.h24, lang)} />
        <KV k={t("age")} v={c.ageHours >= 48 ? `${Math.round(c.ageHours / 24)} ${t("days")}` : `${Math.round(c.ageHours)} ${t("hours")}`} />
        <KV k={t("buysSells1h")} v={`${c.txns.h1.buys} / ${c.txns.h1.sells}`} />
        <Button title={t("openDexScreener")} kind="ghost" small onPress={() => void Linking.openURL(c.url)} />
      </Card>

      <H>{t("safetyCheck")}</H>
      <Card>
        <Row>
          <T bold color={safetyColor}>
            {t(`safety_${safetyLevel}` as "safety_good")}
          </T>
          <Spacer />
          {c.safety?.rugScore !== undefined ? <Pill label={`${t("rugScore")} ${c.safety.rugScore}/100`} /> : null}
        </Row>
        {c.safety?.risks.map((r) => (
          <T key={r.name} small color={r.level === "danger" ? colors.red : r.level === "warn" ? colors.yellow : colors.textDim}>
            • {r.name}: {r.description}
          </T>
        ))}
        {c.filterReasons?.length ? (
          <>
            <T small dim style={{ marginTop: 6 }}>
              {t("whyFiltered")}:
            </T>
            {c.filterReasons.map((r) => (
              <T key={r} small color={colors.red}>
                • {r}
              </T>
            ))}
          </>
        ) : !isSol ? (
          <T small color={colors.green}>
            ✓ {t("passesFilters")}
          </T>
        ) : null}
      </Card>

      {!isSol ? (
        <Card>
          <Row>
            <T bold>🧠 {t("askAi")}</T>
            <Spacer />
            <Button title={t("askAi")} small kind="secondary" loading={asking} onPress={ask} />
          </Row>
          {!opinion ? (
            <T small faint>
              {t("askAiHint")}
            </T>
          ) : (
            <>
              <Row>
                <Pill
                  label={t(`verdict_${opinion.verdict}` as "verdict_bullish")}
                  color={opinion.verdict === "bullish" ? colors.green : opinion.verdict === "neutral" ? colors.text : colors.red}
                />
                <Pill label={t(`risk_${opinion.risk}` as "risk_low")} color={opinion.risk === "low" ? colors.green : opinion.risk === "medium" ? colors.yellow : colors.red} />
              </Row>
              <T>{opinion.summary}</T>
              {opinion.points.map((p) => (
                <T key={p} small dim>
                  • {p}
                </T>
              ))}
            </>
          )}
        </Card>
      ) : null}

      {wallet && !isSol ? (
        <Card>
          <Row>
            <Chip label={t("buyWithSol")} active={side === "buy"} onPress={() => (setSide("buy"), setQuote(null), setAmount("0.05"))} />
            <Chip
              label={t("sellToSol")}
              active={side === "sell"}
              onPress={() => (setSide("sell"), setQuote(null), setAmount(holding ? String(holding.amount) : "0"))}
            />
          </Row>
          {side === "buy" ? (
            <T small dim>
              SOL: {num(solBalance, lang, 4)}
            </T>
          ) : (
            <T small dim>
              {t("youHold")}: {holding ? `${num(holding.amount, lang, 4)} ${c.symbol} (${eur(holding.valueEur, lang)})` : "0"}
            </T>
          )}
          <Field
            label={side === "buy" ? t("amountSol") : `${t("amountTokens")} (${c.symbol})`}
            value={amount}
            onChangeText={(v) => (setAmount(v), setQuote(null))}
            keyboardType="decimal-pad"
          />
          <Row style={{ flexWrap: "wrap" }}>
            {side === "buy"
              ? ["0.02", "0.05", "0.1", "0.25"].map((v) => <Chip key={v} label={`${v} SOL`} active={amount === v} onPress={() => (setAmount(v), setQuote(null))} />)
              : holding
                ? [25, 50, 100].map((p) => (
                    <Chip
                      key={p}
                      label={`${p}%`}
                      onPress={() => {
                        const raw = (BigInt(holding.raw) * BigInt(p)) / 100n;
                        setAmount((Number(raw) / 10 ** holding.decimals).toString());
                        setQuote(null);
                      }}
                    />
                  ))
                : null}
          </Row>
          {quote ? (
            <View style={{ gap: 4 }}>
              <KV
                k={t("youGet")}
                v={side === "buy" ? `${num(quoteOut, lang, 2)} ${c.symbol}` : `${num(quoteOut, lang, 5)} SOL`}
              />
              <KV
                k={t("priceImpact")}
                v={`${quote.priceImpactPct.toFixed(2)}%`}
                vColor={quote.priceImpactPct > 2 ? colors.red : undefined}
              />
              <T small faint>
                {quote.route}
              </T>
              <Button title={t("confirmInPhantom")} loading={busy} onPress={execute} />
            </View>
          ) : (
            <Button title={t("getQuote")} kind="secondary" loading={busy} onPress={getQuote} disabled={!swapParams()} />
          )}
          {lastSig ? (
            <Note kind="success">
              {t("txSent")}{" "}
              <T color={colors.accent} small onPress={() => void Linking.openURL(solscanTx(lastSig))}>
                {t("viewOnSolscan")} ↗
              </T>
            </Note>
          ) : null}
        </Card>
      ) : null}

      <T faint small style={{ textAlign: "center" }}>
        {t("riskWarning")}
      </T>
    </Screen>
  );
}
