import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
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
  createChatGroup,
  deleteGroup,
  loadChatGroups,
  saveChatGroups,
  setGroupContacts,
  upsertGroup,
  type ChatGroup,
} from "../services/chatGroups";
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
type SelectedFilter = "all" | string;

function ChatRow({
  item,
  onPress,
  onLongPress,
}: {
  item: ChatContact;
  onPress: () => void;
  onLongPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
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

function GroupManageModal({
  visible,
  mode,
  group,
  contacts,
  onClose,
  onSave,
  onDelete,
}: {
  visible: boolean;
  mode: "create" | "edit";
  group: ChatGroup | null;
  contacts: ChatContact[];
  onClose: () => void;
  onSave: (name: string, contactIds: string[]) => void;
  onDelete?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!visible) return;
    setName(group?.name ?? (mode === "create" ? "" : ""));
    setSelected(new Set(group?.contactIds ?? []));
  }, [visible, group, mode]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{mode === "create" ? "New group" : "Edit group"}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Feather name="x" size={22} color={theme.colors.textSecondary} />
            </Pressable>
          </View>

          <Text style={styles.modalLabel}>Group name</Text>
          <TextInput
            style={styles.modalInput}
            placeholder="e.g. Group 1, Hot leads"
            placeholderTextColor={theme.colors.textTertiary}
            value={name}
            onChangeText={setName}
            maxLength={40}
            autoFocus={mode === "create"}
          />

          <Text style={styles.modalLabel}>
            Contacts ({selected.size})
          </Text>
          <FlatList
            data={contacts}
            keyExtractor={(c) => c.id}
            style={styles.modalList}
            ItemSeparatorComponent={() => <View style={styles.modalDivider} />}
            ListEmptyComponent={
              <Text style={styles.modalEmpty}>Load chats first, then add them here.</Text>
            }
            renderItem={({ item }) => {
              const on = selected.has(item.id);
              return (
                <Pressable style={styles.modalRow} onPress={() => toggle(item.id)}>
                  <View style={[styles.avatarSm, { backgroundColor: AVATAR_BG(item.id) }]}>
                    <Text style={styles.avatarSmText}>{item.initials}</Text>
                  </View>
                  <View style={styles.modalRowBody}>
                    <Text style={styles.modalRowName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.modalRowPhone} numberOfLines={1}>
                      {item.phone}
                    </Text>
                  </View>
                  <View style={[styles.check, on && styles.checkOn]}>
                    {on ? <Feather name="check" size={14} color="#fff" /> : null}
                  </View>
                </Pressable>
              );
            }}
          />

          <View style={styles.modalActions}>
            {mode === "edit" && onDelete ? (
              <Pressable
                style={styles.deleteBtn}
                onPress={() => {
                  Alert.alert("Delete group?", "Contacts stay in All — only this group is removed.", [
                    { text: "Cancel", style: "cancel" },
                    { text: "Delete", style: "destructive", onPress: onDelete },
                  ]);
                }}
              >
                <Text style={styles.deleteBtnText}>Delete</Text>
              </Pressable>
            ) : (
              <View style={{ flex: 1 }} />
            )}
            <Pressable
              style={[styles.saveBtn, !name.trim() && styles.saveBtnDisabled]}
              disabled={!name.trim()}
              onPress={() => onSave(name.trim(), Array.from(selected))}
            >
              <Text style={styles.saveBtnText}>{mode === "create" ? "Create" : "Save"}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function ChatsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const [search, setSearch] = useState("");
  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [groups, setGroups] = useState<ChatGroup[]>([]);
  const [filter, setFilter] = useState<SelectedFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [manageOpen, setManageOpen] = useState(false);
  const [manageMode, setManageMode] = useState<"create" | "edit">("create");
  const [editingGroup, setEditingGroup] = useState<ChatGroup | null>(null);

  const persistGroups = useCallback(async (next: ChatGroup[]) => {
    setGroups(next);
    await saveChatGroups(next);
  }, []);

  useEffect(() => {
    void loadChatGroups().then(setGroups);
  }, []);

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

  const activeGroup = useMemo(
    () => (filter === "all" ? null : groups.find((g) => g.id === filter) ?? null),
    [filter, groups]
  );

  const filteredContacts = useMemo(() => {
    if (!activeGroup) return contacts;
    const set = new Set(activeGroup.contactIds);
    return contacts.filter((c) => set.has(c.id));
  }, [contacts, activeGroup]);

  const openCreateGroup = () => {
    setManageMode("create");
    setEditingGroup(null);
    setManageOpen(true);
  };

  const openEditGroup = (group: ChatGroup) => {
    setManageMode("edit");
    setEditingGroup(group);
    setManageOpen(true);
  };

  const handleSaveGroup = async (name: string, contactIds: string[]) => {
    if (manageMode === "create") {
      const next = upsertGroup(groups, createChatGroup(name, contactIds));
      await persistGroups(next);
      const created = next[next.length - 1];
      setFilter(created.id);
    } else if (editingGroup) {
      const updated = { ...editingGroup, name, contactIds };
      await persistGroups(upsertGroup(groups, updated));
    }
    setManageOpen(false);
  };

  const handleDeleteGroup = async () => {
    if (!editingGroup) return;
    const next = deleteGroup(groups, editingGroup.id);
    await persistGroups(next);
    if (filter === editingGroup.id) setFilter("all");
    setManageOpen(false);
  };

  const assignContactToGroup = (contact: ChatContact) => {
    if (!groups.length) {
      openCreateGroup();
      return;
    }

    const buttons = groups.map((g) => {
      const inGroup = g.contactIds.includes(contact.id);
      return {
        text: `${inGroup ? "✓ " : ""}${g.name}`,
        onPress: async () => {
          const ids = inGroup
            ? g.contactIds.filter((id) => id !== contact.id)
            : [...g.contactIds, contact.id];
          await persistGroups(setGroupContacts(groups, g.id, ids));
        },
      };
    });

    Alert.alert(
      contact.name,
      "Add or remove this lead from a group",
      [...buttons, { text: "Cancel", style: "cancel" }]
    );
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: 12 }]}>
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
            returnKeyType="search"
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")} hitSlop={8} accessibilityLabel="Clear search">
              <Feather name="x" size={18} color="rgba(255,255,255,0.65)" />
            </Pressable>
          )}
        </View>

        <View style={styles.groupsSection}>
          <View style={styles.groupsLabelRow}>
            <Text style={styles.groupsLabel}>Groups</Text>
            {activeGroup ? (
              <Pressable onPress={() => openEditGroup(activeGroup)} hitSlop={8}>
                <Text style={styles.groupsEdit}>Edit</Text>
              </Pressable>
            ) : null}
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            <Pressable
              onPress={() => setFilter("all")}
              style={[styles.chip, filter === "all" && styles.chipActive]}
            >
              <Text style={[styles.chipText, filter === "all" && styles.chipTextActive]}>
                All · {contacts.length}
              </Text>
            </Pressable>

            {groups.map((g) => {
              const active = filter === g.id;
              return (
                <Pressable
                  key={g.id}
                  onPress={() => setFilter(g.id)}
                  onLongPress={() => openEditGroup(g)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
                    {g.name} · {g.contactIds.length}
                  </Text>
                </Pressable>
              );
            })}

            <Pressable onPress={openCreateGroup} style={styles.chipAdd}>
              <Feather name="plus" size={16} color="#fff" />
              <Text style={styles.chipAddText}>New</Text>
            </Pressable>
          </ScrollView>
        </View>
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
            data={filteredContacts}
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
                onLongPress={() => assignContactToGroup(item)}
              />
            )}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyText}>
                  {activeGroup
                    ? `No contacts in ${activeGroup.name} yet.\nLong-press a chat in All to add them.`
                    : "No chats found"}
                </Text>
                {activeGroup ? (
                  <Pressable style={styles.emptyBtn} onPress={() => openEditGroup(activeGroup)}>
                    <Text style={styles.emptyBtnText}>Add contacts</Text>
                  </Pressable>
                ) : null}
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

      <GroupManageModal
        visible={manageOpen}
        mode={manageMode}
        group={editingGroup}
        contacts={contacts}
        onClose={() => setManageOpen(false)}
        onSave={(name, ids) => void handleSaveGroup(name, ids)}
        onDelete={() => void handleDeleteGroup()}
      />
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
    marginBottom: theme.spacing.md,
  },
  searchInput: { flex: 1, fontSize: theme.fontSize.base, color: "#FFFFFF" },
  groupsSection: { marginBottom: 14 },
  groupsLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  groupsLabel: {
    fontSize: 12,
    fontWeight: theme.fontWeight.semibold,
    color: "rgba(255,255,255,0.7)",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  groupsEdit: {
    fontSize: 13,
    fontWeight: theme.fontWeight.semibold,
    color: "#fff",
  },
  chipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingRight: 4,
    paddingBottom: 4,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: theme.radius.full,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    maxWidth: 180,
  },
  chipActive: {
    backgroundColor: "#fff",
    borderColor: "#fff",
  },
  chipText: {
    fontSize: 13,
    fontWeight: theme.fontWeight.semibold,
    color: "rgba(255,255,255,0.9)",
  },
  chipTextActive: {
    color: chat.header,
  },
  chipAdd: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radius.full,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    borderStyle: "dashed",
  },
  chipAddText: {
    fontSize: 13,
    fontWeight: theme.fontWeight.semibold,
    color: "#fff",
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
  errorText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textSecondary,
    textAlign: "center",
    marginBottom: 8,
  },
  retryText: {
    fontSize: theme.fontSize.base,
    color: chat.header,
    fontWeight: theme.fontWeight.semibold,
  },
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
  rowPreview: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textSecondary,
    flex: 1,
    marginRight: 8,
  },
  rowPreviewBold: {
    color: theme.colors.textPrimary,
    fontWeight: theme.fontWeight.medium,
  },
  badge: {
    backgroundColor: chat.unread,
    borderRadius: 12,
    minWidth: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  badgeText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.bold,
    color: chat.unreadText,
  },
  divider: { height: 1, backgroundColor: theme.colors.border, marginLeft: 86 },
  empty: { alignItems: "center", paddingTop: 60, paddingHorizontal: 28 },
  emptyText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
  emptyBtn: {
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: theme.radius.full,
    backgroundColor: chat.header,
  },
  emptyBtnText: {
    color: "#fff",
    fontWeight: theme.fontWeight.semibold,
    fontSize: 14,
  },
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
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15,26,23,0.45)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "88%",
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.textPrimary,
  },
  modalLabel: {
    fontSize: 12,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.textSecondary,
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: theme.colors.textPrimary,
    marginBottom: 16,
    backgroundColor: theme.colors.surfaceMuted,
  },
  modalList: { maxHeight: 320, marginBottom: 12 },
  modalDivider: { height: 1, backgroundColor: theme.colors.border, marginLeft: 52 },
  modalEmpty: {
    paddingVertical: 24,
    textAlign: "center",
    color: theme.colors.textSecondary,
  },
  modalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
  },
  avatarSm: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarSmText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  modalRowBody: { flex: 1, minWidth: 0 },
  modalRowName: {
    fontSize: 15,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.textPrimary,
  },
  modalRowPhone: { fontSize: 12, color: theme.colors.textTertiary, marginTop: 2 },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: theme.colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  checkOn: {
    backgroundColor: chat.header,
    borderColor: chat.header,
  },
  modalActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingTop: 4,
  },
  deleteBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: theme.radius.md,
    alignItems: "center",
    backgroundColor: theme.colors.errorSoft,
  },
  deleteBtnText: {
    color: theme.colors.error,
    fontWeight: theme.fontWeight.semibold,
    fontSize: 15,
  },
  saveBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: theme.radius.md,
    alignItems: "center",
    backgroundColor: chat.header,
  },
  saveBtnDisabled: { opacity: 0.45 },
  saveBtnText: {
    color: "#fff",
    fontWeight: theme.fontWeight.bold,
    fontSize: 15,
  },
});
