import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { getToken } from "../services/api";
import AgentStatusScreen from "../screens/AgentStatusScreen";
import CallScreen from "../screens/CallScreen";
import DispositionScreen from "../screens/DispositionScreen";
import LoginScreen from "../screens/LoginScreen";
import HumanCallScreen from "../screens/HumanCallScreen";
import OutboundCallScreen from "../screens/OutboundCallScreen";
import CallHistoryDetailScreen from "../screens/CallHistoryDetailScreen";
import ChatDetailScreen from "../screens/ChatDetailScreen";
import LeadTimelineScreen from "../screens/LeadTimelineScreen";
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

type Props = {
  onAuthChange?: () => void;
};

export default function RootNavigator({ onAuthChange }: Props) {
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

  const onLoginSuccess = () => {
    setIsAuthenticated(true);
    onAuthChange?.();
  };
  const onLoggedOut = () => {
    setIsAuthenticated(false);
    onAuthChange?.();
  };

  if (loading) {
    return (
      <View style={splashStyles.wrap}>
        <View style={splashStyles.logo}>
          <Text style={splashStyles.logoText}>CP</Text>
        </View>
        <Text style={splashStyles.title}>CallPulse</Text>
        <ActivityIndicator color={theme.colors.primary} style={splashStyles.spinner} />
      </View>
    );
  }

  return (
    <Stack.Navigator
      initialRouteName={isAuthenticated ? "MainTabs" : "Login"}
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.bg } }}
    >
      <Stack.Screen name="Login">
        {(props) => <LoginScreen {...props} onLoginSuccess={onLoginSuccess} />}
      </Stack.Screen>
      <Stack.Screen name="MainTabs">
        {(props) => <MainTabNavigator {...props} onLoggedOut={onLoggedOut} />}
      </Stack.Screen>
      <Stack.Screen name="OutboundCall" component={OutboundCallScreen} options={modalOptions} />
      <Stack.Screen name="HumanCall" component={HumanCallScreen} options={modalOptions} />
      <Stack.Screen name="Call" component={CallScreen} options={modalOptions} />
      <Stack.Screen name="Disposition" component={DispositionScreen} options={modalOptions} />
      <Stack.Screen name="CallHistoryDetail" component={CallHistoryDetailScreen} options={modalOptions} />
      <Stack.Screen name="AgentStatus" component={AgentStatusScreen} options={modalOptions} />
      <Stack.Screen name="ChatDetail" component={ChatDetailScreen} />
      <Stack.Screen name="LeadTimeline" component={LeadTimelineScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}

const splashStyles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: theme.colors.bg,
    justifyContent: "center",
    alignItems: "center",
  },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: theme.spacing.md,
  },
  logoText: {
    color: theme.colors.card,
    fontSize: 24,
    fontWeight: "700",
  },
  title: {
    fontSize: theme.fontSize.xl,
    fontWeight: "700",
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.xl,
  },
  spinner: { marginTop: theme.spacing.sm },
});
