import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { AppCard, BrandMark, PrimaryButton, ScreenChrome, TextField } from "../components/ui";
import type { RootStackParamList } from "../navigation/types";
import { login, setRefreshToken, setToken } from "../services/api";
import { theme } from "../theme";

const DEV_MODE = process.env.EXPO_PUBLIC_ENABLE_DEV_MOCKS === "true";

type Props = NativeStackScreenProps<RootStackParamList, "Login"> & {
  onLoginSuccess: () => void;
};

export default function LoginScreen({ navigation, onLoginSuccess }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async () => {
    if (!email || !password) {
      setError("Email and password are required");
      return;
    }
    try {
      setLoading(true);
      setError("");
      const result = await login(email.trim(), password);
      await setToken(result.access_token);
      if (result.refresh_token) {
        await setRefreshToken(result.refresh_token);
      }
      onLoginSuccess();
      navigation.replace("MainTabs");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to sign in");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenChrome>
      <LinearGradient
        colors={[theme.colors.primary, theme.colors.heroGradient[1]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.heroBand}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.container}
      >
        <View style={styles.brandBlock}>
          <BrandMark size="lg" />
          <Text style={styles.heroCopy}>
            Sign in to place calls, manage campaigns, and reply on WhatsApp — all in one app.
          </Text>
        </View>

        <AppCard style={styles.card}>
          <Text style={styles.cardTitle}>Welcome back</Text>
          <TextField
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="you@company.com"
          />
          <TextField
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Enter password"
            error={error || undefined}
          />

          <PrimaryButton label="Sign in" onPress={onSubmit} loading={loading} size="lg" />

          {DEV_MODE ? (
            <TouchableOpacity
              style={styles.skipButton}
              onPress={async () => {
                await setToken("dev_token");
                onLoginSuccess();
                navigation.replace("MainTabs");
              }}
            >
              <Text style={styles.skipText}>Skip login (dev)</Text>
            </TouchableOpacity>
          ) : null}
        </AppCard>
      </KeyboardAvoidingView>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  heroBand: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 200,
    borderBottomLeftRadius: theme.radius["2xl"],
    borderBottomRightRadius: theme.radius["2xl"],
  },
  container: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: theme.spacing.screen,
    paddingVertical: theme.spacing["2xl"],
    maxWidth: 440,
    width: "100%",
    alignSelf: "center",
  },
  brandBlock: {
    marginBottom: theme.spacing.xl,
    paddingTop: theme.spacing.md,
  },
  heroCopy: {
    marginTop: theme.spacing.lg,
    fontSize: theme.fontSize.base,
    color: theme.colors.textSecondary,
    lineHeight: 24,
  },
  card: {
    width: "100%",
  },
  cardTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.lg,
  },
  skipButton: {
    marginTop: theme.spacing.lg,
    alignItems: "center",
    padding: theme.spacing.sm,
  },
  skipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.primary,
    fontWeight: theme.fontWeight.medium,
  },
});
