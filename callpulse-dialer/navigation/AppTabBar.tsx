import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { theme } from "../theme";

type TabConfig = {
  label: string;
  short: string;
  emphasize?: boolean;
};

const TAB_CONFIG: Record<string, TabConfig> = {
  Dashboard: { label: "Home", short: "H" },
  Dial: { label: "Dial", short: "D", emphasize: true },
  CallHistory: { label: "History", short: "L" },
  Campaigns: { label: "Campaigns", short: "C" },
};

export default function AppTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, theme.spacing.sm);

  return (
    <View style={[styles.wrap, { paddingBottom: bottomInset }]}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const config = TAB_CONFIG[route.name] ?? { label: route.name, short: route.name[0] ?? "•" };
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
          <Pressable
            key={route.key}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            accessibilityLabel={options.tabBarAccessibilityLabel}
            onPress={onPress}
            style={({ pressed }) => [styles.tab, pressed && styles.tabPressed]}
          >
            <View
              style={[
                styles.iconWrap,
                config.emphasize && styles.iconWrapEmphasized,
                focused && styles.iconWrapActive,
              ]}
            >
              <Text style={[styles.icon, focused && styles.iconActive]}>{config.short}</Text>
            </View>
            <Text style={[styles.label, focused && styles.labelActive]} numberOfLines={1}>
              {config.label}
            </Text>
          </Pressable>
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
    paddingHorizontal: theme.spacing.sm,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing.xs,
    minWidth: 0,
  },
  tabPressed: {
    opacity: 0.85,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: theme.radius.base,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrapEmphasized: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surfaceMuted,
  },
  iconWrapActive: {
    backgroundColor: theme.colors.primarySoft,
  },
  icon: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.textTertiary,
  },
  iconActive: {
    color: theme.colors.primary,
  },
  label: {
    marginTop: 2,
    fontSize: theme.fontSize.xs,
    color: theme.colors.textTertiary,
    fontWeight: theme.fontWeight.medium,
  },
  labelActive: {
    color: theme.colors.primary,
    fontWeight: theme.fontWeight.semibold,
  },
});
