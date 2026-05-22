import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { ScreenChrome, StatusPanel } from "../components/ui";
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
  }, [onLoggedOut, rootNavigation]);

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
    <ScreenChrome>
      <View style={styles.container}>
        <Pressable onPress={goToDashboard} style={({ pressed }) => [styles.backRow, pressed && styles.pressed]}>
          <Text style={styles.backText}>← Dashboard</Text>
        </Pressable>

        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.title}>Campaigns</Text>
            <Text style={styles.subtitle}>{agent?.full_name || "Agent"}</Text>
            <View style={styles.roleBadge}>
              <Text style={styles.roleBadgeText}>{(agent?.role || "agent").toUpperCase()}</Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            onPress={handleLogout}
            style={({ pressed }) => [styles.avatar, pressed && styles.pressed]}
          >
            <Text style={styles.avatarText}>{initials || "AG"}</Text>
          </Pressable>
        </View>

        {loading || error ? (
          <StatusPanel loading={loading} error={error} onRetry={load} />
        ) : (
          <FlatList
            data={campaigns}
            keyExtractor={(item) => item.id}
            numColumns={2}
            columnWrapperStyle={styles.row}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={<StatusPanel empty="No campaigns assigned yet." />}
            renderItem={({ item }) => {
              const active = item.status.toLowerCase() === "active";
              return (
                <Pressable
                  style={({ pressed }) => [styles.campaignCard, pressed && styles.pressed]}
                  onPress={() =>
                    navigation.navigate("Leads", { processId: item.id, processName: item.name })
                  }
                >
                  <Text style={styles.cardTitle} numberOfLines={2}>
                    {item.name}
                  </Text>
                  <View style={[styles.statusBadge, active ? styles.statusActive : styles.statusPaused]}>
                    <Text style={[styles.statusText, active ? styles.statusTextActive : styles.statusTextPaused]}>
                      {active ? "Active" : "Paused"}
                    </Text>
                  </View>
                  <Text style={styles.leadCount}>{item.lead_count} leads</Text>
                </Pressable>
              );
            }}
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
    paddingTop: theme.spacing.xl,
  },
  pressed: {
    opacity: 0.88,
  },
  backRow: {
    alignSelf: "flex-start",
    marginBottom: theme.spacing.lg,
    paddingVertical: theme.spacing.xs,
  },
  backText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.primary,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.textPrimary,
    letterSpacing: theme.letterSpacing.tight,
  },
  subtitle: {
    marginTop: theme.spacing.xs,
    fontSize: theme.fontSize.base,
    color: theme.colors.textSecondary,
  },
  roleBadge: {
    marginTop: theme.spacing.sm,
    alignSelf: "flex-start",
    backgroundColor: theme.colors.surfaceMuted,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 4,
  },
  roleBadgeText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textSecondary,
    fontWeight: theme.fontWeight.semibold,
    letterSpacing: theme.letterSpacing.caps,
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
    fontSize: theme.fontSize.sm,
  },
  listContent: {
    paddingBottom: theme.spacing["3xl"],
    flexGrow: 1,
  },
  row: {
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  campaignCard: {
    width: "48%",
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.card,
    marginBottom: theme.spacing.md,
    ...theme.shadow.card,
  },
  cardTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.textPrimary,
    minHeight: 44,
    lineHeight: 22,
  },
  statusBadge: {
    marginTop: theme.spacing.md,
    alignSelf: "flex-start",
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: theme.radius.full,
  },
  statusActive: {
    backgroundColor: theme.colors.successSoft,
  },
  statusPaused: {
    backgroundColor: theme.colors.surfaceMuted,
  },
  statusText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    letterSpacing: theme.letterSpacing.wide,
  },
  statusTextActive: {
    color: theme.colors.success,
  },
  statusTextPaused: {
    color: theme.colors.textSecondary,
  },
  leadCount: {
    marginTop: theme.spacing.md,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.textSecondary,
  },
});
