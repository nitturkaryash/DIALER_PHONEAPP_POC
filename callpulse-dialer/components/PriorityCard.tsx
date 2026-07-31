import React, { useState } from "react";
import { LayoutAnimation, Platform, StyleSheet, Text, TouchableOpacity, UIManager, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { BadgeChip } from "./ui";
import { theme } from "../theme";
import { composeCallSummary } from "../services/callSummary";
import { formatPhoneDisplay } from "../services/ultrachatChatApi";
import type { PriorityContact, Urgency } from "../services/dialIntelligence";
import type { CallHistoryItem } from "../types";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Props = {
  contact: PriorityContact;
  rank: number;
  history: CallHistoryItem[];
  onCall: (contact: PriorityContact) => void;
  disabled?: boolean;
};

const URGENCY_VARIANT: Record<Urgency, "warning" | "primary" | "neutral"> = {
  high: "warning",
  medium: "primary",
  low: "neutral",
};

const URGENCY_DOT: Record<Urgency, string> = {
  high: theme.colors.warning,
  medium: theme.colors.primary,
  low: theme.colors.textTertiary,
};

const MAX_VISIBLE_CALLS = 5;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function callTimestamp(item: CallHistoryItem): number {
  return Math.max(
    item.started_at ? new Date(item.started_at).getTime() || 0 : 0,
    item.wrapped_at ? new Date(item.wrapped_at).getTime() || 0 : 0
  );
}

function formatWhen(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function PriorityCard({ contact, rank, history, onCall, disabled }: Props) {
  const [expanded, setExpanded] = useState(false);
  const hasHistory = history.length > 0;

  const recentCalls = [...history].sort((a, b) => callTimestamp(b) - callTimestamp(a)).slice(0, MAX_VISIBLE_CALLS);

  const toggle = () => {
    if (!hasHistory) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((prev) => !prev);
  };

  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.headerRow} onPress={toggle} activeOpacity={hasHistory ? 0.7 : 1}>
        <View style={styles.rankBadge}>
          <View style={[styles.dot, { backgroundColor: URGENCY_DOT[contact.urgency] }]} />
          <Text style={styles.rankText}>{rank}</Text>
        </View>

        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials(contact.name)}</Text>
        </View>

        <View style={styles.body}>
          <Text style={styles.name} numberOfLines={1}>
            {contact.name}
          </Text>
          <Text style={styles.phone} numberOfLines={1}>
            {formatPhoneDisplay(contact.phone)}
          </Text>
          <View style={styles.metaRow}>
            <BadgeChip label={contact.reason} variant={URGENCY_VARIANT[contact.urgency]} style={styles.chip} />
            {hasHistory ? (
              <View style={styles.expandHint}>
                <Text style={styles.expandHintText}>
                  {history.length} {history.length === 1 ? "call" : "calls"}
                </Text>
                <Feather
                  name={expanded ? "chevron-up" : "chevron-down"}
                  size={16}
                  color={theme.colors.textTertiary}
                />
              </View>
            ) : null}
          </View>
        </View>

        <TouchableOpacity
          style={[styles.callButton, disabled && styles.callButtonDisabled]}
          onPress={() => onCall(contact)}
          disabled={disabled}
          activeOpacity={0.85}
          accessibilityLabel={`Call ${contact.name}`}
        >
          <Feather name="phone" size={20} color={theme.colors.card} />
        </TouchableOpacity>
      </TouchableOpacity>

      {expanded && hasHistory ? (
        <View style={styles.historySection}>
          <Text style={styles.historyTitle}>Call history</Text>
          {recentCalls.map((item) => (
            <View key={item.id || item.call_id} style={styles.historyRow}>
              <View style={[styles.timelineDot, { backgroundColor: theme.colors.border }]} />
              <View style={styles.historyBody}>
                <Text style={styles.historySummary}>{composeCallSummary(item)}</Text>
                <Text style={styles.historyWhen}>{formatWhen(item.started_at)}</Text>
              </View>
            </View>
          ))}
          {history.length > MAX_VISIBLE_CALLS ? (
            <Text style={styles.historyMore}>+{history.length - MAX_VISIBLE_CALLS} earlier</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadow.card,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: theme.spacing.card,
    gap: theme.spacing.md,
  },
  rankBadge: {
    alignItems: "center",
    width: 18,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginBottom: 4,
  },
  rankText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.textTertiary,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: theme.fontSize.md,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: theme.fontSize.md,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.textPrimary,
  },
  phone: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
  },
  metaRow: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
  },
  chip: {
    marginTop: 0,
  },
  expandHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  expandHintText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.textTertiary,
  },
  callButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
    ...theme.shadow.button,
  },
  callButtonDisabled: {
    opacity: 0.45,
  },
  historySection: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingHorizontal: theme.spacing.card,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.md,
  },
  historyTitle: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.textTertiary,
    textTransform: "uppercase",
    letterSpacing: theme.letterSpacing.wide,
    marginBottom: theme.spacing.sm,
  },
  historyRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 5,
  },
  historyBody: {
    flex: 1,
  },
  historySummary: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textPrimary,
    lineHeight: 18,
  },
  historyWhen: {
    marginTop: 1,
    fontSize: theme.fontSize.xs,
    color: theme.colors.textTertiary,
  },
  historyMore: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
});
