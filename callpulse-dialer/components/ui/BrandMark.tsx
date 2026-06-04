import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { theme } from "../../theme";

type Props = {
  size?: "sm" | "md" | "lg";
  style?: StyleProp<ViewStyle>;
};

const SIZES = {
  sm: { box: 40, font: 16, title: theme.fontSize.lg },
  md: { box: 56, font: 22, title: theme.fontSize["2xl"] },
  lg: { box: 72, font: 28, title: theme.fontSize.display },
};

export function BrandMark({ size = "md", style }: Props) {
  const s = SIZES[size];
  return (
    <View style={[styles.row, style]}>
      <View style={[styles.logo, { width: s.box, height: s.box, borderRadius: s.box / 4 }]}>
        <Text style={[styles.logoLetter, { fontSize: s.font }]}>CP</Text>
      </View>
      <View>
        <Text style={[styles.name, { fontSize: s.title }]}>CallPulse</Text>
        <Text style={styles.tag}>Agent workspace</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md },
  logo: {
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
    ...theme.shadow.button,
  },
  logoLetter: {
    color: theme.colors.card,
    fontWeight: theme.fontWeight.bold,
    letterSpacing: -0.5,
  },
  name: {
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.textPrimary,
    letterSpacing: theme.letterSpacing.tight,
  },
  tag: {
    marginTop: 2,
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
  },
});
