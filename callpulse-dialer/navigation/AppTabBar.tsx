import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Feather } from "@expo/vector-icons";

import { theme } from "../theme";

type FeatherIconName = React.ComponentProps<typeof Feather>["name"];

type TabConfig = {
  label: string;
  icon: FeatherIconName;
  emphasize?: boolean;
};

const TAB_CONFIG: Record<string, TabConfig> = {
  Dashboard: { label: "Home", icon: "home" },
  Dial: { label: "Dial", icon: "phone", emphasize: true },
  Chats: { label: "Chats", icon: "message-circle" },
  CallHistory: { label: "History", icon: "clock" },
  Campaigns: { label: "Campaigns", icon: "target" },
};

export default function AppTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, theme.spacing.sm);

  return (
    <View style={[styles.wrap, { paddingBottom: bottomInset }]}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const config = TAB_CONFIG[route.name] ?? { label: route.name, icon: "circle" as FeatherIconName };
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

        const iconColor = focused
          ? config.emphasize
            ? "#fff"
            : theme.colors.primary
          : theme.colors.textTertiary;

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
                focused && !config.emphasize && styles.iconWrapActive,
                focused && config.emphasize && styles.iconWrapEmphasizedActive,
              ]}
            >
              <Feather name={config.icon} size={config.emphasize ? 22 : 20} color={iconColor} />
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
    width: 36,
    height: 36,
    borderRadius: theme.radius.base,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrapEmphasized: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.surfaceMuted,
  },
  iconWrapEmphasizedActive: {
    backgroundColor: theme.colors.primary,
    ...theme.shadow.button,
  },
  iconWrapActive: {
    backgroundColor: theme.colors.primarySoft,
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
