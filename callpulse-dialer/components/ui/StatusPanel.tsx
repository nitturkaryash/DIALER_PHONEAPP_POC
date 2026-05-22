import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { theme } from "../../theme";
import { PrimaryButton } from "./PrimaryButton";

type Props = {
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  empty?: string;
};

export function StatusPanel({ loading, error, onRetry, empty }: Props) {
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.primary} size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.panel}>
        <Text style={styles.errorTitle}>Could not load</Text>
        <Text style={styles.errorBody}>{error}</Text>
        {onRetry ? <PrimaryButton label="Try again" onPress={onRetry} variant="secondary" style={styles.retry} /> : null}
      </View>
    );
  }

  if (empty) {
    return (
      <View style={styles.panel}>
        <Text style={styles.empty}>{empty}</Text>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing["3xl"],
  },
  panel: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing["2xl"],
  },
  errorTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.xs,
  },
  errorBody: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
  retry: {
    marginTop: theme.spacing.lg,
    alignSelf: "stretch",
    maxWidth: 240,
  },
  empty: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textSecondary,
    textAlign: "center",
  },
});
