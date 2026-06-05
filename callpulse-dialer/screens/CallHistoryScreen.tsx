import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";

import { EmptyState, ScreenChrome, ScreenHeader } from "../components/ui";
import { useRootNavigation } from "../navigation/useRootNavigation";
import { AuthError, clearToken, getCallHistory, getToken } from "../services/api";
import { theme } from "../theme";
import type { CallHistoryItem, CallHistorySummary } from "../types";

const STATUS_FILTERS = ["all", "completed", "failed", "ringing"] as const;

function formatDuration(seconds?: number | null): string {
  if (!seconds || seconds <= 0) return "0m";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${secs}s`;
}

function formatStartTime(value?: string | null): string {
  if (!value) return "No start time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No start time";
  return date.toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function statusColor(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === "completed") return theme.colors.success;
  if (normalized === "failed") return theme.colors.error;
  if (normalized === "ringing") return theme.colors.warning;
  return theme.colors.textSecondary;
}

export default function CallHistoryScreen() {
  const rootNavigation = useRootNavigation();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("all");
  const [items, setItems] = useState<CallHistoryItem[]>([]);
  const [summary, setSummary] = useState<CallHistorySummary | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const load = useCallback(
    async (withRefresh: boolean, targetPage = 1) => {
      try {
        if (withRefresh) {
          setRefreshing(true);
        } else if (targetPage > 1) {
          setLoadingMore(true);
        } else {
          setLoading(true);
        }
        setError("");

        const token = await getToken();
        if (!token) {
          rootNavigation.replace("Login");
          return;
        }

        const response = await getCallHistory(token, {
          page: targetPage,
          limit: 20,
          search: searchQuery.trim(),
          status: status === "all" ? "" : status,
        });

        const incoming = response.calls ?? [];
        setItems((prev) => (targetPage > 1 ? [...prev, ...incoming] : incoming));
        setSummary(response.summary ?? null);
        setPage(response.pagination?.page ?? targetPage);
        setTotalPages(response.pagination?.total_pages ?? 1);
      } catch (e) {
        if (e instanceof AuthError) {
          await clearToken();
          rootNavigation.replace("Login");
          return;
        }
        setError(e instanceof Error ? e.message : "Unable to load call history");
      } finally {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    },
    [rootNavigation, searchQuery, status]
  );

  React.useEffect(() => {
    load(false);
  }, [load]);

  const onEndReached = useCallback(() => {
    if (loading || loadingMore || refreshing) return;
    if (page >= totalPages) return;
    load(false, page + 1);
  }, [load, loading, loadingMore, page, refreshing, totalPages]);

  const completionRate = useMemo(() => {
    if (!summary || !summary.total_calls) return "0%";
    return `${Math.round((summary.completed_calls / summary.total_calls) * 100)}%`;
  }, [summary]);

  return (
    <ScreenChrome>
      <View style={styles.container}>
        <ScreenHeader title="Call history" subtitle="Outcomes, duration, and recent activity" />

        <View style={styles.summaryRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Total calls</Text>
            <Text style={styles.metricValue}>{summary?.total_calls ?? 0}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Completed</Text>
            <Text style={styles.metricValue}>{summary?.completed_calls ?? 0}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Completion</Text>
            <Text style={styles.metricValue}>{completionRate}</Text>
          </View>
        </View>

        <View style={styles.searchWrap}>
          <Feather name="search" size={18} color={theme.colors.textTertiary} />
          <TextInput
            value={searchInput}
            onChangeText={setSearchInput}
            onSubmitEditing={() => setSearchQuery(searchInput)}
            placeholder="Phone, customer, or call ID"
            placeholderTextColor={theme.colors.textTertiary}
            style={styles.searchInput}
            returnKeyType="search"
          />
          <TouchableOpacity style={styles.searchButton} onPress={() => setSearchQuery(searchInput)} activeOpacity={0.9}>
            <Text style={styles.searchButtonText}>Go</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.filterRow}>
          {STATUS_FILTERS.map((value) => {
            const active = status === value;
            return (
              <TouchableOpacity
                key={value}
                onPress={() => setStatus(value)}
                style={[styles.filterChip, active && styles.filterChipActive]}
                activeOpacity={0.9}
              >
                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{value}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        ) : error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={() => load(false)}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => item.id || item.call_id}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={theme.colors.primary} />}
            contentContainerStyle={[styles.listContent, items.length === 0 && styles.center]}
            renderItem={({ item, index }: { item: CallHistoryItem; index: number }) => (
              <TouchableOpacity
                style={styles.rowCard}
                activeOpacity={0.9}
                onPress={() =>
                  rootNavigation.navigate("LeadTimeline", {
                    contactId: String(item.id ?? item.call_id ?? index),
                    contactName: item.customer_name ?? "Unknown",
                    contactPhone: item.phone_number ?? "",
                  })
                }
              >
                <View style={styles.rowTop}>
                  <Text style={styles.customer}>{item.customer_name || "Unknown"}</Text>
                  <Text style={[styles.status, { color: statusColor(item.status) }]}>{item.status}</Text>
                </View>
                <Text style={styles.meta}>{item.phone_number || "-"}</Text>
                <Text style={styles.meta}>{item.campaign_name || "Direct / No campaign"}</Text>
                <View style={styles.rowBottom}>
                  <Text style={styles.meta}>{formatStartTime(item.started_at)}</Text>
                  <View style={styles.rowRight}>
                    <Text style={styles.duration}>{formatDuration(item.duration_seconds)}</Text>
                    <Text style={styles.openLabel}>Open</Text>
                  </View>
                </View>
              </TouchableOpacity>
            )}
            onEndReachedThreshold={0.5}
            onEndReached={onEndReached}
            ListFooterComponent={
              loadingMore ? (
                <View style={styles.footerLoader}>
                  <ActivityIndicator color={theme.colors.primary} />
                </View>
              ) : page < totalPages ? (
                <TouchableOpacity style={styles.loadMoreButton} onPress={() => load(false, page + 1)} activeOpacity={0.9}>
                  <Text style={styles.loadMoreText}>Load more</Text>
                </TouchableOpacity>
              ) : null
            }
            ListEmptyComponent={
              <EmptyState icon="phone-off" message="No calls match this filter. Try another status or search." />
            }
          />
        )}
      </View>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: theme.spacing.screen,
    paddingTop: theme.spacing.lg,
  },
  summaryRow: {
    marginTop: 0,
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  metricCard: {
    flex: 1,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadow.card,
  },
  metricLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textSecondary,
  },
  metricValue: {
    marginTop: theme.spacing.xs,
    fontSize: theme.fontSize.lg,
    color: theme.colors.textPrimary,
    fontWeight: "600",
  },
  searchWrap: {
    marginTop: theme.spacing.md,
    flexDirection: "row",
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.lg,
    height: 48,
    alignItems: "center",
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadow.card,
  },
  searchInput: {
    flex: 1,
    color: theme.colors.textPrimary,
    fontSize: theme.fontSize.base,
  },
  searchButton: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  searchButtonText: {
    color: theme.colors.card,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  filterRow: {
    marginTop: theme.spacing.md,
    flexDirection: "row",
    gap: theme.spacing.sm,
    flexWrap: "wrap",
  },
  filterChip: {
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    backgroundColor: theme.colors.muted,
  },
  filterChipActive: {
    backgroundColor: theme.colors.primary,
  },
  filterChipText: {
    color: theme.colors.textSecondary,
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  filterChipTextActive: {
    color: theme.colors.card,
  },
  listContent: {
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing["3xl"],
    gap: theme.spacing.sm,
  },
  rowCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadow.card,
  },
  rowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  customer: {
    fontSize: theme.fontSize.md,
    color: theme.colors.textPrimary,
    fontWeight: "600",
    flex: 1,
    marginRight: theme.spacing.sm,
  },
  status: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  meta: {
    marginTop: theme.spacing.xs,
    color: theme.colors.textSecondary,
    fontSize: theme.fontSize.sm,
  },
  rowBottom: {
    marginTop: theme.spacing.sm,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rowRight: {
    alignItems: "flex-end",
  },
  duration: {
    color: theme.colors.textPrimary,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
  openLabel: {
    marginTop: 2,
    color: theme.colors.primary,
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    color: theme.colors.textSecondary,
    fontSize: theme.fontSize.base,
  },
  errorCard: {
    marginTop: theme.spacing.md,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.xl,
    padding: theme.spacing.card,
    ...theme.shadow.card,
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
  footerLoader: {
    paddingVertical: theme.spacing.md,
  },
  loadMoreButton: {
    alignSelf: "center",
    marginTop: theme.spacing.sm,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.card,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    ...theme.shadow.card,
  },
  loadMoreText: {
    color: theme.colors.primary,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
});
