import React from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { useAgentStatus } from "../state/AgentStatusContext";
import { theme } from "../theme";

type Props = {
  onPress: () => void;
  compact?: boolean;
};

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s}`;
  return `${m}:${s}`;
}

export default function BreakTimeButton({ onPress, compact = false }: Props) {
  const { isOnBreak, currentCode, elapsedSeconds, loading } = useAgentStatus();

  if (loading && !currentCode) {
    return (
      <View style={[styles.button, styles.buttonIdle, compact && styles.buttonCompact]}>
        <ActivityIndicator size="small" color={theme.colors.primary} />
      </View>
    );
  }

  if (isOnBreak) {
    return (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="End break"
        onPress={onPress}
        style={[styles.button, styles.buttonActive, compact && styles.buttonCompact]}
      >
        <View style={styles.dotActive} />
        <Text style={styles.activeLabel} numberOfLines={1}>
          {currentCode?.label || currentCode?.code || "On break"} · {formatElapsed(elapsedSeconds)}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel="Take a break"
      onPress={onPress}
      style={[styles.button, styles.buttonIdle, compact && styles.buttonCompact]}
    >
      <Text style={styles.idleLabel}>Take break</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.full,
    borderWidth: 1,
  },
  buttonCompact: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
  },
  buttonIdle: {
    backgroundColor: theme.colors.card,
    borderColor: theme.colors.border,
  },
  buttonActive: {
    backgroundColor: theme.colors.warningSoft,
    borderColor: theme.colors.warning,
  },
  dotActive: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.warning,
  },
  idleLabel: {
    color: theme.colors.textSecondary,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  activeLabel: {
    color: theme.colors.warning,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
});
