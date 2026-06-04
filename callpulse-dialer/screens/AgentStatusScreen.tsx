import React, { useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../navigation/types";
import { useAgentStatus } from "../state/AgentStatusContext";
import { theme } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "AgentStatus">;

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s}`;
  return `${m}:${s}`;
}

export default function AgentStatusScreen({ navigation }: Props) {
  const { codes, isOnBreak, currentCode, elapsedSeconds, selectCode, clearCurrent, loading, error } =
    useAgentStatus();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [actionError, setActionError] = useState("");

  const onSelect = async (codeId: string) => {
    setBusyId(codeId);
    setActionError("");
    try {
      await selectCode(codeId);
      navigation.goBack();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Unable to start break");
    } finally {
      setBusyId(null);
    }
  };

  const onClear = async () => {
    setClearing(true);
    setActionError("");
    try {
      await clearCurrent();
      navigation.goBack();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Unable to end break");
    } finally {
      setClearing(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>Close</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Agent status</Text>
        <View style={styles.backBtn} />
      </View>

      {isOnBreak ? (
        <View style={styles.activeCard}>
          <Text style={styles.activeLabel}>You're on break</Text>
          <Text style={styles.activeCode}>{currentCode?.label || currentCode?.code || "Break"}</Text>
          <Text style={styles.activeTime}>{formatElapsed(elapsedSeconds)} elapsed</Text>
          <TouchableOpacity style={styles.endBtn} onPress={onClear} disabled={clearing}>
            {clearing ? (
              <ActivityIndicator color={theme.colors.card} />
            ) : (
              <Text style={styles.endBtnText}>End break</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={styles.intro}>Pick a status to pause dialing. You can return to calls when you end the break.</Text>
      )}

      {!!actionError && <Text style={styles.error}>{actionError}</Text>}
      {!!error && !actionError && <Text style={styles.error}>{error}</Text>}

      <View style={styles.codeList}>
        {loading && codes.length === 0 ? (
          <ActivityIndicator color={theme.colors.primary} style={{ marginTop: theme.spacing.lg }} />
        ) : codes.length === 0 ? (
          <Text style={styles.empty}>
            No pause codes configured yet. Ask an admin to add them in the web dialer.
          </Text>
        ) : (
          codes.map((code) => {
            const busy = busyId === code.id;
            const isCurrent = isOnBreak && currentCode?.id === code.id;
            return (
              <TouchableOpacity
                key={code.id}
                style={[styles.codeRow, isCurrent && styles.codeRowActive]}
                onPress={() => onSelect(code.id)}
                disabled={busy || isOnBreak}
                activeOpacity={0.85}
              >
                <View>
                  <Text style={styles.codeName}>{code.label || code.code}</Text>
                  <Text style={styles.codeMeta}>{code.code}</Text>
                </View>
                {busy ? (
                  <ActivityIndicator color={theme.colors.primary} />
                ) : isCurrent ? (
                  <Text style={styles.activeBadge}>active</Text>
                ) : (
                  <Text style={styles.startLabel}>Start</Text>
                )}
              </TouchableOpacity>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: theme.spacing.screen,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing["3xl"],
    backgroundColor: theme.colors.bg,
    flexGrow: 1,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: theme.spacing.lg,
  },
  backBtn: {
    minWidth: 56,
  },
  backText: {
    color: theme.colors.primary,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  title: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.textPrimary,
  },
  intro: {
    color: theme.colors.textSecondary,
    fontSize: theme.fontSize.sm,
    marginBottom: theme.spacing.lg,
    lineHeight: 20,
  },
  activeCard: {
    backgroundColor: theme.colors.warningSoft,
    borderRadius: theme.radius.xl,
    padding: theme.spacing.card,
    marginBottom: theme.spacing.lg,
  },
  activeLabel: {
    color: theme.colors.warning,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  activeCode: {
    color: theme.colors.textPrimary,
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.semibold,
    marginTop: theme.spacing.xs,
  },
  activeTime: {
    color: theme.colors.textSecondary,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing.xs,
  },
  endBtn: {
    marginTop: theme.spacing.lg,
    backgroundColor: theme.colors.warning,
    borderRadius: theme.radius.full,
    paddingVertical: theme.spacing.md,
    alignItems: "center",
  },
  endBtnText: {
    color: theme.colors.card,
    fontWeight: theme.fontWeight.semibold,
  },
  codeList: {
    gap: theme.spacing.sm,
  },
  codeRow: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  codeRowActive: {
    borderColor: theme.colors.warning,
  },
  codeName: {
    color: theme.colors.textPrimary,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  codeMeta: {
    color: theme.colors.textTertiary,
    fontSize: theme.fontSize.xs,
    marginTop: 2,
    letterSpacing: theme.letterSpacing.caps,
  },
  startLabel: {
    color: theme.colors.primary,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  activeBadge: {
    color: theme.colors.warning,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    letterSpacing: theme.letterSpacing.caps,
  },
  empty: {
    color: theme.colors.textSecondary,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
    paddingVertical: theme.spacing.xl,
  },
  error: {
    color: theme.colors.error,
    fontSize: theme.fontSize.sm,
    marginBottom: theme.spacing.md,
  },
});
