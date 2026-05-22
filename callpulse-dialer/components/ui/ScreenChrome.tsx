import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { theme } from "../../theme";

type Props = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function ScreenChrome({ children, style }: Props) {
  return <View style={[styles.root, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.colors.bg,
  },
});
