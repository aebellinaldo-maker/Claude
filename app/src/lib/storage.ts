import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

/**
 * Key-value storage: iOS Keychain (via SecureStore) on the phone,
 * localStorage when the app is opened in a browser for previewing.
 */
export const storage = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === "web") return globalThis.localStorage?.getItem(key) ?? null;
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === "web") {
      globalThis.localStorage?.setItem(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
};
