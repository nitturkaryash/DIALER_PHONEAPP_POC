import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { theme } from "../../theme";
import { PrimaryButton } from "./PrimaryButton";

type Props = {
  icon?: React.ComponentProps<typeof Feather>["name"];
  title?: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function EmptyState({
  icon = "inbox",
  title,
  message,
  actionLabel,
  onAction,
}: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.iconCircle}>
        <Feather name={icon} size={28} color={theme.colors.primary} />
      </View>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <Text style={styles.message}>{message}</Text>
      {actionLabel && onAction ? (
        <PrimaryButton label={actionLabel} onPress={onAction} variant="secondary" style={styles.btn} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing["2xl"],
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: theme.colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: theme.spacing.lg,
  },
  title: {
    fontSize: theme.fontSize.md,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.xs,
  },
  message: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
  btn: {
    marginTop: theme.spacing.lg,
    alignSelf: "stretch",
    maxWidth: 220,
  },
});
