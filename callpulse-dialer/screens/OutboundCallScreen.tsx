import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../navigation/types";
import { AuthError, getOutboundCallStatus, getToken, hangupCall } from "../services/api";
import { theme } from "../theme";
import type { Lead } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "OutboundCall">;

const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "busy",
  "no_answer",
  "canceled",
  "cancelled",
  "ended",
]);

function formatTimer(seconds: number): string {
  const mins = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const secs = (seconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

function formatStatusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Read-only outbound monitor — used when we don't need the agent's microphone (AI-handler).
 * For agent-talks calls, use HumanCallScreen which opens the audio bridge WebSocket.
 */
export default function OutboundCallScreen({ route, navigation }: Props) {
  const { callId, phone, customerName } = route.params;
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState("queued");
  const [error, setError] = useState("");

  const initials = useMemo(
    () =>
      customerName
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase())
        .join("") || "MD",
    [customerName]
  );

  useEffect(() => {
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let mounted = true;
    let interval: ReturnType<typeof setInterval> | undefined;

    const poll = async () => {
      try {
        const token = await getToken();
        if (!token) {
          navigation.replace("Login");
          return;
        }
        const data = await getOutboundCallStatus(token, callId);
        if (!mounted) return;
        setStatus(data.status);
        if (TERMINAL_STATUSES.has(data.status.toLowerCase())) {
          if (interval) clearInterval(interval);
        }
      } catch (e) {
        if (!mounted) return;
        if (e instanceof AuthError) {
          navigation.replace("Login");
          return;
        }
        setError(e instanceof Error ? e.message : "Unable to fetch call status");
      }
    };

    poll();
    interval = setInterval(poll, 2000);
    return () => {
      mounted = false;
      if (interval) clearInterval(interval);
    };
  }, [callId, navigation]);

  const endCall = async () => {
    try {
      const token = await getToken();
      if (token && callId) {
        await hangupCall(token, callId).catch(() => undefined);
      }
    } catch {
      // ignore network errors on hangup
    }
    const lead: Lead = {
      id: "",
      name: customerName,
      phone,
      status: "pending",
    };
    navigation.replace("Disposition", {
      callId,
      lead,
      returnTo: "dial",
    });
  };

  return (
    <LinearGradient
      colors={theme.colors.backgroundGradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.gradient}
    >
      <View style={styles.container}>
        <Text style={styles.name}>{customerName}</Text>
        <Text style={styles.meta}>{phone}</Text>
        <Text style={styles.statusBadge}>{formatStatusLabel(status)}</Text>

        <View style={styles.avatarWrap}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
        </View>

        <Text style={styles.timer}>{formatTimer(elapsed)}</Text>
        {!!error && <Text style={styles.error}>{error}</Text>}

        <View style={styles.controls}>
          <View style={styles.spacer} />
          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.endBtn}
            onPress={endCall}
            accessibilityRole="button"
            accessibilityLabel="End call"
          >
            <Feather name="phone-off" size={26} color="#fff" />
          </TouchableOpacity>
          <View style={styles.spacer} />
        </View>
        <Text style={styles.hint}>End call to save disposition</Text>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  container: {
    flex: 1,
    paddingHorizontal: theme.spacing.screen,
    alignItems: "center",
    justifyContent: "center",
  },
  name: {
    fontSize: theme.fontSize.xl,
    color: theme.colors.textPrimary,
    fontWeight: "600",
    textAlign: "center",
  },
  meta: {
    marginTop: theme.spacing.sm,
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    textAlign: "center",
  },
  statusBadge: {
    marginTop: theme.spacing.md,
    fontSize: theme.fontSize.sm,
    fontWeight: "500",
    color: theme.colors.primary,
    backgroundColor: "rgba(111,163,210,0.12)",
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radius.full,
    overflow: "hidden",
  },
  avatarWrap: { marginTop: theme.spacing["2xl"], marginBottom: theme.spacing.xl },
  avatar: {
    width: 140,
    height: 140,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.card,
    justifyContent: "center",
    alignItems: "center",
    ...theme.shadow.card,
  },
  avatarText: {
    fontSize: theme.fontSize.xl,
    color: theme.colors.textPrimary,
    fontWeight: "600",
  },
  timer: {
    fontSize: theme.fontSize.lg,
    color: theme.colors.textSecondary,
    fontWeight: "500",
    marginBottom: theme.spacing.xl,
  },
  error: {
    color: theme.colors.error,
    fontSize: theme.fontSize.sm,
    marginBottom: theme.spacing.md,
    textAlign: "center",
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    gap: theme.spacing.xl,
  },
  spacer: { width: 40 },
  endBtn: {
    width: 72,
    height: 72,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.error,
    justifyContent: "center",
    alignItems: "center",
  },
  hint: {
    marginTop: theme.spacing.lg,
    fontSize: theme.fontSize.sm,
    color: theme.colors.textTertiary,
  },
});
