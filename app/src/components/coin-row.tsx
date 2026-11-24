import { Pressable, View } from "react-native";
import { router } from "expo-router";
import type { Candidate } from "../lib/api";
import { useApp } from "../lib/app-context";
import { compactUsd, pct, usdPrice } from "../lib/format";
import { colors, pnlColor } from "../lib/theme";
import { Pill, Row, T, TokenAvatar } from "./ui";

export function CoinRow({ c }: { c: Candidate }) {
  const { lang } = useApp();
  const filtered = (c.filterReasons?.length ?? 0) > 0;
  const safety = c.safety?.level;
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/token/[mint]", params: { mint: c.mint } })}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingVertical: 10 })}
    >
      <Row gap={12}>
        <TokenAvatar uri={c.imageUrl} symbol={c.symbol} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Row gap={6}>
            <T bold numberOfLines={1} style={{ flexShrink: 1 }}>
              {c.symbol}
            </T>
            {c.trendingRank ? <Pill label={`#${c.trendingRank}`} color={colors.accent} bg={colors.accentDim} /> : null}
            {c.boostAmount > 0 ? <Pill label="⚡" color={colors.yellow} bg={colors.yellowDim} /> : null}
          </Row>
          <T small dim numberOfLines={1}>
            MC {compactUsd(c.marketCapUsd, lang)} · Liq {compactUsd(c.liquidityUsd, lang)}
          </T>
        </View>
        <View style={{ alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
          <T bold>{usdPrice(c.priceUsd, lang)}</T>
          <Row gap={6}>
            {safety === "danger" || filtered ? (
              <T small color={colors.red}>
                ⛔
              </T>
            ) : safety === "good" ? (
              <T small color={colors.green}>
                ✓
              </T>
            ) : null}
            <T small color={pnlColor(c.priceChange.h24)}>
              {pct(c.priceChange.h24)}
            </T>
          </Row>
        </View>
      </Row>
    </Pressable>
  );
}
