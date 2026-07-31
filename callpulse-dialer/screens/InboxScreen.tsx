import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { theme } from "../theme";
import ChatsScreen from "./ChatsScreen";
import CallHistoryScreen from "./CallHistoryScreen";
import SmartCallScreen from "./SmartCallScreen";

type InboxTab = "smart" | "messages" | "calllog";

const TABS: { key: InboxTab; label: string }[] = [
  { key: "smart", label: "Smart" },
  { key: "messages", label: "Messages" },
  { key: "calllog", label: "Call Log" },
];

export default function InboxScreen() {
  const [activeTab, setActiveTab] = useState<InboxTab>("smart");

  return (
    <View style={styles.container}>
      <View style={styles.segmentContainer}>
        {TABS.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <Pressable
              key={tab.key}
              style={[styles.segment, active && styles.segmentActive]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.content}>
        {activeTab === "smart" ? (
          <SmartCallScreen />
        ) : activeTab === "messages" ? (
          <ChatsScreen />
        ) : (
          <CallHistoryScreen />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg },
  segmentContainer: {
    flexDirection: "row",
    backgroundColor: theme.colors.surfaceMuted,
    borderRadius: 10,
    margin: 16,
    padding: 3,
  },
  segment: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: 8 },
  segmentActive: {
    backgroundColor: theme.colors.card,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  segmentText: { fontSize: 14, fontWeight: "500", color: theme.colors.textSecondary },
  segmentTextActive: { fontWeight: "700", color: theme.colors.textPrimary },
  content: { flex: 1 },
});
