import React from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, space } from "../lib/theme";

export function Screen({
  children,
  refreshing,
  onRefresh,
  title,
}: {
  children: React.ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Tab screens have no navigation header: pass a title to draw one below the status bar. */
  title?: string;
}) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{
        padding: space.lg,
        paddingTop: title ? insets.top + space.md : space.lg,
        paddingBottom: insets.bottom + 110,
        gap: space.md,
      }}
      contentInsetAdjustmentBehavior={title ? "never" : "automatic"}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.textDim} /> : undefined}
    >
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {children}
    </ScrollView>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function H({ children, style }: { children: React.ReactNode; style?: object }) {
  return <Text style={[styles.h, style]}>{children}</Text>;
}

export function T({
  children,
  dim,
  faint,
  small,
  bold,
  color,
  style,
  numberOfLines,
  selectable,
  onPress,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  dim?: boolean;
  faint?: boolean;
  small?: boolean;
  bold?: boolean;
  color?: string;
  style?: object;
  numberOfLines?: number;
  selectable?: boolean;
}) {
  return (
    <Text
      numberOfLines={numberOfLines}
      selectable={selectable}
      onPress={onPress}
      style={[
        styles.t,
        dim && { color: colors.textDim },
        faint && { color: colors.textFaint },
        small && { fontSize: 13 },
        bold && { fontWeight: "600" },
        color ? { color } : null,
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function Big({ children, color }: { children: React.ReactNode; color?: string }) {
  return <Text style={[styles.big, color ? { color } : null]}>{children}</Text>;
}

export function Row({ children, style, gap = space.sm }: { children: React.ReactNode; style?: ViewStyle; gap?: number }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap }, style]}>{children}</View>;
}

export function Spacer() {
  return <View style={{ flex: 1 }} />;
}

type BtnKind = "primary" | "secondary" | "danger" | "ghost" | "success";

export function Button({
  title,
  onPress,
  kind = "primary",
  disabled,
  loading,
  small,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: BtnKind;
  disabled?: boolean;
  loading?: boolean;
  small?: boolean;
  style?: ViewStyle;
}) {
  const bg: Record<BtnKind, string> = {
    primary: colors.accent,
    secondary: colors.cardAlt,
    danger: colors.redDim,
    ghost: "transparent",
    success: colors.greenDim,
  };
  const fg: Record<BtnKind, string> = {
    primary: "#120B2E",
    secondary: colors.text,
    danger: colors.red,
    ghost: colors.accent,
    success: colors.green,
  };
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [
        styles.btn,
        small && styles.btnSmall,
        { backgroundColor: bg[kind], opacity: disabled ? 0.4 : pressed ? 0.75 : 1 },
        kind === "secondary" && { borderWidth: 1, borderColor: colors.border },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg[kind]} /> : <Text style={[styles.btnText, small && { fontSize: 14 }, { color: fg[kind] }]}>{title}</Text>}
    </Pressable>
  );
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && { backgroundColor: colors.accentDim, borderColor: colors.accent }]}
    >
      <Text style={{ color: active ? colors.text : colors.textDim, fontWeight: "600", fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

export function Pill({ label, color = colors.textDim, bg = colors.cardAlt }: { label: string; color?: string; bg?: string }) {
  return (
    <View style={{ backgroundColor: bg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 }}>
      <Text style={{ color, fontSize: 12, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}

export function Field({ label, ...props }: TextInputProps & { label?: string }) {
  return (
    <View style={{ gap: 6 }}>
      {label ? <T dim small>{label}</T> : null}
      <TextInput
        placeholderTextColor={colors.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
        {...props}
        style={[styles.input, props.style]}
      />
    </View>
  );
}

export function TokenAvatar({ uri, symbol, size = 36 }: { uri?: string | null; symbol: string; size?: number }) {
  if (uri) return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.cardAlt }} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.accentDim, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: colors.text, fontWeight: "700", fontSize: size * 0.36 }}>{symbol.replace("$", "").slice(0, 2).toUpperCase()}</Text>
    </View>
  );
}

export function Note({ children, kind = "info" }: { children: React.ReactNode; kind?: "info" | "warn" | "error" | "success" }) {
  const map = {
    info: [colors.cardAlt, colors.textDim],
    warn: [colors.yellowDim, colors.yellow],
    error: [colors.redDim, colors.red],
    success: [colors.greenDim, colors.green],
  } as const;
  const [bg, fg] = map[kind];
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.md, padding: space.md }}>
      <Text style={{ color: fg, fontSize: 14, lineHeight: 20 }}>{children}</Text>
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={{ padding: space.xl, alignItems: "center", gap: space.sm }}>
      <ActivityIndicator color={colors.textDim} />
      {label ? <T dim small>{label}</T> : null}
    </View>
  );
}

export function Divider() {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: space.xs }} />;
}

/** Small line chart with a gradient fill. */
export function Sparkline({ values, width, height = 70, color = colors.accent }: { values: number[]; width: number; height?: number; color?: string }) {
  if (values.length < 2 || width <= 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 4;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = pad + (1 - (v - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity={0.35} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Path d={area} fill="url(#fill)" />
      <Path d={line} stroke={color} strokeWidth={2} fill="none" />
    </Svg>
  );
}

export function KV({ k, v, vColor }: { k: string; v: string; vColor?: string }) {
  return (
    <Row>
      <T dim>{k}</T>
      <Spacer />
      <T bold color={vColor}>
        {v}
      </T>
    </Row>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  title: { color: colors.text, fontSize: 34, fontWeight: "800", letterSpacing: -0.5 },
  h: { color: colors.text, fontSize: 20, fontWeight: "700", marginTop: space.sm },
  t: { color: colors.text, fontSize: 16, lineHeight: 22 },
  big: { color: colors.text, fontSize: 38, fontWeight: "800", letterSpacing: -0.5, fontVariant: ["tabular-nums"] },
  btn: { borderRadius: radius.md, paddingVertical: 15, paddingHorizontal: space.lg, alignItems: "center", justifyContent: "center", minHeight: 50 },
  btnSmall: { paddingVertical: 9, minHeight: 38 },
  btnText: { fontSize: 16, fontWeight: "700" },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  input: {
    backgroundColor: colors.cardAlt,
    color: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
