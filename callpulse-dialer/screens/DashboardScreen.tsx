import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { CompositeScreenProps } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import BreakTimeButton from "../components/BreakTimeButton";
import { ScreenChrome } from "../components/ui";
import type { MainTabParamList, RootStackParamList } from "../navigation/types";
import {
  AuthError,
  getAgentStatusSummary,
  getCallHistory,
  getCampaigns,
  getMe,
  getToken,
  logout,
} from "../services/api";
import { theme } from "../theme";
import type {
  Agent,
  AgentStatusSummaryItem,
  Campaign,
  CallHistoryItem,
  CallHistorySummary,
} from "../types";

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, "Dashboard">,
  NativeStackScreenProps<RootStackParamList>
> & {
  onLoggedOut: () => void;
};

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "0m";
  if (seconds < 60) return `${seconds}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function isToday(value?: string | null): boolean {
  if (!value) return false;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  return (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  );
}

export default function DashboardScreen({ navigation, onLoggedOut }: Props) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [agent, setAgent] = useState<Agent | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [historySummary, setHistorySummary] = useState<CallHistorySummary | null>(null);
  const [recentCalls, setRecentCalls] = useState<CallHistoryItem[]>([]);
  const [statusSummary, setStatusSummary] = useState<AgentStatusSummaryItem[]>([]);

  const load = useCallback(
    async (showRefresh = false) => {
      try {
        if (showRefresh) setRefreshing(true);
        else setLoading(true);
        setError("");

        const token = await getToken();
        if (!token) {
          onLoggedOut();
          navigation.replace("Login");
          return;
        }

        const [me, campaignList, history, statusSum] = await Promise.all([
          getMe(token),
          getCampaigns(token).catch(() => [] as Campaign[]),
          getCallHistory(token, { page: 1, limit: 25 }).catch(() => null),
          getAgentStatusSummary(token).catch(() => [] as AgentStatusSummaryItem[]),
        ]);

        setAgent(me);
        setCampaigns(campaignList);
        setHistorySummary(history?.summary ?? null);
        setRecentCalls(history?.calls ?? []);
        setStatusSummary(statusSum);
      } catch (e) {
        if (e instanceof AuthError) {
          onLoggedOut();
          navigation.replace("Login");
          return;
        }
        setError(e instanceof Error ? e.message : "Unable to load dashboard");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [navigation, onLoggedOut]
  );

  React.useEffect(() => {
    load(false);
  }, [load]);

  const handleLogout = async () => {
    await logout();
    onLoggedOut();
    navigation.replace("Login");
  };

  const todaysCalls = useMemo(() => recentCalls.filter((c) => isToday(c.started_at)), [recentCalls]);
  const completedToday = useMemo(
    () => todaysCalls.filter((c) => c.status?.toLowerCase() === "completed").length,
    [todaysCalls]
  );
  const talkTimeToday = useMemo(
    () => todaysCalls.reduce((acc, c) => acc + (c.duration_seconds || 0), 0),
    [todaysCalls]
  );

  const activeCampaignCount = useMemo(
    () => campaigns.filter((c) => (c.status || "").toLowerCase() === "active").length,
    [campaigns]
  );

  return (
    <ScreenChrome>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={theme.colors.primary} />
        }
      >
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Agent Dashboard</Text>
            <Text style={styles.subtitle}>
              {agent?.display_name || agent?.full_name || agent?.email || "Agent"}
            </Text>
          </View>
          <View style={styles.headerActions}>
            <BreakTimeButton onPress={() => navigation.navigate("AgentStatus")} compact />
            <TouchableOpacity style={styles.headerAction} activeOpacity={0.85} onPress={handleLogout}>
              <Text style={styles.headerActionText}>Logout</Text>
            </TouchableOpacity>
          </View>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        ) : error ? (
          <View style={styles.card}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => load(false)}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.heroCard}>
              <Text style={styles.heroTitle}>Today</Text>
              <Text style={styles.heroMetric}>{todaysCalls.length}</Text>
              <Text style={styles.heroSub}>Calls placed today</Text>
              <View style={styles.heroBadges}>
                <View style={styles.badgeSuccess}>
                  <Text style={styles.badgeSuccessText}>Completed {completedToday}</Text>
                </View>
                <View style={styles.badgeNeutral}>
                  <Text style={styles.badgeNeutralText}>Talk time {formatDuration(talkTimeToday)}</Text>
                </View>
              </View>
            </View>

            <View style={styles.cardGrid}>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Assigned campaigns</Text>
                <Text style={styles.metricValue}>{campaigns.length}</Text>
                <Text style={styles.metricHint}>{activeCampaignCount} active</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>All-time calls</Text>
                <Text style={styles.metricValue}>{historySummary?.total_calls ?? 0}</Text>
                <Text style={styles.metricHint}>
                  {historySummary?.completed_calls ?? 0} completed
                </Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Total talk time</Text>
                <Text style={styles.metricValue}>
                  {formatDuration(historySummary?.total_duration_seconds ?? 0)}
                </Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Recent activity</Text>
                <Text style={styles.metricValue}>{recentCalls.length}</Text>
                <Text style={styles.metricHint}>last {recentCalls.length} calls</Text>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Today's calls</Text>
              {todaysCalls.length === 0 ? (
                <Text style={styles.emptyText}>No calls placed yet today.</Text>
              ) : (
                todaysCalls.slice(0, 5).map((call) => (
                  <TouchableOpacity
                    key={call.id || call.call_id}
                    style={styles.recentRow}
                    activeOpacity={0.85}
                    onPress={() => navigation.navigate("CallHistoryDetail", { callId: call.call_id })}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.recentName}>{call.customer_name || "Unknown"}</Text>
                      <Text style={styles.recentMeta}>
                        {call.phone_number || "-"} · {call.campaign_name || "Direct"}
                      </Text>
                    </View>
                    <Text style={styles.recentStatus}>{call.status}</Text>
                  </TouchableOpacity>
                ))
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Break time summary</Text>
              {statusSummary.length === 0 ? (
                <Text style={styles.emptyText}>No break time recorded yet.</Text>
              ) : (
                statusSummary.map((item) => (
                  <View key={`${item.code}-${item.label}`} style={styles.rowItem}>
                    <Text style={styles.rowLabel}>{item.label}</Text>
                    <Text style={styles.rowValue}>{formatDuration(item.duration_seconds)}</Text>
                  </View>
                ))
              )}
            </View>

            <TouchableOpacity
              style={styles.primaryAction}
              onPress={() => navigation.navigate("Campaigns", { screen: "CampaignList" })}
            >
              <Text style={styles.primaryActionText}>Open Campaigns</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  container: {
    paddingHorizontal: theme.spacing.screen,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing["3xl"],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: theme.spacing.lg,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  title: {
    fontSize: theme.fontSize.xl,
    fontWeight: "600",
    color: theme.colors.textPrimary,
  },
  subtitle: {
    marginTop: theme.spacing.xs,
    fontSize: theme.fontSize.base,
    color: theme.colors.textSecondary,
  },
  headerAction: {
    borderRadius: theme.radius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    backgroundColor: theme.colors.card,
  },
  headerActionText: {
    color: theme.colors.textSecondary,
    fontSize: theme.fontSize.sm,
    fontWeight: "500",
  },
  center: { paddingVertical: theme.spacing["3xl"], alignItems: "center" },
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.xl,
    padding: theme.spacing.card,
    marginTop: theme.spacing.md,
    ...theme.shadow.card,
  },
  heroCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.xl,
    padding: theme.spacing.card,
    marginTop: theme.spacing.sm,
    ...theme.shadow.card,
  },
  heroTitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    fontWeight: "500",
  },
  heroMetric: {
    marginTop: theme.spacing.sm,
    fontSize: theme.fontSize["2xl"],
    fontWeight: "700",
    color: theme.colors.textPrimary,
  },
  heroSub: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
  },
  heroBadges: {
    flexDirection: "row",
    marginTop: theme.spacing.md,
    gap: theme.spacing.sm,
    flexWrap: "wrap",
  },
  badgeSuccess: {
    backgroundColor: "#ECFDF5",
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  badgeSuccessText: {
    color: theme.colors.success,
    fontWeight: "500",
    fontSize: theme.fontSize.sm,
  },
  badgeNeutral: {
    backgroundColor: theme.colors.surfaceMuted,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  badgeNeutralText: {
    color: theme.colors.textSecondary,
    fontWeight: "500",
    fontSize: theme.fontSize.sm,
  },
  cardGrid: {
    marginTop: theme.spacing.md,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  metricCard: {
    width: "48%",
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    ...theme.shadow.card,
  },
  metricLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
  },
  metricValue: {
    marginTop: theme.spacing.xs,
    fontSize: theme.fontSize.lg,
    fontWeight: "600",
    color: theme.colors.textPrimary,
  },
  metricHint: {
    marginTop: 2,
    fontSize: theme.fontSize.xs,
    color: theme.colors.textTertiary,
  },
  cardTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: "600",
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.md,
  },
  recentRow: {
    paddingVertical: theme.spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  recentName: {
    color: theme.colors.textPrimary,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  recentMeta: {
    marginTop: 2,
    color: theme.colors.textSecondary,
    fontSize: theme.fontSize.xs,
  },
  recentStatus: {
    color: theme.colors.primary,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    textTransform: "capitalize",
  },
  rowItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  rowLabel: {
    color: theme.colors.textSecondary,
    fontSize: theme.fontSize.sm,
  },
  rowValue: {
    color: theme.colors.textPrimary,
    fontWeight: "600",
    fontSize: theme.fontSize.sm,
  },
  emptyText: {
    color: theme.colors.textTertiary,
    fontSize: theme.fontSize.sm,
  },
  primaryAction: {
    marginTop: theme.spacing.lg,
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.full,
    paddingVertical: theme.spacing.md,
    alignItems: "center",
    ...theme.shadow.button,
  },
  primaryActionText: {
    color: theme.colors.card,
    fontSize: theme.fontSize.base,
    fontWeight: "600",
  },
  errorText: {
    color: theme.colors.error,
    fontSize: theme.fontSize.sm,
  },
  retryBtn: {
    marginTop: theme.spacing.md,
    alignSelf: "flex-start",
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
  },
  retryText: {
    color: theme.colors.card,
    fontWeight: "500",
  },
});
