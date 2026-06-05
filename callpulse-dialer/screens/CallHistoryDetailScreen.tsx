import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { CallRecordingSection } from "../components/CallRecordingSection";
import { ScreenChrome } from "../components/ui";
import type { RootStackParamList } from "../navigation/types";
import { AuthError, clearToken, getCallHistoryDetail, getToken } from "../services/api";
import { theme } from "../theme";
import type { CallHistoryDetail } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "CallHistoryDetail">;

function formatDateTime(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(seconds?: number | null): string {
  if (!seconds || seconds <= 0) return "0m";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

export default function CallHistoryDetailScreen({ route, navigation }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<CallHistoryDetail | null>(null);
  const { callId } = route.params;

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const token = await getToken();
      if (!token) {
        navigation.replace("Login");
        return;
      }
      const response = await getCallHistoryDetail(token, callId);
      setDetail(response.call);
    } catch (e) {
      if (e instanceof AuthError) {
        await clearToken();
        navigation.replace("Login");
        return;
      }
      setError(e instanceof Error ? e.message : "Unable to load call details");
    } finally {
      setLoading(false);
    }
  }, [callId, navigation]);

  React.useEffect(() => {
    load();
  }, [load]);

  return (
    <ScreenChrome>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()} activeOpacity={0.9}>
            <Feather name="arrow-left" size={20} color={theme.colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Call detail</Text>
          <View style={styles.backButtonPlaceholder} />
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        ) : error ? (
          <View style={styles.card}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={load}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : detail ? (
          <>
            <View style={styles.card}>
              <Text style={styles.name}>{detail.customer_name || "Unknown"}</Text>
              <Text style={styles.muted}>{detail.phone_number || "-"}</Text>
              <View style={styles.infoRow}>
                <Text style={styles.label}>Call ID</Text>
                <Text style={styles.value}>{detail.call_id}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.label}>Campaign</Text>
                <Text style={styles.value}>{detail.campaign_name || "Direct / No campaign"}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.label}>Started</Text>
                <Text style={styles.value}>{formatDateTime(detail.started_at)}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.label}>Ended</Text>
                <Text style={styles.value}>{formatDateTime(detail.ended_at)}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.label}>Duration</Text>
                <Text style={styles.value}>{formatDuration(detail.duration_seconds)}</Text>
              </View>
            </View>

            <CallRecordingSection audioUrl={detail.audio_url} />

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Transcript</Text>
              <Text style={styles.transcriptText}>
                {detail.transcription?.trim() || "Transcript not available for this call."}
              </Text>
            </View>
          </>
        ) : null}
      </ScrollView>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: theme.spacing.screen,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing["3xl"],
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: theme.spacing.md,
  },
  headerTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: "600",
    color: theme.colors.textPrimary,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.card,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadow.card,
  },
  backButtonPlaceholder: {
    width: 40,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing["3xl"],
  },
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.xl,
    padding: theme.spacing.card,
    marginTop: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadow.card,
  },
  name: {
    fontSize: theme.fontSize.md,
    fontWeight: "600",
    color: theme.colors.textPrimary,
  },
  muted: {
    marginTop: theme.spacing.xs,
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
  },
  infoRow: {
    marginTop: theme.spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  label: {
    color: theme.colors.textSecondary,
    fontSize: theme.fontSize.sm,
  },
  value: {
    color: theme.colors.textPrimary,
    fontSize: theme.fontSize.sm,
    fontWeight: "500",
    flexShrink: 1,
    textAlign: "right",
  },
  sectionTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: "600",
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.sm,
  },
  transcriptText: {
    color: theme.colors.textSecondary,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  errorText: {
    color: theme.colors.error,
    fontSize: theme.fontSize.sm,
  },
  retryButton: {
    marginTop: theme.spacing.md,
    alignSelf: "flex-start",
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.primary,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  retryText: {
    color: theme.colors.card,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
});
