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
import { ScreenChrome } from "../components/ui";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { CompositeScreenProps } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { MainTabParamList, RootStackParamList } from "../navigation/types";
import {
  AuthError,
  clearToken,
  getAgentConversionFunnel,
  getAgentDashboardSummary,
  getAgentDashboardTrends,
  getAgentFailureBreakdown,
  getMe,
  getToken,
} from "../services/api";
import { theme } from "../theme";
import type {
  Agent,
  AgentConversionFunnel,
  AgentDashboardSummary,
  AgentDashboardTrendPoint,
  AgentFailureBreakdown,
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

function TrendBars({ data }: { data: AgentDashboardTrendPoint[] }) {
  const maxCalls = useMemo(() => Math.max(...data.map((item) => item.calls), 1), [data]);

  return (
    <View style={styles.trendChartWrap}>
      {data.map((item) => {
        const day = item.date.slice(-2);
        const callHeight = Math.max(6, Math.round((item.calls / maxCalls) * 80));
        return (
          <View key={item.date} style={styles.trendBarItem}>
            <View style={[styles.trendBar, { height: callHeight }]} />
            <Text style={styles.trendBarLabel}>{day}</Text>
          </View>
        );
      })}
    </View>
  );
}

function FunnelRow({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const widthPercent = max > 0 ? Math.max(5, Math.round((value / max) * 100)) : 0;
  return (
    <View style={styles.funnelRow}>
      <View style={styles.funnelHeader}>
        <Text style={styles.funnelLabel}>{label}</Text>
        <Text style={styles.funnelValue}>{value}</Text>
      </View>
      <View style={styles.funnelTrack}>
        <View style={[styles.funnelFill, { width: `${widthPercent}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

export default function DashboardScreen({ navigation, onLoggedOut }: Props) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [agent, setAgent] = useState<Agent | null>(null);
  const [summary, setSummary] = useState<AgentDashboardSummary | null>(null);
  const [trends, setTrends] = useState<AgentDashboardTrendPoint[]>([]);
  const [breakdown, setBreakdown] = useState<AgentFailureBreakdown | null>(null);
  const [funnel, setFunnel] = useState<AgentConversionFunnel | null>(null);

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

        const [me, summaryData, trendsData, failureData, funnelData] = await Promise.all([
          getMe(token),
          getAgentDashboardSummary(token),
          getAgentDashboardTrends(token),
          getAgentFailureBreakdown(token),
          getAgentConversionFunnel(token),
        ]);

        setAgent(me);
        setSummary(summaryData);
        setTrends(trendsData.last_7_days);
        setBreakdown(failureData);
        setFunnel(funnelData);
      } catch (e) {
        if (e instanceof AuthError) {
          await clearToken();
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
    await clearToken();
    onLoggedOut();
    navigation.replace("Login");
  };

  const maxFunnelValue = Math.max(
    funnel?.attempted ?? 0,
    funnel?.connected ?? 0,
    funnel?.qualified ?? 0,
    funnel?.converted ?? 0,
    funnel?.lost ?? 0,
    1
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
            <Text style={styles.subtitle}>{agent?.full_name || "CallPulse Agent"}</Text>
          </View>
          <TouchableOpacity style={styles.headerAction} activeOpacity={0.85} onPress={handleLogout}>
            <Text style={styles.headerActionText}>Logout</Text>
          </TouchableOpacity>
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
              <Text style={styles.heroTitle}>Operational pulse</Text>
              <Text style={styles.heroMetric}>{summary?.total_calls ?? 0}</Text>
              <Text style={styles.heroSub}>Total calls handled</Text>
              <View style={styles.heroBadges}>
                <View style={styles.badgeSuccess}>
                  <Text style={styles.badgeSuccessText}>Connected {summary?.connected_calls ?? 0}</Text>
                </View>
                <View style={styles.badgeWarning}>
                  <Text style={styles.badgeWarningText}>Fatal {summary?.fatal_calls ?? 0}</Text>
                </View>
              </View>
            </View>

            <View style={styles.cardGrid}>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Quality Score</Text>
                <Text style={styles.metricValue}>{(summary?.quality_score_avg ?? 0).toFixed(1)}</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Conversion Rate</Text>
                <Text style={styles.metricValue}>{(summary?.conversion_rate ?? 0).toFixed(1)}%</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Talk Time</Text>
                <Text style={styles.metricValue}>{formatDuration(summary?.talk_time_total ?? 0)}</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Follow-ups Due</Text>
                <Text style={styles.metricValue}>{summary?.followups_due ?? 0}</Text>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>7-day call trend</Text>
              <TrendBars data={trends} />
              <View style={styles.trendStats}>
                <Text style={styles.trendStatText}>Connected: {summary?.connected_calls ?? 0}</Text>
                <Text style={styles.trendStatText}>Conversions: {summary?.conversion_count ?? 0}</Text>
                <Text style={styles.trendStatText}>Fatal: {summary?.fatal_calls ?? 0}</Text>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Conversion funnel</Text>
              <FunnelRow
                label="Attempted"
                value={funnel?.attempted ?? 0}
                max={maxFunnelValue}
                color={theme.colors.primary}
              />
              <FunnelRow
                label="Connected"
                value={funnel?.connected ?? 0}
                max={maxFunnelValue}
                color="#60A5FA"
              />
              <FunnelRow
                label="Qualified"
                value={funnel?.qualified ?? 0}
                max={maxFunnelValue}
                color={theme.colors.chartQualified}
              />
              <FunnelRow
                label="Converted"
                value={funnel?.converted ?? 0}
                max={maxFunnelValue}
                color={theme.colors.success}
              />
              <FunnelRow label="Lost" value={funnel?.lost ?? 0} max={maxFunnelValue} color={theme.colors.error} />
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Reason breakdown</Text>
              {(breakdown?.fatal_reasons ?? []).slice(0, 4).map((item) => (
                <View key={item.reason} style={styles.rowItem}>
                  <Text style={styles.rowLabel}>{item.reason}</Text>
                  <Text style={styles.rowValue}>{item.count}</Text>
                </View>
              ))}
              {(!breakdown || breakdown.fatal_reasons.length === 0) && (
                <Text style={styles.emptyText}>No fatal patterns captured yet.</Text>
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Coaching insights</Text>
              {(breakdown?.coaching_insights ?? []).map((line) => (
                <Text key={line} style={styles.insightText}>
                  • {line}
                </Text>
              ))}
              {(breakdown?.coaching_insights.length ?? 0) === 0 && (
                <Text style={styles.emptyText}>Insights will appear after more calls are analyzed.</Text>
              )}
            </View>

            <TouchableOpacity style={styles.primaryAction} onPress={() => navigation.navigate("Campaigns", { screen: "CampaignList" })}>
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
  badgeWarning: {
    backgroundColor: "#FEF2F2",
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  badgeWarningText: {
    color: theme.colors.error,
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
  cardTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: "600",
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.md,
  },
  trendChartWrap: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    height: 110,
  },
  trendBarItem: {
    width: "12%",
    alignItems: "center",
  },
  trendBar: {
    width: "70%",
    borderRadius: theme.radius.base,
    backgroundColor: theme.colors.primary,
  },
  trendBarLabel: {
    marginTop: theme.spacing.xs,
    color: theme.colors.textSecondary,
    fontSize: theme.fontSize.xs,
  },
  trendStats: {
    marginTop: theme.spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  trendStatText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textSecondary,
  },
  funnelRow: {
    marginBottom: theme.spacing.md,
  },
  funnelHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: theme.spacing.xs,
  },
  funnelLabel: {
    color: theme.colors.textSecondary,
    fontSize: theme.fontSize.sm,
  },
  funnelValue: {
    color: theme.colors.textPrimary,
    fontWeight: "500",
    fontSize: theme.fontSize.sm,
  },
  funnelTrack: {
    height: 8,
    borderRadius: theme.radius.full,
    backgroundColor: "#EEF2F7",
    overflow: "hidden",
  },
  funnelFill: {
    height: 8,
    borderRadius: theme.radius.full,
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
  insightText: {
    color: theme.colors.textSecondary,
    fontSize: theme.fontSize.sm,
    marginBottom: theme.spacing.sm,
    lineHeight: 20,
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
