import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import PriorityCard from "../components/PriorityCard";
import { EmptyState, ScreenChrome, ScreenHeader } from "../components/ui";
import { useRootNavigation } from "../navigation/useRootNavigation";
import { useAgentStatus } from "../state/AgentStatusContext";
import { AuthError, clearToken, getCallHistory, getToken, initiateOutboundCall } from "../services/api";
import { fetchUltraChatContacts, normalizeWhatsAppPhone } from "../services/ultrachatChatApi";
import { rankPriorityContacts, type PriorityContact } from "../services/dialIntelligence";
import type { ChatContact } from "../services/chatData";
import type { CallHistoryItem } from "../types";
import { theme } from "../theme";

export default function SmartCallScreen() {
  const rootNavigation = useRootNavigation();
  const { isOnBreak } = useAgentStatus();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState("");
  const [calls, setCalls] = useState<CallHistoryItem[]>([]);
  const [chats, setChats] = useState<ChatContact[]>([]);

  const load = useCallback(
    async (withRefresh: boolean) => {
      try {
        if (withRefresh) setRefreshing(true);
        else setLoading(true);
        setError("");

        const token = await getToken();
        if (!token) {
          rootNavigation.replace("Login");
          return;
        }

        const history = await getCallHistory(token, { page: 1, limit: 50 });
        setCalls(history.calls ?? []);

        // Chats enrich the ranking but must never break the screen.
        try {
          const contacts = await fetchUltraChatContacts(1, 50);
          setChats(contacts);
        } catch {
          setChats([]);
        }
      } catch (e) {
        if (e instanceof AuthError) {
          await clearToken();
          rootNavigation.replace("Login");
          return;
        }
        setError(e instanceof Error ? e.message : "Unable to load suggestions");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [rootNavigation]
  );

  React.useEffect(() => {
    load(false);
  }, [load]);

  const priorities = useMemo(
    () => rankPriorityContacts({ calls, chats, now: Date.now(), limit: 12 }),
    [calls, chats]
  );

  const callsByPhone = useMemo(() => {
    const map = new Map<string, CallHistoryItem[]>();
    for (const c of calls) {
      const key = normalizeWhatsAppPhone(c.phone_number || "");
      const bucket = map.get(key);
      if (bucket) bucket.push(c);
      else map.set(key, [c]);
    }
    return map;
  }, [calls]);

  const handleCall = useCallback(
    async (contact: PriorityContact) => {
      if (isOnBreak) {
        setError("End your break before placing a call.");
        return;
      }
      try {
        setCalling(true);
        setError("");
        const token = await getToken();
        if (!token) {
          rootNavigation.replace("Login");
          return;
        }
        const result = await initiateOutboundCall(token, {
          phone_number: contact.phone,
          customer_name: contact.name,
          handler: "human",
          verification_context: { handler: "human" },
        });
        rootNavigation.navigate("HumanCall", {
          callId: result.call_id,
          phone: contact.phone,
          customerName: contact.name,
        });
      } catch (e) {
        if (e instanceof AuthError) {
          await clearToken();
          rootNavigation.replace("Login");
          return;
        }
        setError(e instanceof Error ? e.message : "Unable to start call");
      } finally {
        setCalling(false);
      }
    },
    [isOnBreak, rootNavigation]
  );

  return (
    <ScreenChrome>
      <View style={styles.container}>
        <ScreenHeader title="Call now" subtitle="Ranked by who's most worth calling right now" />

        {isOnBreak ? (
          <View style={styles.breakBanner}>
            <Text style={styles.breakText}>You're on a break — end it to place calls.</Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        ) : (
          <FlatList
            data={priorities}
            keyExtractor={(item) => item.phone}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={theme.colors.primary} />
            }
            contentContainerStyle={[styles.listContent, priorities.length === 0 && styles.center]}
            renderItem={({ item, index }) => (
              <PriorityCard
                contact={item}
                rank={index + 1}
                history={callsByPhone.get(item.phone) ?? []}
                onCall={handleCall}
                disabled={isOnBreak || calling}
              />
            )}
            ListEmptyComponent={
              <EmptyState icon="check-circle" message="No calls need attention right now. Nice work!" />
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
  listContent: {
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing["3xl"],
    gap: theme.spacing.sm,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  breakBanner: {
    marginTop: theme.spacing.sm,
    backgroundColor: theme.colors.warningSoft,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
  },
  breakText: {
    color: theme.colors.warning,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  errorCard: {
    marginTop: theme.spacing.sm,
    backgroundColor: theme.colors.errorSoft,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
  },
  errorText: {
    color: theme.colors.error,
    fontSize: theme.fontSize.sm,
  },
});
