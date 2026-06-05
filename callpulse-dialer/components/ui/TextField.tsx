import React, { useState } from "react";
import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";

import { theme } from "../../theme";

type Props = TextInputProps & {
  label?: string;
  error?: string;
  hint?: string;
};

export function TextField({ label, error, hint, style, onFocus, onBlur, ...rest }: Props) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={theme.colors.textTertiary}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          styles.input,
          focused && styles.inputFocused,
          !!error && styles.inputError,
          style,
        ]}
        {...rest}
      />
      {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: theme.spacing.md,
  },
  label: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.xs,
  },
  input: {
    height: 52,
    borderRadius: theme.radius.md,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing.lg,
    color: theme.colors.textPrimary,
    fontSize: theme.fontSize.base,
    backgroundColor: theme.colors.card,
  },
  inputFocused: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.card,
  },
  inputError: {
    borderColor: theme.colors.error,
  },
  error: {
    marginTop: theme.spacing.xs,
    fontSize: theme.fontSize.sm,
    color: theme.colors.error,
  },
  hint: {
    marginTop: theme.spacing.xs,
    fontSize: theme.fontSize.sm,
    color: theme.colors.textTertiary,
  },
});
