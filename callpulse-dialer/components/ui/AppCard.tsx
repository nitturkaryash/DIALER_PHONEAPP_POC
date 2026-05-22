import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { theme } from "../../theme";

type Props = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
};

export function AppCard({ children, style, padded = true }: Props) {
  return <View style={[styles.card, padded && styles.padded, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadow.card,
  },
  padded: {
    padding: theme.spacing.card,
  },
});
