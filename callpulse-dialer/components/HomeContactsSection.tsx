import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";

import { theme } from "../theme";
import { formatTime, type ChatContact } from "../services/chatData";
import {
  applyStreamToContacts,
  fetchUltraChatContacts,
  subscribeUltraChatStream,
} from "../services/ultrachatChatApi";

const AVATAR_COLORS = ["#4A7C6F", "#3D6B5C", "#5A8A7A", "#2E5A4A", "#6B9E8F", "#4E7A6A"];
const avatarBg = (id: string) => AVATAR_COLORS[id.charCodeAt(id.length - 1) % AVATAR_COLORS.length];

type Props = {
  onOpenChat: (contact: ChatContact) => void;
  onViewAll: () => void;
};

export function HomeContactsSection({ onOpenChat, onViewAll }: Props) {
  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError("");
      const list = await fetchUltraChatContacts(1, 8);
      setContacts(list);
    } catch (e) {
      if (!silent) setContacts([]);
      setError(e instanceof Error ? e.message : "Could not load contacts");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load(true);
      const sub = subscribeUltraChatStream({
        onEvent: (_name, payload) => {
          setContacts((prev) => applyStreamToContacts(prev, payload) ?? prev);
        },
      });
      const poll = setInterval(() => void load(true), 12_000);
      return () => {
        sub.close();
        clearInterval(poll);
      };
    }, [load])
  );

  const preview = contacts.slice(0, 5);
  const unreadTotal = contacts.reduce((sum, c) => sum + (c.unread || 0), 0);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Feather name="users" size={18} color={theme.colors.primary} />
          <Text style={styles.title}>Contacts</Text>
          {unreadTotal > 0 ? (
            <View style={styles.unreadPill}>
              <Text style={styles.unreadPillText}>{unreadTotal}</Text>
            </View>
          ) : null}
        </View>
        <TouchableOpacity onPress={onViewAll} hitSlop={8}>
          <Text style={styles.viewAll}>View all</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.subtitle}>Recent WhatsApp conversations</Text>

      {loading ? (
        <ActivityIndicator color={theme.colors.primary} style={styles.loader} />
      ) : error ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={() => void load(false)}>
            <Text style={styles.retry}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : preview.length === 0 ? (
        <Text style={styles.emptyText}>No contacts yet. Start chatting from the Chats tab.</Text>
      ) : (
        preview.map((item, index) => (
          <Pressable
            key={item.id}
            onPress={() => onOpenChat(item)}
            style={({ pressed }) => [
              styles.row,
              index < preview.length - 1 && styles.rowBorder,
              pressed && styles.rowPressed,
            ]}
          >
            <View style={[styles.avatar, { backgroundColor: avatarBg(item.id) }]}>
              <Text style={styles.avatarText}>{item.initials}</Text>
            </View>
            <View style={styles.rowBody}>
              <View style={styles.rowTop}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={[styles.time, item.unread > 0 && styles.timeUnread]}>
                  {formatTime(item.lastMessageTime)}
                </Text>
              </View>
              <View style={styles.rowBottom}>
                <Text
                  style={[styles.preview, item.unread > 0 && styles.previewUnread]}
                  numberOfLines={1}
                >
                  {item.lastMessage}
                </Text>
                {item.unread > 0 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{item.unread}</Text>
                  </View>
                ) : null}
              </View>
            </View>
            <Feather name="chevron-right" size={18} color={theme.colors.textTertiary} />
          </Pressable>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.xl,
    padding: theme.spacing.card,
    marginTop: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadow.card,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: theme.spacing.xs,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  title: {
    fontSize: theme.fontSize.md,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.textPrimary,
  },
  unreadPill: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: theme.colors.chat.unread,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  unreadPillText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.chat.unreadText,
  },
  viewAll: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.primary,
  },
  subtitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.md,
  },
  loader: { paddingVertical: theme.spacing.lg },
  emptyWrap: { alignItems: "center", paddingVertical: theme.spacing.md },
  emptyText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textTertiary,
    lineHeight: 20,
  },
  errorText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.error,
    textAlign: "center",
    marginBottom: theme.spacing.sm,
  },
  retry: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.primary,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.sm + 2,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  rowPressed: { opacity: 0.88 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.bold,
    color: "#fff",
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
  },
  name: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.textPrimary,
  },
  time: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textTertiary,
  },
  timeUnread: {
    color: theme.colors.primary,
    fontWeight: theme.fontWeight.semibold,
  },
  rowBottom: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
    gap: theme.spacing.sm,
  },
  preview: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSecondary,
  },
  previewUnread: {
    color: theme.colors.textPrimary,
    fontWeight: theme.fontWeight.medium,
  },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: theme.colors.chat.unread,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  badgeText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.chat.unreadText,
  },
});
