import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

export type ChatGroup = {
  id: string;
  name: string;
  contactIds: string[];
  createdAt: string;
};

const STORAGE_KEY = "callpulse.chatGroups.v1";

const DEFAULT_GROUPS: ChatGroup[] = [
  { id: "group-1", name: "Group 1", contactIds: [], createdAt: new Date().toISOString() },
  { id: "group-2", name: "Group 2", contactIds: [], createdAt: new Date().toISOString() },
];

async function readRaw(): Promise<string | null> {
  if (Platform.OS === "web") return localStorage.getItem(STORAGE_KEY);
  return SecureStore.getItemAsync(STORAGE_KEY);
}

async function writeRaw(value: string): Promise<void> {
  if (Platform.OS === "web") {
    localStorage.setItem(STORAGE_KEY, value);
    return;
  }
  await SecureStore.setItemAsync(STORAGE_KEY, value);
}

function normalizeGroups(raw: unknown): ChatGroup[] {
  if (!Array.isArray(raw)) return DEFAULT_GROUPS.map((g) => ({ ...g, contactIds: [] }));
  const groups = raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const g = item as Record<string, unknown>;
      const id = String(g.id ?? "").trim();
      const name = String(g.name ?? "").trim();
      if (!id || !name) return null;
      const contactIds = Array.isArray(g.contactIds)
        ? g.contactIds.map((c) => String(c)).filter(Boolean)
        : [];
      return {
        id,
        name,
        contactIds: Array.from(new Set(contactIds)),
        createdAt: String(g.createdAt ?? new Date().toISOString()),
      } satisfies ChatGroup;
    })
    .filter((g): g is ChatGroup => Boolean(g));

  return groups.length ? groups : DEFAULT_GROUPS.map((g) => ({ ...g, contactIds: [] }));
}

export async function loadChatGroups(): Promise<ChatGroup[]> {
  try {
    const raw = await readRaw();
    if (!raw) {
      const seeded = DEFAULT_GROUPS.map((g) => ({ ...g, contactIds: [] as string[] }));
      await saveChatGroups(seeded);
      return seeded;
    }
    return normalizeGroups(JSON.parse(raw));
  } catch {
    return DEFAULT_GROUPS.map((g) => ({ ...g, contactIds: [] }));
  }
}

export async function saveChatGroups(groups: ChatGroup[]): Promise<void> {
  await writeRaw(JSON.stringify(groups));
}

export function createChatGroup(name: string, contactIds: string[] = []): ChatGroup {
  const trimmed = name.trim() || `Group ${Date.now()}`;
  return {
    id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: trimmed,
    contactIds: Array.from(new Set(contactIds)),
    createdAt: new Date().toISOString(),
  };
}

export function upsertGroup(groups: ChatGroup[], next: ChatGroup): ChatGroup[] {
  const idx = groups.findIndex((g) => g.id === next.id);
  if (idx < 0) return [...groups, next];
  const copy = [...groups];
  copy[idx] = next;
  return copy;
}

export function deleteGroup(groups: ChatGroup[], groupId: string): ChatGroup[] {
  return groups.filter((g) => g.id !== groupId);
}

export function toggleContactInGroup(
  groups: ChatGroup[],
  groupId: string,
  contactId: string
): ChatGroup[] {
  return groups.map((g) => {
    if (g.id !== groupId) return g;
    const has = g.contactIds.includes(contactId);
    return {
      ...g,
      contactIds: has
        ? g.contactIds.filter((id) => id !== contactId)
        : [...g.contactIds, contactId],
    };
  });
}

export function setGroupContacts(
  groups: ChatGroup[],
  groupId: string,
  contactIds: string[]
): ChatGroup[] {
  return groups.map((g) =>
    g.id === groupId ? { ...g, contactIds: Array.from(new Set(contactIds)) } : g
  );
}
