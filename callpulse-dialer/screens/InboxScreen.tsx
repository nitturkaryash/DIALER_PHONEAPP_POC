import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "../theme";
import ChatsScreen from "./ChatsScreen";
import CallHistoryScreen from "./CallHistoryScreen";

export default function InboxScreen() {
  const [activeTab, setActiveTab] = useState<"messages" | "calllog">("messages");
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.segmentContainer}>
        <Pressable
          style={[styles.segment, activeTab === "messages" && styles.segmentActive]}
          onPress={() => setActiveTab("messages")}
        >
          <Text style={[styles.segmentText, activeTab === "messages" && styles.segmentTextActive]}>
            Messages
          </Text>
        </Pressable>
        <Pressable
          style={[styles.segment, activeTab === "calllog" && styles.segmentActive]}
          onPress={() => setActiveTab("calllog")}
        >
          <Text style={[styles.segmentText, activeTab === "calllog" && styles.segmentTextActive]}>
            Call Log
          </Text>
        </Pressable>
      </View>
      <View style={styles.content}>
        {activeTab === "messages" ? <ChatsScreen /> : <CallHistoryScreen />}
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
