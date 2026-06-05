import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { theme } from "../../theme";

type Variant = "success" | "neutral" | "warning" | "primary";

type Props = {
  label: string;
  variant?: Variant;
  style?: StyleProp<ViewStyle>;
};

const VARIANTS: Record<Variant, { bg: string; text: string }> = {
  success: { bg: theme.colors.successSoft, text: theme.colors.success },
  neutral: { bg: theme.colors.surfaceMuted, text: theme.colors.textSecondary },
  warning: { bg: theme.colors.warningSoft, text: theme.colors.warning },
  primary: { bg: theme.colors.primarySoft, text: theme.colors.primary },
};

export function BadgeChip({ label, variant = "neutral", style }: Props) {
  const v = VARIANTS[variant];
  return (
    <View style={[styles.chip, { backgroundColor: v.bg }, style]}>
      <Text style={[styles.text, { color: v.text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    alignSelf: "flex-start",
  },
  text: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
});
