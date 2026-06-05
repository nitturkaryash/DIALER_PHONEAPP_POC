import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { Feather } from "@expo/vector-icons";

import { formatTime, type ChatContact } from "../services/chatData";
import {
  applyStreamToContacts,
  fetchUltraChatContacts,
  formatPhoneDisplay,
  subscribeUltraChatStream,
} from "../services/ultrachatChatApi";
import { ULTRACHAT_BUSINESS_PHONE, ULTRACHAT_DEMO_ENABLED } from "../services/ultrachatConfig";
import type { RootStackParamList } from "../navigation/types";
import { theme } from "../theme";

const chat = theme.colors.chat;
const AVATAR_COLORS = ["#4A7C6F", "#3D6B5C", "#5A8A7A", "#2E5A4A", "#6B9E8F", "#4E7A6A"];

const AVATAR_BG = (id: string) => AVATAR_COLORS[id.charCodeAt(id.length - 1) % AVATAR_COLORS.length];

type Nav = NativeStackNavigationProp<RootStackParamList>;

function ActiveStrip({ contacts }: { contacts: ChatContact[] }) {
  const strip = contacts.slice(0, 7);
  if (!strip.length) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.stripContent}
    >
      {strip.map((c) => (
        <View key={c.id} style={styles.stripItem}>
          <View style={[styles.stripAvatar, { backgroundColor: AVATAR_BG(c.id) }]}>
            <Text style={styles.stripAvatarText}>{c.initials}</Text>
            {c.unread > 0 && <View style={styles.stripDot} />}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function ChatRow({ item, onPress }: { item: ChatContact; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.avatarWrap}>
        <View style={[styles.avatar, { backgroundColor: AVATAR_BG(item.id) }]}>
          <Text style={styles.avatarText}>{item.initials}</Text>
        </View>
        {item.online && <View style={styles.onlineDot} />}
      </View>

      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.rowName} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={[styles.rowTime, item.unread > 0 && styles.rowTimeUnread]}>
            {formatTime(item.lastMessageTime)}
          </Text>
        </View>
        <View style={styles.rowBottom}>
          <Text
            style={[styles.rowPreview, item.unread > 0 && styles.rowPreviewBold]}
            numberOfLines={1}
          >
            {item.lastMessage}
          </Text>
          {item.unread > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{item.unread}</Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

export default function ChatsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const [search, setSearch] = useState("");
  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadContacts = useCallback(async (query?: string, silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError("");
      const list = await fetchUltraChatContacts(1, 30, query);
      setContacts(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load chats");
      if (!silent) setContacts([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const isSearch = Boolean(search.trim());
    const delay = isSearch ? 400 : 0;
    const t = setTimeout(() => void loadContacts(search, isSearch), delay);
    return () => clearTimeout(t);
  }, [search, loadContacts]);

  useEffect(() => {
    if (search.trim()) return undefined;

    const sub = subscribeUltraChatStream({
      onEvent: (_name, payload) => {
        setContacts((prev) => applyStreamToContacts(prev, payload) ?? prev);
      },
      onError: () => {
        void loadContacts(undefined, true);
      },
    });

    return () => sub.close();
  }, [search, loadContacts]);

  useFocusEffect(
    useCallback(() => {
      if (search.trim()) return undefined;
      const poll = setInterval(() => {
        void loadContacts(undefined, true);
      }, 6000);
      return () => clearInterval(poll);
    }, [search, loadContacts])
  );

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Chats</Text>
          <Pressable style={styles.menuBtn} onPress={() => void loadContacts(search, true)}>
            <Feather name="refresh-cw" size={20} color="#fff" />
          </Pressable>
        </View>

        {ULTRACHAT_DEMO_ENABLED && (
          <Text style={styles.demoBanner}>
            Account: The Connections · WABA {formatPhoneDisplay(ULTRACHAT_BUSINESS_PHONE)}
            {"\n"}Open a customer from the list below to reply (not this number).
          </Text>
        )}

        <View style={styles.searchBar}>
          <Feather name="search" size={18} color="rgba(255,255,255,0.65)" />
          <TextInput
            style={[
              styles.searchInput,
              Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null,
            ]}
            placeholder="Search"
            placeholderTextColor="rgba(255,255,255,0.55)"
            value={search}
            onChangeText={setSearch}
          />
        </View>

        <ActiveStrip contacts={contacts} />
      </View>

      <View style={styles.sheet}>
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={chat.header} />
          </View>
        ) : error ? (
          <View style={styles.centered}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={() => void loadContacts(search, false)}>
              <Text style={styles.retryText}>Tap to retry</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            data={contacts}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={styles.divider} />}
            renderItem={({ item }) => (
              <ChatRow
                item={item}
                onPress={() =>
                  navigation.navigate("ChatDetail", {
                    contactId: item.id,
                    contactName: item.name,
                    contactPhone: item.phone,
                    contactInitials: item.initials,
                    contactOnline: item.online,
                  })
                }
              />
            )}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No chats found</Text>
              </View>
            }
          />
        )}
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.fab,
          { bottom: insets.bottom + 72 },
          pressed && styles.fabPressed,
        ]}
        onPress={() => void loadContacts(search, true)}
        accessibilityLabel="Refresh chats"
      >
        <Feather name="refresh-cw" size={22} color={chat.unreadText} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: chat.header },
  header: {
    backgroundColor: chat.header,
    paddingHorizontal: theme.spacing.screen,
    paddingBottom: 0,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  title: {
    fontSize: theme.fontSize["2xl"],
    fontWeight: theme.fontWeight.bold,
    color: "#FFFFFF",
    letterSpacing: theme.letterSpacing.tight,
  },
  demoBanner: {
    fontSize: 11,
    color: "rgba(255,255,255,0.75)",
    marginBottom: 10,
    lineHeight: 16,
  },
  menuBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: chat.searchBg,
    alignItems: "center",
    justifyContent: "center",
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    backgroundColor: chat.searchBg,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.lg,
    height: 48,
    marginBottom: theme.spacing.lg,
  },
  searchInput: { flex: 1, fontSize: theme.fontSize.base, color: "#FFFFFF" },
  stripContent: { paddingBottom: 20, paddingRight: 4, gap: 12 },
  stripItem: {},
  stripAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2.5,
    borderColor: "rgba(255,255,255,0.25)",
  },
  stripAvatarText: { fontSize: 17, fontWeight: "700", color: "#FFF" },
  stripDot: {
    position: "absolute",
    bottom: 2,
    right: 2,
    width: 13,
    height: 13,
    borderRadius: 7,
    backgroundColor: chat.unread,
    borderWidth: 2,
    borderColor: chat.header,
  },
  sheet: {
    flex: 1,
    backgroundColor: chat.sheet,
    borderTopLeftRadius: theme.radius["2xl"],
    borderTopRightRadius: theme.radius["2xl"],
    overflow: "hidden",
    paddingTop: 8,
  },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  errorText: { fontSize: theme.fontSize.base, color: theme.colors.textSecondary, textAlign: "center", marginBottom: 8 },
  retryText: { fontSize: theme.fontSize.base, color: chat.header, fontWeight: theme.fontWeight.semibold },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing.screen,
    paddingVertical: theme.spacing.md + 2,
    backgroundColor: chat.sheet,
    gap: theme.spacing.md,
  },
  rowPressed: { backgroundColor: theme.colors.surfaceMuted },
  avatarWrap: { width: 52, height: 52 },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 18, fontWeight: "700", color: "#FFF" },
  onlineDot: {
    position: "absolute",
    bottom: 1,
    right: 1,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: chat.online,
    borderWidth: 2.5,
    borderColor: chat.sheet,
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  rowName: {
    fontSize: theme.fontSize.md,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.textPrimary,
    flex: 1,
    marginRight: 8,
  },
  rowTime: { fontSize: theme.fontSize.sm, color: theme.colors.textTertiary },
  rowTimeUnread: { color: chat.header, fontWeight: theme.fontWeight.semibold },
  rowBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rowPreview: { fontSize: theme.fontSize.base, color: theme.colors.textSecondary, flex: 1, marginRight: 8 },
  rowPreviewBold: { color: theme.colors.textPrimary, fontWeight: theme.fontWeight.medium },
  badge: {
    backgroundColor: chat.unread,
    borderRadius: 12,
    minWidth: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  badgeText: { fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.bold, color: chat.unreadText },
  divider: { height: 1, backgroundColor: theme.colors.border, marginLeft: 86 },
  empty: { alignItems: "center", paddingTop: 60 },
  emptyText: { fontSize: theme.fontSize.base, color: theme.colors.textSecondary },
  fab: {
    position: "absolute",
    alignSelf: "center",
    left: "50%",
    marginLeft: -28,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: chat.unread,
    alignItems: "center",
    justifyContent: "center",
    ...theme.shadow.button,
  },
  fabPressed: { opacity: 0.88 },
});
