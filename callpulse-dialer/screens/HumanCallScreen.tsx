import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { useWebRTCAgentCall } from "../hooks/useWebRTCAgentCall";
import type { RootStackParamList } from "../navigation/types";
import { theme } from "../theme";
import type { Lead } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "HumanCall">;

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

const STATE_DOT: Record<string, string> = {
  waiting: theme.colors.warning,
  connecting: theme.colors.warning,
  connected: theme.colors.success,
  disconnected: theme.colors.textTertiary,
  error: theme.colors.error,
  unavailable: theme.colors.textTertiary,
  idle: theme.colors.textTertiary,
};

export default function HumanCallScreen({ route, navigation }: Props) {
  const { callId, phone, customerName } = route.params;
  const [elapsed, setElapsed] = useState(0);
  const [ending, setEnding] = useState(false);

  const { connectionState, callStatus, muted, error, toggleMute, hangup } = useWebRTCAgentCall({
    callId,
  });

  useEffect(() => {
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

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

  // With WebRTC, native CAN work — but only in EAS dev builds, not in Expo Go.
  // The hook reports `unavailable` if it can't load the native module.
  const isNativeUnavailable = connectionState === "unavailable";

  const headerLabel = useMemo(() => {
    if (isNativeUnavailable) return "Call in progress on backend";
    if (connectionState === "connected") return "Live · you are connected";
    return "Live call";
  }, [isNativeUnavailable, connectionState]);

  const statusLabel = useMemo(() => {
    if (isNativeUnavailable) {
      const normalized = callStatus.toLowerCase();
      if (normalized === "queued" || normalized === "ringing") return "Ringing customer…";
      if (normalized === "in_progress") return "Customer connected";
      if (["completed", "ended"].includes(normalized)) return "Call ended";
      return formatStatusLabel(callStatus);
    }
    if (connectionState === "waiting") return `Waiting · ${formatStatusLabel(callStatus)}`;
    if (connectionState === "connecting") return "Connecting your microphone…";
    if (connectionState === "error") return "Audio bridge error";
    if (connectionState === "connected") return "Connected";
    return formatStatusLabel(callStatus);
  }, [callStatus, connectionState, isNativeUnavailable]);

  const endCall = async () => {
    if (ending) return;
    setEnding(true);
    try {
      await hangup();
    } finally {
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
    }
  };

  return (
    <LinearGradient
      colors={theme.colors.backgroundGradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.gradient}
    >
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <View style={[styles.statusDot, { backgroundColor: STATE_DOT[connectionState] || theme.colors.textTertiary }]} />
          <Text style={styles.headerLabel}>{headerLabel}</Text>
        </View>

        <View style={styles.avatarBlock}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <Text style={styles.name}>{customerName}</Text>
          <Text style={styles.phone}>{phone}</Text>
        </View>

        <View style={styles.statusBlock}>
          <Text style={styles.statusText}>{statusLabel}</Text>
          <Text style={styles.timer}>{formatTimer(elapsed)}</Text>
          {connectionState === "waiting" || connectionState === "connecting" ? (
            <ActivityIndicator color={theme.colors.primary} style={{ marginTop: theme.spacing.sm }} />
          ) : null}
        </View>

        {isNativeUnavailable ? (
          <View style={styles.platformNotice}>
            <Text style={styles.platformNoticeTitle}>📱 Dev build chahiye</Text>
            <Text style={styles.platformNoticeBody}>
              Backend audio bridge ready hai aur customer connect ho gaya hai — par Expo Go
              react-native-webrtc native module load nahi kar sakta. Phone pe live calls ke liye
              ek **EAS development build** banao (one-time setup).{"\n\n"}
              Abhi demo ke liye laptop browser kholo:{"\n"}
              <Text style={styles.platformNoticeUrl}>http://localhost:8081</Text>{"\n\n"}
              Yahan se "End call" daba ke bridge close karo so customer ka silence call nahi rahega.
            </Text>
          </View>
        ) : error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Audio bridge issue</Text>
            <Text style={styles.errorBody}>{error}</Text>
          </View>
        ) : connectionState === "connected" ? (
          <View style={styles.tipCard}>
            <Text style={styles.tipText}>
              🎙️ Speak into your microphone — customer audio plays automatically.
            </Text>
          </View>
        ) : (
          <View style={styles.tipCard}>
            <Text style={styles.tipText}>
              Audio bridge will open as soon as the customer's line connects.
            </Text>
          </View>
        )}

        <View style={styles.controls}>
          {!isNativeUnavailable && (
            <TouchableOpacity
              style={[styles.controlBtn, muted && styles.controlBtnActive]}
              onPress={() => toggleMute().catch(() => undefined)}
              disabled={connectionState !== "connected"}
              accessibilityRole="button"
              accessibilityLabel={muted ? "Unmute microphone" : "Mute microphone"}
            >
              <Feather
                name={muted ? "mic-off" : "mic"}
                size={18}
                color={
                  connectionState !== "connected"
                    ? theme.colors.textTertiary
                    : muted
                      ? theme.colors.primary
                      : theme.colors.textPrimary
                }
              />
              <Text style={[styles.controlText, connectionState !== "connected" && styles.controlTextDisabled]}>
                {muted ? "Unmute" : "Mute"}
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.hangupBtn, ending && styles.hangupDisabled, isNativeUnavailable && styles.hangupFull]}
            onPress={() => endCall().catch(() => undefined)}
            disabled={ending}
            accessibilityRole="button"
            accessibilityLabel="End call"
          >
            {ending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Feather name="phone-off" size={18} color="#fff" />
                <Text style={styles.hangupText}>End call</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  scroll: {
    flexGrow: 1,
    alignItems: "center",
    paddingHorizontal: theme.spacing.screen,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing["2xl"],
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.card,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs + 2,
    borderRadius: theme.radius.full,
    ...theme.shadow.card,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  headerLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    fontWeight: theme.fontWeight.semibold,
  },
  avatarBlock: {
    alignItems: "center",
    marginTop: theme.spacing.xl,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: theme.spacing.md,
    ...theme.shadow.button,
  },
  avatarText: { fontSize: 32, fontWeight: "700", color: "#fff" },
  name: { fontSize: theme.fontSize.xl, fontWeight: theme.fontWeight.semibold, color: theme.colors.textPrimary },
  phone: { fontSize: theme.fontSize.base, color: theme.colors.textSecondary, marginTop: 2 },
  statusBlock: {
    alignItems: "center",
    marginTop: theme.spacing.lg,
  },
  statusText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.primary,
    fontWeight: theme.fontWeight.medium,
  },
  timer: {
    fontSize: 36,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.textPrimary,
    marginTop: 4,
    letterSpacing: 0.5,
  },
  platformNotice: {
    marginTop: theme.spacing.xl,
    width: "100%",
    maxWidth: 480,
    backgroundColor: theme.colors.warningSoft,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.warning,
    borderRadius: theme.radius.md,
    padding: theme.spacing.lg,
  },
  platformNoticeTitle: {
    color: theme.colors.warning,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    marginBottom: theme.spacing.sm,
  },
  platformNoticeBody: {
    color: theme.colors.textPrimary,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  platformNoticeUrl: {
    color: theme.colors.primary,
    fontWeight: theme.fontWeight.semibold,
  },
  errorCard: {
    marginTop: theme.spacing.xl,
    width: "100%",
    maxWidth: 480,
    backgroundColor: theme.colors.errorSoft,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.error,
    borderRadius: theme.radius.md,
    padding: theme.spacing.lg,
  },
  errorTitle: {
    color: theme.colors.error,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    marginBottom: 4,
  },
  errorBody: {
    color: theme.colors.textPrimary,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  tipCard: {
    marginTop: theme.spacing.xl,
    width: "100%",
    maxWidth: 480,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    ...theme.shadow.card,
  },
  tipText: {
    color: theme.colors.textSecondary,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
    lineHeight: 20,
  },
  controls: {
    marginTop: theme.spacing.xl,
    flexDirection: "row",
    gap: theme.spacing.md,
    width: "100%",
    maxWidth: 480,
  },
  controlBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.card,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  controlBtnActive: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.primarySoft,
  },
  controlText: { fontSize: theme.fontSize.base, fontWeight: theme.fontWeight.semibold, color: theme.colors.textPrimary },
  controlTextDisabled: { color: theme.colors.textTertiary },
  hangupBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.error,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  hangupFull: { flex: 2 },
  hangupDisabled: { opacity: 0.7 },
  hangupText: { fontSize: theme.fontSize.base, fontWeight: theme.fontWeight.bold, color: "#fff" },
});
