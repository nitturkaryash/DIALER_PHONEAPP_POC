import { getUltraChatToken, ultraChatApiUrl } from "./ultrachatConfig";
import type { ChatContact, ChatMessage } from "./chatData";
import { formatTime } from "./chatData";

const CHAT_STATUSES = ["sent", "delivered", "read", "received"].join(",");

/** WhatsApp / UltraChat expect country code — 7887898195 → 917887898195 */
export function normalizeWhatsAppPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return phone;
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits;
}

export function formatPhoneDisplay(phone: string): string {
  const n = normalizeWhatsAppPhone(phone);
  if (n.length === 12 && n.startsWith("91")) {
    return `+91 ${n.slice(2, 7)} ${n.slice(7)}`;
  }
  return n.startsWith("+") ? n : `+${n}`;
}

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getUltraChatToken()}`,
  };
}

function initialsFor(name: string, phone: string): string {
  const n = (name || "").trim();
  if (n.length >= 2) {
    const parts = n.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return n.slice(0, 2).toUpperCase();
  }
  const digits = phone.replace(/\D/g, "");
  return digits.slice(-2) || "??";
}

function previewText(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return "";
  const t = raw.trim();
  if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
    try {
      const p = JSON.parse(t) as { text?: string; body?: string };
      return (p.text || p.body || t).trim();
    } catch {
      return t;
    }
  }
  return t;
}

export function mapApiContact(c: Record<string, unknown>): ChatContact {
  const phone = normalizeWhatsAppPhone(String(c.phoneNumber ?? c.phone_number ?? ""));
  const name = String(c.name ?? c.conversationName ?? phone);
  const lastTs = String(c.lastTimestamp ?? c.last_timestamp ?? new Date().toISOString());
  return {
    id: phone,
    name,
    phone,
    initials: initialsFor(name, phone),
    lastMessage: previewText(c.lastMessage ?? c.last_message) || "No messages yet",
    lastMessageTime: lastTs,
    unread: Number(c.unreadCount ?? c.unread_count ?? 0),
    online: false,
    messages: [],
  };
}

export function mapApiMessage(m: Record<string, unknown>): ChatMessage {
  const direction = String(m.direction ?? "inbound");
  const status = String(m.status ?? "received");
  return {
    id: String(m._id ?? m.message_id ?? `msg-${Date.now()}-${Math.random()}`),
    text: previewText(m.message_sent ?? m.messageSent) || "",
    fromMe: direction === "outbound",
    timestamp: String(m.createdAt ?? m.created_at ?? new Date().toISOString()),
    status:
      status === "read" || status === "delivered"
        ? (status as ChatMessage["status"])
        : status === "sent"
          ? "sent"
          : undefined,
  };
}

export async function fetchUltraChatContacts(
  page = 1,
  limit = 20,
  search?: string
): Promise<ChatContact[]> {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    status: CHAT_STATUSES,
  });
  if (search?.trim()) params.set("search", search.trim());

  const res = await fetch(ultraChatApiUrl(`/api/chats/contacts?${params}`), {
    headers: authHeaders(),
  });
  const json = (await res.json()) as { status?: string; message?: string; data?: { contacts?: unknown[] } };
  if (!res.ok || json.status !== "success") {
    throw new Error(json.message || `Contacts failed (${res.status})`);
  }
  const list = json.data?.contacts ?? [];
  return (list as Record<string, unknown>[]).map(mapApiContact);
}

export async function fetchUltraChatHistory(phoneNumber: string, limit = 50): Promise<ChatMessage[]> {
  const phone = normalizeWhatsAppPhone(phoneNumber);
  const params = new URLSearchParams({ limit: String(limit), status: CHAT_STATUSES });
  const res = await fetch(
    ultraChatApiUrl(`/api/chats/${encodeURIComponent(phone)}?${params}`),
    { headers: authHeaders() }
  );
  const json = (await res.json()) as {
    status?: string;
    message?: string;
    data?: { messages?: unknown[] };
  };
  if (!res.ok || json.status !== "success") {
    throw new Error(json.message || `History failed (${res.status})`);
  }
  const raw = (json.data?.messages ?? []) as Record<string, unknown>[];
  return raw.map(mapApiMessage).reverse();
}

export async function markUltraChatRead(phoneNumber: string): Promise<void> {
  const phone = normalizeWhatsAppPhone(phoneNumber);
  await fetch(ultraChatApiUrl(`/api/chats/${encodeURIComponent(phone)}/read`), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({}),
  });
}

export async function sendUltraChatText(phoneNumber: string, textMessage: string): Promise<void> {
  const phone = normalizeWhatsAppPhone(phoneNumber);
  const res = await fetch(ultraChatApiUrl("/api/send/message"), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ phone_number: phone, textMessage }),
  });
  const json = (await res.json()) as { status?: string; message?: string };
  if (!res.ok || json.status !== "success") {
    throw new Error(json.message || `Send failed (${res.status})`);
  }
}

export type StreamPayload = {
  phoneNumber?: string;
  message?: Record<string, unknown>;
};

export function phoneFromStreamPayload(payload: StreamPayload | null): string | null {
  if (!payload) return null;
  return (
    payload.phoneNumber ||
    String(payload.message?.phone_number ?? payload.message?.phoneNumber ?? "") ||
    null
  );
}

export function messageFromStreamPayload(payload: StreamPayload | null): ChatMessage | null {
  if (!payload?.message) return null;
  return mapApiMessage(payload.message);
}

/** SSE when EventSource exists; otherwise returns null (caller can poll). */
export function subscribeUltraChatStream(handlers: {
  onEvent: (eventName: string, payload: StreamPayload | null) => void;
  onError?: (err: unknown) => void;
}): { close: () => void } | null {
  const g = globalThis as { EventSource?: typeof EventSource };
  if (typeof g.EventSource === "undefined") return null;

  const token = getUltraChatToken();
  const url = ultraChatApiUrl(`/api/notifications/stream?token=${encodeURIComponent(token)}`);
  const es = new g.EventSource(url);

  const handle = (event: MessageEvent) => {
    let parsed: StreamPayload | null = null;
    try {
      parsed = event.data ? JSON.parse(event.data) : null;
    } catch {
      parsed = null;
    }
    const name = (event as Event & { type?: string }).type || "message";
    if (name.toLowerCase() === "connected") return;
    handlers.onEvent(name, parsed);
  };

  es.onmessage = handle;
  es.addEventListener("connected", handle as EventListener);
  es.onerror = (e) => handlers.onError?.(e);

  return {
    close: () => {
      try {
        es.close();
      } catch {
        /* noop */
      }
    },
  };
}

export { formatTime };
