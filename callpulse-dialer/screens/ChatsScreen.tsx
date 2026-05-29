import React, { useState } from "react";
import {
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
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { mockChats, formatTime, type ChatContact } from "../services/chatData";
import type { RootStackParamList } from "../navigation/types";

// ── Design tokens (from design.json) ──────────────────────────────────────────
const C = {
  headerBg:      "#2E4A3E",   // dark forest green
  searchBg:      "#3D5C4E",   // slightly lighter green for search bar
  searchText:    "rgba(255,255,255,0.6)",
  headerText:    "#FFFFFF",
  listBg:        "#FFFFFF",   // white sheet
  rowBg:         "#FFFFFF",
  rowPressed:    "#F7F8F7",
  avatarColors:  ["#4A7C6F","#3D6B5C","#5A8A7A","#2E5A4A","#6B9E8F","#4E7A6A"],
  online:        "#3ECF6C",   // bright green dot
  unreadBg:      "#E8C99A",   // warm sand badge
  unreadText:    "#5C3D1A",
  fabBg:         "#E8C99A",   // warm sand FAB
  fabText:       "#2E4A3E",
  textPrimary:   "#111B21",
  textName:      "#1A2B25",
  textPreview:   "#8A9E96",
  textTime:      "#A0ADA8",
  textTimeUnread:"#2E4A3E",
  divider:       "#F0F4F2",
  deleteBtn:     "#2E4A3E",
};

const AVATAR_BG = (id: string) =>
  C.avatarColors[id.charCodeAt(id.length - 1) % C.avatarColors.length];

type Nav = NativeStackNavigationProp<RootStackParamList>;

// ── Active-contacts strip (horizontal scroll) ─────────────────────────────────
function ActiveStrip() {
  const active = mockChats.filter((c) => c.online);
  const all = [...active, ...mockChats.filter((c) => !c.online)].slice(0, 7);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.stripContent}
    >
      {all.map((c) => (
        <View key={c.id} style={styles.stripItem}>
          <View style={[styles.stripAvatar, { backgroundColor: AVATAR_BG(c.id) }]}>
            <Text style={styles.stripAvatarText}>{c.initials}</Text>
            {c.online && <View style={styles.stripDot} />}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

// ── Chat row ──────────────────────────────────────────────────────────────────
function ChatRow({ item, onPress }: { item: ChatContact; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      {/* Avatar */}
      <View style={styles.avatarWrap}>
        <View style={[styles.avatar, { backgroundColor: AVATAR_BG(item.id) }]}>
          <Text style={styles.avatarText}>{item.initials}</Text>
        </View>
        {item.online && <View style={styles.onlineDot} />}
      </View>

      {/* Body */}
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
          <Text style={[styles.rowTime, item.unread > 0 && styles.rowTimeUnread]}>
            {formatTime(item.lastMessageTime)}
          </Text>
        </View>
        <View style={styles.rowBottom}>
          <Text style={[styles.rowPreview, item.unread > 0 && styles.rowPreviewBold]} numberOfLines={1}>
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

// ── Screen ────────────────────────────────────────────────────────────────────
export default function ChatsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? mockChats.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.phone.includes(search)
      )
    : mockChats;

  return (
    <View style={styles.root}>
      {/* ── Green header section ── */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        {/* Title row */}
        <View style={styles.titleRow}>
          <Text style={styles.title}>Chats</Text>
          <Pressable style={styles.menuBtn}>
            <Text style={styles.menuIcon}>⋮</Text>
          </Pressable>
        </View>

        {/* Search bar */}
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search"
            placeholderTextColor={C.searchText}
            value={search}
            onChangeText={setSearch}
            {...(Platform.OS === "web" ? { style: [styles.searchInput, { outlineStyle: "none" } as object] } : {})}
          />
        </View>

        {/* Active contacts strip */}
        <ActiveStrip />
      </View>

      {/* ── White card sheet ── */}
      <View style={styles.sheet}>
        <FlatList
          data={filtered}
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
      </View>

      {/* ── Sand FAB ── */}
      <Pressable
        style={({ pressed }) => [
          styles.fab,
          { bottom: insets.bottom + 72 },
          pressed && styles.fabPressed,
        ]}
        onPress={() => {}}
      >
        <Text style={styles.fabIcon}>+</Text>
      </Pressable>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.headerBg },

  // Header
  header: {
    backgroundColor: C.headerBg,
    paddingHorizontal: 20,
    paddingBottom: 0,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: C.headerText,
    letterSpacing: -0.3,
  },
  menuBtn: { padding: 4 },
  menuIcon: { fontSize: 24, color: C.headerText, fontWeight: "700" },

  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.searchBg,
    borderRadius: 24,
    paddingHorizontal: 16,
    height: 44,
    marginBottom: 20,
  },
  searchIcon: { fontSize: 18, color: C.searchText, marginRight: 10 },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: "#FFFFFF",
  },

  // Active strip
  stripContent: {
    paddingBottom: 20,
    paddingRight: 4,
    gap: 12,
  },
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
    backgroundColor: C.online,
    borderWidth: 2,
    borderColor: C.headerBg,
  },

  // White sheet
  sheet: {
    flex: 1,
    backgroundColor: C.listBg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: "hidden",
    paddingTop: 8,
  },

  // Chat row
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: C.rowBg,
    gap: 14,
  },
  rowPressed: { backgroundColor: C.rowPressed },

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
    backgroundColor: C.online,
    borderWidth: 2.5,
    borderColor: C.listBg,
  },

  rowBody: { flex: 1, minWidth: 0 },
  rowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  rowName: {
    fontSize: 16,
    fontWeight: "600",
    color: C.textName,
    flex: 1,
    marginRight: 8,
  },
  rowTime: { fontSize: 12, color: C.textTime },
  rowTimeUnread: { color: C.textTimeUnread, fontWeight: "600" },

  rowBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rowPreview: { fontSize: 14, color: C.textPreview, flex: 1, marginRight: 8 },
  rowPreviewBold: { color: C.textPrimary, fontWeight: "500" },

  badge: {
    backgroundColor: C.unreadBg,
    borderRadius: 12,
    minWidth: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  badgeText: { fontSize: 12, fontWeight: "700", color: C.unreadText },

  divider: { height: 1, backgroundColor: C.divider, marginLeft: 86 },

  empty: { alignItems: "center", paddingTop: 60 },
  emptyText: { fontSize: 15, color: C.textPreview },

  // FAB
  fab: {
    position: "absolute",
    alignSelf: "center",
    left: "50%",
    marginLeft: -28,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.fabBg,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 8,
  },
  fabPressed: { opacity: 0.88 },
  fabIcon: { fontSize: 28, fontWeight: "300", color: C.fabText, lineHeight: 32 },
});
