import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../navigation/types";
import {
  AuthError,
  getOutboundCallStatus,
  getToken,
  hangupCall,
  initiateOutboundCall,
} from "../services/api";
import { theme } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Call">;

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
  const mins = Math.floor(seconds / 60).toString().padStart(2, "0");
  const secs = (seconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

function formatStatusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Campaign-mode call bootstrapper. Initiates the outbound call against the
 * Voice-Assisstant-Backend and then:
 *   - for handler="human" → replaces to HumanCall (audio bridge over WebSocket)
 *   - for handler="ai" → stays here, polls status, hangup → disposition
 */
export default function CallScreen({ route, navigation }: Props) {
  const { lead, processId, processName, handler = "ai" } = route.params;
  const [loading, setLoading] = useState(true);
  const [callId, setCallId] = useState("");
  const [status, setStatus] = useState("queued");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const initRef = useRef(false);

  // Initiate the call exactly once.
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    let mounted = true;
    (async () => {
      try {
        const token = await getToken();
        if (!token) {
          navigation.replace("Login");
          return;
        }
        const result = await initiateOutboundCall(token, {
          phone_number: lead.phone,
          customer_name: lead.name,
          customer_id: lead.id || undefined,
          handler,
          verification_context: {
            campaign_id: processId,
            campaign_contact_id: lead.id || undefined,
            handler,
          },
        });
        if (!mounted) return;
        if (handler === "human") {
          navigation.replace("HumanCall", {
            callId: result.call_id,
            phone: lead.phone,
            customerName: lead.name,
          });
          return;
        }
        setCallId(result.call_id);
        setLoading(false);
      } catch (e) {
        if (e instanceof AuthError) {
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
    };
  }, [handler, lead, processId, navigation]);

  // Elapsed timer once the call_id is known.
  useEffect(() => {
    if (!callId) return;
    const interval = setInterval(() => setElapsed((prev) => prev + 1), 1000);
    return () => clearInterval(interval);
  }, [callId]);

  // Poll AI-handler call status.
  useEffect(() => {
    if (!callId || handler === "human") return;
    let mounted = true;
    let interval: ReturnType<typeof setInterval> | undefined;

    const poll = async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const data = await getOutboundCallStatus(token, callId);
        if (!mounted) return;
        setStatus(data.status);
        if (TERMINAL_STATUSES.has(data.status.toLowerCase())) {
          if (interval) clearInterval(interval);
        }
      } catch {
        // best-effort
      }
    };

    poll();
    interval = setInterval(poll, 2000);
    return () => {
      mounted = false;
      if (interval) clearInterval(interval);
    };
  }, [callId, handler]);

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
      if (callId) {
        await hangupCall(token, callId).catch(() => undefined);
      }
      navigation.replace("Disposition", {
        callId,
        processId,
        processName,
        lead,
        returnTo: "leads",
      });
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
        <Text style={styles.name}>{lead.name}</Text>
        <Text style={styles.meta}>
          {lead.phone} • {processName}
        </Text>
        {!!status && <Text style={styles.statusBadge}>{formatStatusLabel(status)}</Text>}

        <View style={styles.avatarWrap}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials || "LD"}</Text>
          </View>
        </View>

        {loading ? (
          <ActivityIndicator color={theme.colors.primary} style={styles.timer} />
        ) : (
          <Text style={styles.timer}>{formatTimer(elapsed)}</Text>
        )}

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
            <Feather name="phone-off" size={28} color="#fff" />
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
    fontWeight: theme.fontWeight.semibold,
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
  spacer: { width: 40 },
  endBtn: {
    width: 72,
    height: 72,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.error,
    alignItems: "center",
    justifyContent: "center",
    ...theme.shadow.card,
  },
  hint: {
    marginTop: theme.spacing.lg,
    fontSize: theme.fontSize.sm,
    color: theme.colors.textTertiary,
  },
});
