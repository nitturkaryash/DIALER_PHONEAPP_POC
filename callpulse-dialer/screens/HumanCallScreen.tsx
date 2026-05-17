import React, { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { useHumanAgentCall } from "../hooks/useHumanAgentCall";
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

export default function HumanCallScreen({ route, navigation }: Props) {
  const { callId, phone, customerName, livekitUrl, agentToken, roomName } = route.params;
  const [elapsed, setElapsed] = useState(0);
  const [ending, setEnding] = useState(false);

  const { connectionState, callStatus, muted, error, toggleMute, hangup } = useHumanAgentCall({
    callId,
    livekitUrl,
    agentToken,
    roomName,
  });

  React.useEffect(() => {
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

  const statusLabel = useMemo(() => {
    if (connectionState === "connecting") return "Connecting…";
    if (connectionState === "error") return "Connection failed";
    if (callStatus === "in_progress" || callStatus === "connected") return "Connected";
    return formatStatusLabel(callStatus);
  }, [callStatus, connectionState]);

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
        callMode: "human",
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
      <View style={styles.container}>
        <Text style={styles.label}>Live call</Text>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <Text style={styles.name}>{customerName}</Text>
        <Text style={styles.phone}>{phone}</Text>
        <Text style={styles.status}>{statusLabel}</Text>
        <Text style={styles.timer}>{formatTimer(elapsed)}</Text>

        {connectionState === "connecting" ? (
          <ActivityIndicator color={theme.colors.primary} style={styles.spinner} />
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Text style={styles.hint}>
          {connectionState === "connected"
            ? "Speak into your microphone — customer audio plays automatically"
            : "Joining LiveKit room…"}
        </Text>

        <View style={styles.controls}>
          <TouchableOpacity
            style={[styles.controlBtn, muted && styles.controlBtnActive]}
            onPress={() => toggleMute().catch(() => undefined)}
            disabled={connectionState !== "connected"}
          >
            <Text style={styles.controlText}>{muted ? "Unmute" : "Mute"}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.hangupBtn, ending && styles.hangupDisabled]}
            onPress={() => endCall().catch(() => undefined)}
            disabled={ending}
          >
            {ending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.hangupText}>End call</Text>
            )}
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
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  label: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    marginBottom: 24,
    fontWeight: "500",
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  avatarText: { fontSize: 28, fontWeight: "600", color: "#fff" },
  name: { fontSize: 22, fontWeight: "600", color: theme.colors.textPrimary },
  phone: { fontSize: 16, color: theme.colors.textSecondary, marginTop: 4 },
  status: { fontSize: 15, color: theme.colors.primary, marginTop: 16, fontWeight: "500" },
  timer: { fontSize: 32, fontWeight: "600", color: theme.colors.textPrimary, marginTop: 8 },
  spinner: { marginTop: 16 },
  hint: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    textAlign: "center",
    marginTop: 12,
    paddingHorizontal: 16,
  },
  error: {
    color: theme.colors.error,
    marginTop: 8,
    textAlign: "center",
    fontSize: 13,
  },
  controls: {
    flexDirection: "row",
    gap: 12,
    marginTop: 32,
    width: "100%",
    maxWidth: 360,
  },
  controlBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: theme.colors.card,
    alignItems: "center",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  controlBtnActive: {
    borderColor: theme.colors.primary,
  },
  controlText: { fontSize: 15, fontWeight: "500", color: theme.colors.textPrimary },
  hangupBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: theme.colors.error,
    alignItems: "center",
    justifyContent: "center",
  },
  hangupDisabled: { opacity: 0.7 },
  hangupText: { fontSize: 15, fontWeight: "600", color: "#fff" },
});
