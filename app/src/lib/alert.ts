import { Alert as RNAlert, Platform, type AlertButton } from "react-native";

/**
 * Drop-in replacement for React Native's Alert. On iPhone it's the native dialog;
 * on the web version (where RN's Alert does nothing) it uses the browser's
 * alert/confirm dialogs, so confirmations like "Sell all & stop" still work.
 */
export const Alert = {
  alert(title: string, message?: string, buttons?: AlertButton[]) {
    if (Platform.OS !== "web") {
      RNAlert.alert(title, message, buttons);
      return;
    }
    const text = message ? `${title}\n\n${message}` : title;
    const w = globalThis as unknown as { alert(t: string): void; confirm(t: string): boolean };
    const actions = (buttons ?? []).filter((b) => b.style !== "cancel");
    const cancel = (buttons ?? []).find((b) => b.style === "cancel");
    if (actions.length && cancel) {
      if (w.confirm(text)) actions[actions.length - 1].onPress?.();
      else cancel.onPress?.();
      return;
    }
    w.alert(text);
    (buttons ?? [])[0]?.onPress?.();
  },
};
