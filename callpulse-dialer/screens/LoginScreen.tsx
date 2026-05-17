import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../navigation/types";
import { login, setToken } from "../services/api";
import { theme } from "../theme";

const DEV_MODE = false;

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
    <LinearGradient
      colors={theme.colors.backgroundGradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.gradient}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.container}
      >
        <View style={styles.card}>
          <Text style={styles.logo}>CallPulse</Text>
          <Text style={styles.tagline}>Agent Dialer</Text>

          <TextInput
            value={email}
            onChangeText={setEmail}
            style={styles.input}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="Email"
            placeholderTextColor={theme.colors.textTertiary}
          />
          <TextInput
            value={password}
            onChangeText={setPassword}
            style={styles.input}
            secureTextEntry
            placeholder="Password"
            placeholderTextColor={theme.colors.textTertiary}
          />
          {!!error && <Text style={styles.error}>{error}</Text>}

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={onSubmit}
            disabled={loading}
            style={styles.buttonWrap}
          >
            <LinearGradient
              colors={theme.colors.primaryGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.button}
            >
              {loading ? (
                <ActivityIndicator color={theme.colors.card} />
              ) : (
                <Text style={styles.buttonText}>Sign In</Text>
              )}
            </LinearGradient>
          </TouchableOpacity>

          {DEV_MODE && (
            <TouchableOpacity
              style={styles.skipButton}
              onPress={async () => {
                await setToken("dev_token");
                onLoginSuccess();
                navigation.replace("MainTabs");
              }}
            >
              <Text style={styles.skipText}>Skip Login (Dev)</Text>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: theme.spacing.screen,
  },
  card: {
    width: "100%",
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.xl,
    padding: theme.spacing.card,
    ...theme.shadow.card,
  },
  logo: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.primary,
    textAlign: "center",
  },
  tagline: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textTertiary,
    textAlign: "center",
    marginBottom: theme.spacing.xl,
    marginTop: theme.spacing.xs,
  },
  input: {
    height: 48,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing.lg,
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.md,
    fontSize: theme.fontSize.base,
    backgroundColor: "#FAFAFA",
  },
  error: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.error,
    marginBottom: theme.spacing.md,
  },
  buttonWrap: { marginTop: theme.spacing.sm },
  button: {
    height: 48,
    borderRadius: theme.radius.full,
    justifyContent: "center",
    alignItems: "center",
    ...theme.shadow.button,
  },
  buttonText: {
    color: theme.colors.card,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  skipButton: {
    marginTop: theme.spacing.md,
    alignItems: "center",
    padding: theme.spacing.sm,
  },
  skipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textTertiary,
    textDecorationLine: "underline",
  },
});
