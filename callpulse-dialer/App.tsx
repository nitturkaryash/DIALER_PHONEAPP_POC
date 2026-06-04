import "react-native-gesture-handler";
import React, { useCallback, useEffect, useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import RootNavigator from "./navigation/RootNavigator";
import { getToken } from "./services/api";
import { AgentStatusProvider } from "./state/AgentStatusContext";
import { theme } from "./theme";

export default function App() {
  const [authVersion, setAuthVersion] = useState(0);
  const [hasToken, setHasToken] = useState(false);

  useEffect(() => {
    (async () => {
      const token = await getToken();
      setHasToken(Boolean(token));
    })();
  }, [authVersion]);

  const handleAuthChange = useCallback(() => {
    setAuthVersion((v) => v + 1);
  }, []);

  return (
    <SafeAreaProvider>
      {/* Keep only top inset here; bottom inset is handled by the custom tab bar. */}
      <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: theme.colors.bg }}>
        <AgentStatusProvider authVersion={hasToken ? authVersion + 1 : 0}>
          <NavigationContainer>
            <RootNavigator onAuthChange={handleAuthChange} />
          </NavigationContainer>
        </AgentStatusProvider>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
