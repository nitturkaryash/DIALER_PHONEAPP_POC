import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { AppCard, PrimaryButton, ScreenChrome, TextField } from "../components/ui";
import type { RootStackParamList } from "../navigation/types";
import { login, setToken } from "../services/api";
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
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.container}
      >
        <View style={styles.brandBlock}>
          <Text style={styles.logo}>CallPulse</Text>
          <Text style={styles.tagline}>Agent dialer for outbound teams</Text>
        </View>

        <AppCard style={styles.card}>
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

          <PrimaryButton label="Sign in" onPress={onSubmit} loading={loading} />

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
  },
  logo: {
    fontSize: theme.fontSize.display,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.textPrimary,
    letterSpacing: theme.letterSpacing.tight,
  },
  tagline: {
    marginTop: theme.spacing.sm,
    fontSize: theme.fontSize.base,
    color: theme.colors.textSecondary,
    lineHeight: 22,
  },
  card: {
    width: "100%",
  },
  skipButton: {
    marginTop: theme.spacing.lg,
    alignItems: "center",
    padding: theme.spacing.sm,
  },
  skipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textTertiary,
    textDecorationLine: "underline",
  },
});
