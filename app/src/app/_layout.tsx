import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AppProvider, useApp } from "../lib/app-context";
import { colors } from "../lib/theme";

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg, primary: colors.accent, text: colors.text, border: colors.border },
};

function RootStack() {
  const { t } = useApp();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
        headerBackTitle: "",
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="token/[mint]" options={{ title: "" }} />
      <Stack.Screen name="buy" options={{ title: t("buyTitle"), presentation: "modal" }} />
      <Stack.Screen name="fund-bot" options={{ title: t("fundTitle"), presentation: "modal" }} />
      <Stack.Screen name="cash-out" options={{ title: t("cashOut"), presentation: "modal" }} />
      <Stack.Screen name="trades" options={{ title: t("tradeHistory") }} />
      <Stack.Screen name="phantom/[action]" options={{ headerShown: false, presentation: "transparentModal", animation: "none" }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AppProvider>
      <ThemeProvider value={theme}>
        <StatusBar style="light" />
        <RootStack />
      </ThemeProvider>
    </AppProvider>
  );
}
