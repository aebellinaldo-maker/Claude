import { NativeTabs } from "expo-router/native-tabs";
import { useApp } from "../../lib/app-context";
import { colors } from "../../lib/theme";

export default function TabsLayout() {
  const { t } = useApp();
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
