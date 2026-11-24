import { useEffect } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { handlePhantomRedirect } from "../../lib/phantom";
import { Loading } from "../../components/ui";

/**
 * Phantom sends the user back here (cryptopilot://phantom/<action>?nonce=…&data=…).
 * We hand the answer to the waiting request and immediately return to the previous screen.
 */
export default function PhantomReturn() {
  const raw = useLocalSearchParams();

  useEffect(() => {
    const params: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(raw)) params[k] = Array.isArray(v) ? v[0] : v;
    const action = params.action ?? "";
    void (async () => {
      await handlePhantomRedirect(action, params);
      if (router.canGoBack()) router.back();
      else router.replace("/");
    })();
    // Run once per redirect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={{ flex: 1, justifyContent: "center", backgroundColor: "rgba(0,0,0,0.4)" }}>
      <Loading />
    </View>
  );
}
