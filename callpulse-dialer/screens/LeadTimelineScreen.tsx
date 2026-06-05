import React, { useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { theme } from "../theme";
import { MOCK_TIMELINES, type TimelineEvent } from "../services/mockData";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "LeadTimeline">;

const formatEventTime = (iso: string): string => {
  const d = new Date(iso);
  const day = d.getDate();
  const month = d.toLocaleString("default", { month: "short" });
  const hours = d.getHours().toString().padStart(2, "0");
  const mins = d.getMinutes().toString().padStart(2, "0");
  return `${day} ${month}, ${hours}:${mins}`;
};

const EVENT_CONFIG: Record<
  string,
  { icon: React.ComponentProps<typeof Ionicons>["name"]; bg: string }
> = {
  call_outbound:      { icon: "call-outline",                bg: "#3B82F618" },
  call_inbound:       { icon: "arrow-down-circle-outline",   bg: "#22C55E18" },
  message_sent:       { icon: "chatbubble-outline",          bg: "#6366F118" },
  message_received:   { icon: "chatbubble-ellipses-outline", bg: "#6366F118" },
  disposition:        { icon: "clipboard-outline",           bg: "#F59E0B18" },
  followup_scheduled: { icon: "calendar-outline",            bg: "#8B5CF618" },
  note:               { icon: "document-text-outline",       bg: "#6B728018" },
  ai_call:            { icon: "hardware-chip-outline",       bg: "#10B98118" },
};

const EmptyState = () => (
  <View style={styles.emptyState}>
    <Ionicons name="time-outline" size={48} color={theme.colors.textSecondary} />
    <Text style={styles.emptyTitle}>No activity yet</Text>
    <Text style={styles.emptySubtitle}>Interactions with this contact will appear here.</Text>
  </View>
);

export default function LeadTimelineScreen({ route, navigation }: Props) {
  const { contactId, contactName, contactPhone } = route.params;
  const insets = useSafeAreaInsets();

  const timeline = MOCK_TIMELINES.find((t) => t.contactId === contactId);
  const events = timeline
    ? [...timeline.events].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )
    : [];

  const initials = contactName
    .split(" ")
    .map((w: string) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const totalCalls = events.filter((e) => e.type.includes("call")).length;
  const totalMessages = events.filter((e) => e.type.includes("message")).length;
  const lastCall = events.find((e) => e.type.includes("call"));
  const lastOutcome = lastCall?.outcome ?? "—";

  const renderEvent = useCallback(
    ({ item, index }: { item: TimelineEvent; index: number }) => {
      const config = EVENT_CONFIG[item.type] ?? { icon: "ellipse-outline" as const, bg: "#99999918" };
      const isFirst = index === 0;

      let outcomeBg = "#F2F2F2";
      let outcomeColor: string = theme.colors.textSecondary;
      if (item.outcomeSentiment === "positive") {
        outcomeBg = "#22C55E15";
        outcomeColor = "#16A34A";
      } else if (item.outcomeSentiment === "negative") {
        outcomeBg = "#EF444415";
        outcomeColor = "#DC2626";
      }

      const metaText = [
        item.agentName,
        formatEventTime(item.timestamp),
        item.duration,
      ]
        .filter(Boolean)
        .join(" · ");

      return (
        <View style={{ flexDirection: "row" }}>
          {/* Left column — timeline line + dot */}
          <View style={{ width: 48, alignItems: "center" }}>
            <View
              style={{
                position: "absolute",
                width: 2,
                top: 0,
                bottom: 0,
                left: 23,
                backgroundColor: theme.colors.primary + "30",
              }}
            />
            <View
              style={{
                width: 12,
                height: 12,
                borderRadius: 6,
                marginTop: 14,
                alignSelf: "center",
                backgroundColor: isFirst ? theme.colors.primary : theme.colors.card,
                borderWidth: isFirst ? 0 : 1.5,
                borderColor: theme.colors.primary + "80",
              }}
            />
          </View>

          {/* Right column — event card */}
          <View style={{ flex: 1, paddingLeft: 12, paddingBottom: 16 }}>
            <View
              style={{
                backgroundColor: theme.colors.card,
                borderRadius: 12,
                padding: 12,
                borderWidth: 0.5,
                borderColor: theme.colors.border,
              }}
            >
              {/* Row 1 — icon + title + outcome badge */}
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                  <View
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      backgroundColor: config.bg,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons name={config.icon} size={15} color={theme.colors.textPrimary} />
                  </View>
                  <Text
                    style={{ fontSize: 14, fontWeight: "500", color: theme.colors.textPrimary, flex: 1 }}
                    numberOfLines={1}
                  >
                    {item.title}
                  </Text>
                </View>
                {item.outcome && (
                  <View
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                      borderRadius: 20,
                      backgroundColor: outcomeBg,
                      marginLeft: 8,
                    }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: "600", color: outcomeColor }}>
                      {item.outcome}
                    </Text>
                  </View>
                )}
              </View>

              {/* Row 2 — subtitle */}
              {item.subtitle ? (
                <Text
                  style={{
                    fontSize: 13,
                    color: theme.colors.textSecondary,
                    marginTop: 4,
                    lineHeight: 18,
                  }}
                >
                  {item.subtitle}
                </Text>
              ) : null}

              {/* Row 3 — agent + time + duration */}
              <Text
                style={{
                  fontSize: 11,
                  color: theme.colors.textSecondary,
                  marginTop: 6,
                }}
              >
                {metaText}
              </Text>
            </View>
          </View>
        </View>
      );
    },
    []
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View
        style={{
          backgroundColor: theme.colors.primary,
          paddingHorizontal: 16,
          paddingBottom: 20,
        }}
      >
        {/* Back */}
        <Pressable
          onPress={() => navigation.goBack()}
          style={{ marginBottom: 12, alignSelf: "flex-start", padding: 4 }}
        >
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </Pressable>

        {/* Contact row */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              backgroundColor: "rgba(255,255,255,0.2)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: "500", color: "#FFFFFF" }}>{initials}</Text>
          </View>
          <View>
            <Text style={{ fontSize: 18, fontWeight: "500", color: "#FFFFFF" }}>{contactName}</Text>
            <Text style={{ fontSize: 13, color: "rgba(255,255,255,0.75)", marginTop: 2 }}>{contactPhone}</Text>
          </View>
        </View>

        {/* Action buttons */}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable
            style={{
              flex: 1,
              backgroundColor: "rgba(255,255,255,0.15)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.3)",
              borderRadius: 10,
              paddingVertical: 10,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
            onPress={() => Linking.openURL("tel:" + contactPhone)}
          >
            <Ionicons name="call-outline" size={17} color="#FFFFFF" />
            <Text style={{ fontSize: 13, color: "#FFFFFF", fontWeight: "500" }}>Call</Text>
          </Pressable>
          <Pressable
            style={{
              flex: 1,
              backgroundColor: "rgba(255,255,255,0.15)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.3)",
              borderRadius: 10,
              paddingVertical: 10,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
            onPress={() => navigation.goBack()}
          >
            <Ionicons name="chatbubble-outline" size={17} color="#FFFFFF" />
            <Text style={{ fontSize: 13, color: "#FFFFFF", fontWeight: "500" }}>Message</Text>
          </Pressable>
        </View>
      </View>

      {/* Stats bar */}
      <View style={{ flexDirection: "row", paddingHorizontal: 12, paddingTop: 12, gap: 8 }}>
        {[
          { label: "Total calls", value: String(totalCalls), small: false },
          { label: "Messages",    value: String(totalMessages), small: false },
          { label: "Last outcome", value: lastOutcome, small: true },
        ].map((stat) => (
          <View
            key={stat.label}
            style={{
              flex: 1,
              backgroundColor: theme.colors.card,
              borderRadius: 10,
              padding: 12,
              borderWidth: 0.5,
              borderColor: theme.colors.border,
            }}
          >
            <Text
              style={{
                fontSize: 11,
                color: theme.colors.textSecondary,
                textTransform: "uppercase",
                letterSpacing: 0.5,
                fontWeight: "500",
                marginBottom: 4,
              }}
            >
              {stat.label}
            </Text>
            <Text
              style={{
                fontSize: stat.small ? 14 : 18,
                color: theme.colors.textPrimary,
                fontWeight: "500",
              }}
              numberOfLines={1}
            >
              {stat.value}
            </Text>
          </View>
        ))}
      </View>

      {/* Timeline label */}
      <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}>
        <Text
          style={{
            fontSize: 13,
            fontWeight: "500",
            color: theme.colors.textSecondary,
            textTransform: "uppercase",
            letterSpacing: 0.6,
          }}
        >
          Activity
        </Text>
      </View>

      {/* Timeline list */}
      <FlatList
        data={events}
        keyExtractor={(e) => e.id}
        renderItem={renderEvent}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24 }}
        ListEmptyComponent={<EmptyState />}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg },
  emptyState: {
    alignItems: "center",
    paddingTop: 60,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.textPrimary,
  },
  emptySubtitle: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    textAlign: "center",
    paddingHorizontal: 32,
  },
});
