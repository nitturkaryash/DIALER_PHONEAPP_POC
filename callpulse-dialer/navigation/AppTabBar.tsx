import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";

import { theme } from "../theme";

type TabConfig = {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  short?: string;
  emphasize?: boolean;
};

const TAB_CONFIG: Record<string, TabConfig> = {
  Home:  { label: "Home",  icon: "home-outline",                emphasize: false },
  Leads: { label: "Leads", icon: "people-outline",              emphasize: false },
  Dial:  { label: "Dial",  icon: "keypad",                      emphasize: true  },
  Inbox: { label: "Inbox", icon: "chatbubbles-outline",         emphasize: false },
  More:  { label: "More",  icon: "ellipsis-horizontal-outline", emphasize: false },
};

const INACTIVE_COLOR = "#999";

export default function AppTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, theme.spacing.sm);

  return (
    <View style={[styles.wrap, { paddingBottom: bottomInset }]}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const config = TAB_CONFIG[route.name] ?? { label: route.name, icon: "ellipsis-horizontal-outline" as const };
        const { options } = descriptors[route.key];
        const color = focused ? theme.colors.primary : INACTIVE_COLOR;

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
          if (focused && route.name === "Leads") {
            navigation.navigate("Leads", { screen: "CampaignList" });
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
            {config.emphasize ? (
              <View style={styles.dialButton}>
                <Ionicons name="keypad" size={26} color="#FFFFFF" />
              </View>
            ) : (
              <>
                <Ionicons name={config.icon} size={22} color={color} />
                <Text
                  style={[styles.label, { color, fontWeight: focused ? "600" : "400" }]}
                  numberOfLines={1}
                >
                  {config.label}
                </Text>
              </>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "flex-start",
    minHeight: 72,
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
  label: {
    fontSize: 11,
    marginTop: 3,
  },
  dialButton: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -28,
    marginBottom: 16,
    shadowColor: theme.colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
});
