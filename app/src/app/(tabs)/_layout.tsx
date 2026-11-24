import { Platform, Text } from "react-native";
import { NativeTabs } from "expo-router/native-tabs";
import { Tabs } from "expo-router/js-tabs";
import { useApp } from "../../lib/app-context";
import { colors } from "../../lib/theme";

/** Web version (e.g. inside Phantom's browser): a regular tab bar with emoji icons. */
function WebTabs() {
  const { t } = useApp();
  const icon = (e: string) => () => <Text style={{ fontSize: 20 }}>{e}</Text>;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textDim,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t("tabWallet"), tabBarIcon: icon("👛") }} />
      <Tabs.Screen name="market" options={{ title: t("tabMarket"), tabBarIcon: icon("📈") }} />
      <Tabs.Screen name="chart" options={{ title: t("tabChart"), tabBarIcon: icon("📷") }} />
      <Tabs.Screen name="bot" options={{ title: t("tabBot"), tabBarIcon: icon("🤖") }} />
      <Tabs.Screen name="settings" options={{ title: t("tabSettings"), tabBarIcon: icon("⚙️") }} />
    </Tabs>
  );
}

export default function TabsLayout() {
  const { t } = useApp();
  if (Platform.OS === "web") return <WebTabs />;
  return (
    <NativeTabs tintColor={colors.accent}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>{t("tabWallet")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "wallet.bifold", selected: "wallet.bifold.fill" }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="market">
        <NativeTabs.Trigger.Label>{t("tabMarket")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="chart.line.uptrend.xyaxis" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="chart">
        <NativeTabs.Trigger.Label>{t("tabChart")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="camera.viewfinder" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="bot">
        <NativeTabs.Trigger.Label>{t("tabBot")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "cpu", selected: "cpu.fill" }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>{t("tabSettings")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "gearshape", selected: "gearshape.fill" }} />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
