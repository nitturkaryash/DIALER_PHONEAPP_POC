import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { theme } from "../../theme";

type Props = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "ghost";
  size?: "md" | "lg";
  style?: StyleProp<ViewStyle>;
};

export function PrimaryButton({
  label,
  onPress,
  loading = false,
  disabled = false,
  variant = "primary",
  size = "md",
  style,
}: Props) {
  const isPrimary = variant === "primary";
  const isGhost = variant === "ghost";

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        size === "lg" && styles.lg,
        isPrimary && styles.primary,
        variant === "secondary" && styles.secondary,
        isGhost && styles.ghost,
        (pressed || loading) &&
          (isPrimary ? styles.primaryPressed : isGhost ? styles.ghostPressed : styles.secondaryPressed),
        (disabled || loading) && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? theme.colors.card : theme.colors.primary} />
      ) : (
        <Text
          style={[
            styles.label,
            size === "lg" && styles.labelLg,
            isPrimary && styles.labelPrimary,
            variant === "secondary" && styles.labelSecondary,
            isGhost && styles.labelGhost,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: theme.radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing.lg,
  },
  lg: {
    minHeight: 52,
    borderRadius: theme.radius.lg,
  },
  primary: {
    backgroundColor: theme.colors.primary,
    ...theme.shadow.button,
  },
  primaryPressed: {
    backgroundColor: theme.colors.primaryPressed,
  },
  secondary: {
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
  },
  secondaryPressed: {
    backgroundColor: theme.colors.surfaceMuted,
  },
  ghost: {
    backgroundColor: "transparent",
  },
  ghostPressed: {
    backgroundColor: theme.colors.overlay,
  },
  disabled: {
    opacity: 0.55,
  },
  label: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  labelLg: {
    fontSize: theme.fontSize.md,
  },
  labelPrimary: {
    color: theme.colors.card,
  },
  labelSecondary: {
    color: theme.colors.textPrimary,
  },
  labelGhost: {
    color: theme.colors.primary,
  },
});
