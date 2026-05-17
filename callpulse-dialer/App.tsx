import "react-native-gesture-handler";
import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import RootNavigator from "./navigation/RootNavigator";
import { theme } from "./theme";

export default function App() {
  return (
    <SafeAreaProvider>
      {/* Keep only top inset here; bottom inset is handled by the custom tab bar. */}
      <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: theme.colors.bg }}>
        <NavigationContainer>
          <RootNavigator />
        </NavigationContainer>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
