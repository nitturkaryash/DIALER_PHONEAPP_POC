import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../navigation/types";
import { AuthError, clearToken, getToken, startCall, updateCallStatus } from "../services/api";
import { theme } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Call">;

function formatTimer(seconds: number): string {
  const mins = Math.floor(seconds / 60).toString().padStart(2, "0");
  const secs = (seconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

export default function CallScreen({ route, navigation }: Props) {
  const { lead, processId, processName } = route.params;
  const [loading, setLoading] = useState(true);
  const [callId, setCallId] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    let mounted = true;
    (async () => {
      try {
        const token = await getToken();
        if (!token) {
          navigation.replace("Login");
          return;
        }
        const session = await startCall(token, lead.id, processId);
        await updateCallStatus(token, session.call_id, "answered");
        if (!mounted) return;
        setCallId(session.call_id);
        setLoading(false);
        interval = setInterval(() => setElapsed((prev) => prev + 1), 1000);
      } catch (e) {
        if (e instanceof AuthError) {
          await clearToken();
          navigation.replace("Login");
          return;
        }
        if (mounted) {
          setError(e instanceof Error ? e.message : "Unable to start call");
          setLoading(false);
        }
      }
    })();
    return () => {
      mounted = false;
      if (interval) clearInterval(interval);
    };
  }, [lead.id, navigation, processId]);

  const initials = useMemo(
    () =>
      lead.name
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join(""),
    [lead.name]
  );

  const endCall = async () => {
    try {
      const token = await getToken();
      if (!token) {
        navigation.replace("Login");
        return;
      }
      if (callId) await updateCallStatus(token, callId, "ended");
      navigation.replace("Disposition", { callId, processId, processName, lead, returnTo: "leads" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to end call");
    }
  };

  return (
    <LinearGradient
      colors={theme.colors.backgroundGradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.gradient}
    >
      <View style={styles.container}>
        {/* Lead info */}
        <Text style={styles.name}>{lead.name}</Text>
        <Text style={styles.meta}>
          {lead.phone} • {processName}
        </Text>

        {/* Avatar circle */}
        <View style={styles.avatarWrap}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials || "LD"}</Text>
          </View>
        </View>

        {/* Timer / loading */}
        {loading ? (
          <ActivityIndicator color={theme.colors.primary} style={styles.timer} />
        ) : (
          <Text style={styles.timer}>{formatTimer(elapsed)}</Text>
        )}

        {!!error && <Text style={styles.error}>{error}</Text>}

        {/* Call controls */}
        <View style={styles.controls}>
          {/* Mute — 40×40 icon button */}
          <TouchableOpacity activeOpacity={0.85} style={styles.iconBtn}>
            <Text style={styles.iconBtnText}>🔇</Text>
          </TouchableOpacity>

          {/* Active call — primary gradient circle 72×72 */}
          <LinearGradient
            colors={theme.colors.primaryGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.callBtn}
          >
            <Text style={styles.callBtnIcon}>📞</Text>
          </LinearGradient>

          {/* End call — red circle 72×72 */}
          <TouchableOpacity activeOpacity={0.85} style={styles.endBtn} onPress={endCall}>
            <Text style={styles.endBtnIcon}>✕</Text>
          </TouchableOpacity>
        </View>
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
    fontWeight: theme.fontWeight.semibold,
    textAlign: "center",
  },
  meta: {
    marginTop: theme.spacing.sm,
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    textAlign: "center",
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
    fontWeight: theme.fontWeight.semibold,
  },
  timer: {
    fontSize: theme.fontSize.lg,
    color: theme.colors.textSecondary,
    fontWeight: theme.fontWeight.medium,
    marginBottom: theme.spacing.sm,
  },
  error: {
    marginTop: theme.spacing.sm,
    color: theme.colors.error,
    fontSize: theme.fontSize.sm,
  },
  controls: {
    marginTop: theme.spacing["3xl"],
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-evenly",
    alignItems: "center",
  },
  // 40×40 icon button (design profile spec)
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtnText: { fontSize: 16 },
  // 72×72 primary gradient circle
  callBtn: {
    width: 72,
    height: 72,
    borderRadius: theme.radius.full,
    alignItems: "center",
    justifyContent: "center",
    ...theme.shadow.button,
  },
  callBtnIcon: { fontSize: 28 },
  // 72×72 end call red circle
  endBtn: {
    width: 72,
    height: 72,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.error,
    alignItems: "center",
    justifyContent: "center",
    ...theme.shadow.card,
  },
  endBtnIcon: {
    fontSize: 26,
    color: theme.colors.card,
    fontWeight: theme.fontWeight.bold,
  },
});
