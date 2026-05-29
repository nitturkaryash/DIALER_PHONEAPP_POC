import React, { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { getToken } from "../services/api";
import CallScreen from "../screens/CallScreen";
import DispositionScreen from "../screens/DispositionScreen";
import LoginScreen from "../screens/LoginScreen";
import HumanCallScreen from "../screens/HumanCallScreen";
import OutboundCallScreen from "../screens/OutboundCallScreen";
import CallHistoryDetailScreen from "../screens/CallHistoryDetailScreen";
import ChatDetailScreen from "../screens/ChatDetailScreen";
import { theme } from "../theme";
import MainTabNavigator from "./MainTabNavigator";
import type { RootStackParamList } from "./types";

export type { RootStackParamList } from "./types";

const Stack = createNativeStackNavigator<RootStackParamList>();

const modalOptions = {
  presentation: "modal" as const,
  animation: "slide_from_bottom" as const,
  headerShown: false,
};

export default function RootNavigator() {
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const token = await getToken();
      if (mounted) {
        setIsAuthenticated(Boolean(token));
        setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.bg, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <Stack.Navigator
      initialRouteName={isAuthenticated ? "MainTabs" : "Login"}
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.bg } }}
    >
      <Stack.Screen name="Login">{(props) => <LoginScreen {...props} onLoginSuccess={() => setIsAuthenticated(true)} />}</Stack.Screen>
      <Stack.Screen name="MainTabs">
        {(props) => <MainTabNavigator {...props} onLoggedOut={() => setIsAuthenticated(false)} />}
      </Stack.Screen>
      <Stack.Screen name="OutboundCall" component={OutboundCallScreen} options={modalOptions} />
      <Stack.Screen name="HumanCall" component={HumanCallScreen} options={modalOptions} />
      <Stack.Screen name="Call" component={CallScreen} options={modalOptions} />
      <Stack.Screen name="Disposition" component={DispositionScreen} options={modalOptions} />
      <Stack.Screen name="CallHistoryDetail" component={CallHistoryDetailScreen} options={modalOptions} />
      <Stack.Screen name="ChatDetail" component={ChatDetailScreen} />
    </Stack.Navigator>
  );
}
