import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { theme } from "../theme";
import { formatPhoneDisplay } from "../services/ultrachatChatApi";
import type { CallThread } from "../services/dialIntelligence";

type Props = {
  thread: CallThread;
  onPress: (thread: CallThread) => void;
};

function statusColor(status: string): string {
  const normalized = (status || "").toLowerCase();
  if (normalized === "completed") return theme.colors.success;
  if (normalized === "failed") return theme.colors.error;
  if (normalized === "ringing") return theme.colors.warning;
  return theme.colors.textSecondary;
}

function formatStartTime(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function CallThreadRow({ thread, onPress }: Props) {
  const { latest } = thread;
  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.9} onPress={() => onPress(thread)}>
      <View style={styles.rowTop}>
        <Text style={styles.name} numberOfLines={1}>
          {thread.name}
        </Text>
        {thread.count > 1 ? (
          <View style={styles.countPill}>
            <Text style={styles.countText}>{thread.count} calls</Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.phone} numberOfLines={1}>
        {formatPhoneDisplay(thread.phone || latest.phone_number || "")}
      </Text>

      <Text style={styles.summary} numberOfLines={2}>
        {thread.summary}
      </Text>

      <View style={styles.rowBottom}>
        <Text style={[styles.status, { color: statusColor(latest.status) }]}>{latest.status}</Text>
        <Text style={styles.time}>{formatStartTime(latest.started_at)}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadow.card,
  },
  rowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  name: {
    flex: 1,
    marginRight: theme.spacing.sm,
    fontSize: theme.fontSize.md,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.textPrimary,
  },
  countPill: {
    backgroundColor: theme.colors.surfaceMuted,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
  },
  countText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.textSecondary,
  },
  phone: {
    marginTop: theme.spacing.xs,
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
  },
  summary: {
    marginTop: theme.spacing.xs,
    fontSize: theme.fontSize.sm,
    color: theme.colors.textPrimary,
  },
  rowBottom: {
    marginTop: theme.spacing.sm,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  status: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    textTransform: "capitalize",
  },
  time: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
  },
});
