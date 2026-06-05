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

import { LinearGradient } from "expo-linear-gradient";

import BreakTimeButton from "../components/BreakTimeButton";
import { HomeContactsSection } from "../components/HomeContactsSection";
import { BadgeChip, PrimaryButton, ScreenChrome, ScreenHeader } from "../components/ui";
import { useRootNavigation } from "../navigation/useRootNavigation";
import type { ChatContact } from "../services/chatData";
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
  const rootNavigation = useRootNavigation();
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

  const openContactChat = (contact: ChatContact) => {
    rootNavigation.navigate("ChatDetail", {
      contactId: contact.id,
      contactName: contact.name,
      contactPhone: contact.phone,
      contactInitials: contact.initials,
      contactOnline: contact.online,
    });
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
        <ScreenHeader
          title="Home"
          subtitle={agent?.display_name || agent?.full_name || agent?.email || "Agent"}
          right={
            <>
              <BreakTimeButton onPress={() => navigation.navigate("AgentStatus")} compact />
              <PrimaryButton label="Logout" onPress={handleLogout} variant="ghost" />
            </>
          }
        />

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
            <LinearGradient
              colors={theme.colors.heroGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.heroCard}
            >
              <Text style={styles.heroTitle}>Today</Text>
              <Text style={styles.heroMetric}>{todaysCalls.length}</Text>
              <Text style={styles.heroSub}>Calls placed today</Text>
              <View style={styles.heroBadges}>
                <BadgeChip label={`Completed ${completedToday}`} variant="success" />
                <BadgeChip label={`Talk ${formatDuration(talkTimeToday)}`} variant="neutral" />
              </View>
            </LinearGradient>

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

            <HomeContactsSection
              onOpenChat={openContactChat}
              onViewAll={() => navigation.navigate("Chats")}
            />

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

            <PrimaryButton
              label="Open campaigns"
              onPress={() => navigation.navigate("Campaigns", { screen: "CampaignList" })}
              size="lg"
              style={styles.primaryAction}
            />
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
  center: { paddingVertical: theme.spacing["3xl"], alignItems: "center" },
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.xl,
    padding: theme.spacing.card,
    marginTop: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadow.card,
  },
  heroCard: {
    borderRadius: theme.radius.xl,
    padding: theme.spacing.card,
    marginTop: theme.spacing.sm,
    ...theme.shadow.card,
  },
  heroTitle: {
    fontSize: theme.fontSize.sm,
    color: "rgba(255,255,255,0.85)",
    fontWeight: theme.fontWeight.medium,
    textTransform: "uppercase",
    letterSpacing: theme.letterSpacing.wide,
  },
  heroMetric: {
    marginTop: theme.spacing.sm,
    fontSize: 40,
    fontWeight: theme.fontWeight.bold,
    color: "#FFFFFF",
    letterSpacing: theme.letterSpacing.tight,
  },
  heroSub: {
    fontSize: theme.fontSize.sm,
    color: "rgba(255,255,255,0.8)",
  },
  heroBadges: {
    flexDirection: "row",
    marginTop: theme.spacing.md,
    gap: theme.spacing.sm,
    flexWrap: "wrap",
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
    borderWidth: 1,
    borderColor: theme.colors.border,
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
