import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { CampaignsStackParamList } from "../navigation/types";
import { useRootNavigation } from "../navigation/useRootNavigation";
import { AuthError, clearToken, getCampaigns, getMe, getToken } from "../services/api";
import { theme } from "../theme";
import type { Agent, Campaign } from "../types";

type Props = NativeStackScreenProps<CampaignsStackParamList, "CampaignList"> & {
  onLoggedOut: () => void;
};

export default function CampaignScreen({ navigation, onLoggedOut }: Props) {
  const rootNavigation = useRootNavigation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [agent, setAgent] = useState<Agent | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const token = await getToken();
      if (!token) {
        onLoggedOut();
        rootNavigation.replace("Login");
        return;
      }
      const [me, list] = await Promise.all([getMe(token), getCampaigns(token)]);
      setAgent(me);
      setCampaigns(list);
    } catch (e) {
      if (e instanceof AuthError) {
        await clearToken();
        onLoggedOut();
        rootNavigation.replace("Login");
        return;
      }
      setError(e instanceof Error ? e.message : "Unable to load campaigns");
    } finally {
      setLoading(false);
    }
  }, [navigation, onLoggedOut]);

  useEffect(() => {
    load();
  }, [load]);

  const initials = useMemo(() => {
    const full = agent?.full_name || "";
    return full
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("");
  }, [agent?.full_name]);

  const handleLogout = async () => {
    await clearToken();
    onLoggedOut();
    rootNavigation.replace("Login");
  };

  const goToDashboard = () => {
    navigation.getParent()?.getParent()?.navigate("Dashboard");
  };

  return (
    <LinearGradient
      colors={theme.colors.backgroundGradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.gradient}
    >
      <View style={styles.container}>
        <TouchableOpacity activeOpacity={0.85} onPress={goToDashboard} style={styles.dashboardBackRow}>
          <Text style={styles.dashboardBackIcon}>←</Text>
          <Text style={styles.dashboardBackText}>Dashboard</Text>
        </TouchableOpacity>

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.title}>Campaigns</Text>
            <Text style={styles.subtitle}>{agent?.full_name || "Agent"}</Text>
            <View style={styles.roleBadge}>
              <Text style={styles.roleBadgeText}>{agent?.role || "agent"}</Text>
            </View>
          </View>
          <TouchableOpacity activeOpacity={0.85} onPress={handleLogout} style={styles.avatar}>
            <Text style={styles.avatarText}>{initials || "AG"}</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Text style={styles.error}>{error}</Text>
            <TouchableOpacity activeOpacity={0.85} onPress={load} style={styles.retryBtn}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={campaigns}
            keyExtractor={(item) => item.id}
            numColumns={2}
            columnWrapperStyle={styles.row}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => {
              const active = item.status.toLowerCase() === "active";
              return (
                <TouchableOpacity
                  activeOpacity={0.85}
                  style={styles.card}
                  onPress={() =>
                    navigation.navigate("Leads", { processId: item.id, processName: item.name })
                  }
                >
                  <Text style={styles.cardTitle} numberOfLines={2}>
                    {item.name}
                  </Text>

                  {/* Status badge */}
                  <View style={[styles.statusBadge, active ? styles.successBadge : styles.neutralBadge]}>
                    <Text style={[styles.statusText, active ? styles.successText : styles.neutralText]}>
                      {active ? "Active" : "Paused"}
                    </Text>
                  </View>

                  {/* Lead count pill — accent ONLY on active, neutral on paused */}
                  <View style={[styles.leadPill, !active && styles.leadPillNeutral]}>
                    <Text style={[styles.leadPillText, !active && styles.leadPillTextNeutral]}>
                      {item.lead_count} leads
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={<Text style={styles.empty}>No campaigns found</Text>}
          />
        )}
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  container: { flex: 1, paddingHorizontal: theme.spacing.screen, paddingTop: theme.spacing.xl },
  dashboardBackRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    marginBottom: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    gap: theme.spacing.xs,
  },
  dashboardBackIcon: {
    fontSize: theme.fontSize.lg,
    color: theme.colors.primary,
    lineHeight: 22,
  },
  dashboardBackText: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.primary,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: theme.spacing.xl,
  },
  headerLeft: { flex: 1 },
  title: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.textPrimary,
  },
  subtitle: {
    marginTop: theme.spacing.sm,
    fontSize: theme.fontSize.base,
    color: theme.colors.textSecondary,
  },
  roleBadge: {
    marginTop: theme.spacing.sm,
    alignSelf: "flex-start",
    backgroundColor: theme.colors.muted,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderWidth: 1,
    borderColor: "rgba(107,114,128,0.12)",
  },
  roleBadgeText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    fontWeight: theme.fontWeight.medium,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: {
    color: theme.colors.card,
    fontWeight: theme.fontWeight.semibold,
    fontSize: theme.fontSize.base,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  error: { color: theme.colors.error, fontSize: theme.fontSize.sm },
  retryBtn: {
    marginTop: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.primary,
  },
  retryText: { color: theme.colors.card, fontWeight: theme.fontWeight.medium },
  listContent: { paddingBottom: theme.spacing["3xl"] },
  row: { justifyContent: "space-between" },
  card: {
    width: "48%",
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.xl,       // fixed: xl (24px) per profile
    padding: theme.spacing.card,
    marginBottom: theme.spacing.lg,
    ...theme.shadow.card,
  },
  cardTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.textPrimary,
    minHeight: 40,
  },
  statusBadge: {
    marginTop: theme.spacing.md,
    alignSelf: "flex-start",
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radius.full,
    borderWidth: 1,
  },
  successBadge: { backgroundColor: "#F0FDF4", borderColor: "rgba(16,185,129,0.12)" },
  neutralBadge: { backgroundColor: theme.colors.muted, borderColor: "rgba(107,114,128,0.12)" },
  statusText: { fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.medium },
  successText: { color: theme.colors.success },
  neutralText: { color: theme.colors.textSecondary },
  // accent ONLY on active campaigns
  leadPill: {
    marginTop: theme.spacing.md,
    alignSelf: "flex-start",
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.accent,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  leadPillNeutral: {
    backgroundColor: theme.colors.muted,
  },
  leadPillText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.textPrimary,
  },
  leadPillTextNeutral: {
    color: theme.colors.textSecondary,
  },
  empty: {
    color: theme.colors.textSecondary,
    textAlign: "center",
    marginTop: theme.spacing.xl,
  },
});
