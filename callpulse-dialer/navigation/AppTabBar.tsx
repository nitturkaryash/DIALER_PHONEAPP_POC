import React from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { theme } from "../theme";

type TabConfig = {
  label: string;
  icon: string;
  emphasize?: boolean;
};

const TAB_CONFIG: Record<string, TabConfig> = {
  Dashboard: { label: "Home", icon: "⌂" },
  Dial: { label: "Dial", icon: "📞", emphasize: true },
  Campaigns: { label: "Campaigns", icon: "☰" },
};

export default function AppTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, theme.spacing.sm) }]}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const config = TAB_CONFIG[route.name] ?? { label: route.name, icon: "•" };
        const { options } = descriptors[route.key];

        const onPress = () => {
          if (Platform.OS !== "web") {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
          }
          const event = navigation.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name);
            return;
          }
          if (focused && route.name === "Campaigns") {
            navigation.navigate("Campaigns", { screen: "CampaignList" });
          }
        };

        return (
          <TouchableOpacity
            key={route.key}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            accessibilityLabel={options.tabBarAccessibilityLabel}
            activeOpacity={0.85}
            onPress={onPress}
            style={styles.tab}
          >
            <View style={[styles.iconWrap, config.emphasize && styles.iconWrapEmphasized, focused && styles.iconWrapActive]}>
              <Text style={[styles.icon, config.emphasize && styles.iconEmphasized]}>{config.icon}</Text>
            </View>
            <Text style={[styles.label, focused && styles.labelActive]}>{config.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    backgroundColor: theme.colors.card,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing.sm,
    ...theme.shadow.card,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing.xs,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrapEmphasized: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.muted,
  },
  iconWrapActive: {
    backgroundColor: "rgba(111,163,210,0.15)",
  },
  icon: {
    fontSize: theme.fontSize.lg,
    color: theme.colors.textSecondary,
  },
  iconEmphasized: {
    fontSize: 20,
  },
  label: {
    marginTop: 2,
    fontSize: theme.fontSize.xs,
    color: theme.colors.textSecondary,
    fontWeight: "500",
  },
  labelActive: {
    color: theme.colors.primary,
    fontWeight: "600",
  },
});
