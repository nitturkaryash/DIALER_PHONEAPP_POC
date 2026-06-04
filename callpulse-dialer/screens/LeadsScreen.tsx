import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { CampaignsStackParamList } from "../navigation/types";
import { useRootNavigation } from "../navigation/useRootNavigation";
import { AuthError, getLeads, getToken } from "../services/api";
import { useAgentStatus } from "../state/AgentStatusContext";
import { theme } from "../theme";
import type { Lead } from "../types";

type Props = NativeStackScreenProps<CampaignsStackParamList, "Leads">;

export default function LeadsScreen({ route, navigation }: Props) {
  const rootNavigation = useRootNavigation();
  const { processId, processName, handler } = route.params;
  const { isOnBreak } = useAgentStatus();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [leads, setLeads] = useState<Lead[]>([]);

  const load = async () => {
    try {
      setLoading(true);
      setError("");
      const token = await getToken();
      if (!token) {
        rootNavigation.replace("Login");
        return;
      }
      const data = await getLeads(token, processId, "pending");
      setLeads(data);
    } catch (e) {
      if (e instanceof AuthError) {
        rootNavigation.replace("Login");
        return;
      }
      setError(e instanceof Error ? e.message : "Unable to load leads");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [processId]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return leads;
    return leads.filter(
      (lead) => lead.name.toLowerCase().includes(term) || lead.phone.toLowerCase().includes(term)
    );
  }, [leads, query]);

  const handleCall = (item: Lead) => {
    if (isOnBreak) {
      setError("End your break before placing a call.");
      return;
    }
    rootNavigation.navigate("Call", { processId, processName, lead: item, handler });
  };

  return (
    <LinearGradient
      colors={theme.colors.backgroundGradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.gradient}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => navigation.navigate("CampaignList")}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Back to campaigns"
          >
            <Feather name="arrow-left" size={20} color={theme.colors.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>
              {processName}
            </Text>
            {handler ? (
              <Text style={styles.subtitle}>
                {handler === "human" ? "Live agent dial" : "AI bot dial"}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.searchWrap}>
          <Feather name="search" size={16} color={theme.colors.textTertiary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search leads..."
            placeholderTextColor={theme.colors.textTertiary}
            style={styles.searchInput}
          />
          {query.length > 0 ? (
            <TouchableOpacity onPress={() => setQuery("")} hitSlop={8}>
              <Feather name="x" size={16} color={theme.colors.textTertiary} />
            </TouchableOpacity>
          ) : null}
        </View>

        {isOnBreak ? (
          <View style={styles.breakBanner}>
            <Text style={styles.breakBannerText}>
              You're on break — end the break before dialing.
            </Text>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Text style={styles.error}>{error}</Text>
            <TouchableOpacity activeOpacity={0.85} style={styles.retryBtn} onPress={load}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => {
              const pending = item.status.toLowerCase() === "pending";
              return (
                <View style={styles.card}>
                  <View style={styles.cardLeft}>
                    <Text style={styles.name}>{item.name}</Text>
                    <Text style={styles.phone}>{item.phone}</Text>
                  </View>
                  <View style={styles.cardRight}>
                    <View
                      style={[
                        styles.statusDot,
                        { backgroundColor: pending ? theme.colors.success : theme.colors.textTertiary },
                      ]}
                    />
                    <TouchableOpacity
                      activeOpacity={0.85}
                      style={[styles.callBtn, isOnBreak && styles.callBtnDisabled]}
                      disabled={isOnBreak}
                      onPress={() => handleCall(item)}
                    >
                      <Feather name="phone" size={18} color="#fff" />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }}
            ListEmptyComponent={<Text style={styles.empty}>No leads found</Text>}
          />
        )}
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  container: { flex: 1, paddingHorizontal: theme.spacing.screen, paddingTop: theme.spacing.xl },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.card,
    alignItems: "center",
    justifyContent: "center",
    ...theme.shadow.card,
  },
  title: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.textPrimary,
  },
  subtitle: {
    marginTop: 2,
    fontSize: theme.fontSize.xs,
    color: theme.colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: theme.letterSpacing.wide,
  },
  searchWrap: {
    height: 48,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.card,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing.lg,
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.lg,
    ...theme.shadow.card,
  },
  searchInput: {
    flex: 1,
    color: theme.colors.textPrimary,
    fontSize: theme.fontSize.base,
    paddingVertical: 0,
  },
  breakBanner: {
    backgroundColor: theme.colors.warningSoft,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  breakBannerText: {
    color: theme.colors.warning,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { paddingBottom: theme.spacing["3xl"] },
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.xl,
    padding: theme.spacing.card,
    marginBottom: theme.spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    ...theme.shadow.card,
  },
  cardLeft: { flex: 1, marginRight: theme.spacing.md },
  cardRight: { alignItems: "center", gap: theme.spacing.sm },
  name: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textPrimary,
    fontWeight: theme.fontWeight.medium,
  },
  phone: {
    marginTop: theme.spacing.xs,
    fontSize: theme.fontSize.sm,
    color: theme.colors.textTertiary,
  },
  statusDot: { width: 8, height: 8, borderRadius: theme.radius.full },
  callBtn: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  callBtnDisabled: {
    opacity: 0.45,
  },
  error: { color: theme.colors.error, fontSize: theme.fontSize.sm },
  retryBtn: {
    marginTop: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.primary,
  },
  retryText: { color: theme.colors.card, fontWeight: theme.fontWeight.medium },
  empty: {
    color: theme.colors.textSecondary,
    textAlign: "center",
    marginTop: theme.spacing.xl,
  },
});
