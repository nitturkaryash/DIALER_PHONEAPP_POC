import React from "react";
import { View, Text, Pressable, StyleSheet, Alert, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "../theme";

interface Props {
  onLoggedOut?: () => void;
}

type MenuItem = {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  destructive?: boolean;
};

export default function MoreScreen({ onLoggedOut }: Props) {
  const insets = useSafeAreaInsets();

  const items: MenuItem[] = [
    {
      id: "campaigns",
      label: "Campaigns",
      icon: "megaphone-outline",
      onPress: () => Alert.alert("Campaigns", "Select the Leads tab to manage campaigns."),
    },
    {
      id: "notifications",
      label: "Notifications",
      icon: "notifications-outline",
      onPress: () => Alert.alert("Coming Soon", "Notifications will be available soon."),
    },
    {
      id: "settings",
      label: "Settings",
      icon: "settings-outline",
      onPress: () => Alert.alert("Coming Soon", "Settings will be available soon."),
    },
    {
      id: "logout",
      label: "Logout",
      icon: "log-out-outline",
      destructive: true,
      onPress: () => {
        Alert.alert("Logout", "Are you sure you want to logout?", [
          { text: "Cancel", style: "cancel" },
          { text: "Logout", style: "destructive", onPress: onLoggedOut },
        ]);
      },
    },
  ];

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={styles.content}
    >
      <Text style={styles.heading}>More</Text>
      <View style={styles.group}>
        {items.map((item, index) => (
          <Pressable
            key={item.id}
            style={({ pressed }) => [
              styles.row,
              index < items.length - 1 && styles.rowBorder,
              pressed && styles.rowPressed,
            ]}
            onPress={item.onPress}
          >
            <View style={[styles.iconWrap, item.destructive && styles.iconWrapDestructive]}>
              <Ionicons
                name={item.icon}
                size={20}
                color={item.destructive ? "#EF4444" : theme.colors.primary}
              />
            </View>
            <Text style={[styles.rowLabel, item.destructive && styles.rowLabelDestructive]}>
              {item.label}
            </Text>
            {!item.destructive && (
              <Ionicons name="chevron-forward" size={16} color={theme.colors.textSecondary} />
            )}
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: 20 },
  heading: { fontSize: 28, fontWeight: "700", color: theme.colors.textPrimary, marginBottom: 24 },
  group: {
    backgroundColor: theme.colors.card,
    borderRadius: 14,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, gap: 14 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  rowPressed: { opacity: 0.6 },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: theme.colors.primary + "18",
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrapDestructive: { backgroundColor: "#EF444418" },
  rowLabel: { flex: 1, fontSize: 16, fontWeight: "500", color: theme.colors.textPrimary },
  rowLabelDestructive: { color: "#EF4444" },
});
