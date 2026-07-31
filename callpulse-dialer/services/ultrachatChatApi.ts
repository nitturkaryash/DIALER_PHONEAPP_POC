import { Platform } from "react-native";

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

function normalizeMessageText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function toMs(iso: string): number {
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function fallbackMessageId(m: Record<string, unknown>, text: string, direction: string): string {
  const ts = String(m.createdAt ?? m.created_at ?? m.timestamp ?? "");
  const phone = String(m.phone_number ?? m.phoneNumber ?? "");
  const status = String(m.status ?? "");
  const normalized = normalizeMessageText(text);
  return `fallback:${direction}:${phone}:${ts}:${status}:${normalized}`;
}

export function mergeChatMessages(
  existing: ChatMessage[],
  incoming: ChatMessage[]
): ChatMessage[] {
  const byId = new Map(existing.map((m) => [m.id, m]));
  for (const msg of incoming) {
    const prev = byId.get(msg.id);
    byId.set(msg.id, prev ? { ...prev, ...msg } : msg);
  }
  const merged = Array.from(byId.values()).sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const confirmedOutgoing = merged.filter((m) => m.fromMe && !m.id.startsWith("local-"));
  return merged.filter((m) => {
    if (!m.id.startsWith("local-")) return true;
    const text = normalizeMessageText(m.text);
    if (!text) return true;
    const localTs = toMs(m.timestamp);
    return !confirmedOutgoing.some((serverMsg) => {
      if (normalizeMessageText(serverMsg.text) !== text) return false;
      return Math.abs(toMs(serverMsg.timestamp) - localTs) <= 2 * 60 * 1000;
    });
  });
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
  const text = previewText(m.message_sent ?? m.messageSent) || "";
  const messageId =
    String(m._id ?? m.message_id ?? m.id ?? m.wa_message_id ?? "").trim() ||
    fallbackMessageId(m, text, direction);
  return {
    id: messageId,
    text,
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

type StreamHandlers = {
  onEvent: (eventName: string, payload: StreamPayload | null) => void;
  onError?: (err: unknown) => void;
  onOpen?: () => void;
};

function splitSseLines(buffer: string): { lines: string[]; rest: string } {
  const lines = buffer.split(/\r\n|\n|\r/);
  const rest = lines.pop() ?? "";
  return { lines, rest };
}

function dispatchStreamEvent(
  handlers: StreamHandlers,
  eventName: string,
  rawData: string
): void {
  let parsed: StreamPayload | null = null;
  try {
    parsed = rawData ? JSON.parse(rawData) : null;
  } catch {
    parsed = null;
  }
  if ((eventName || "message").toLowerCase() === "connected") return;
  handlers.onEvent(eventName || "message", parsed);
}

function createSseParser(handlers: StreamHandlers) {
  let buffer = "";
  let eventName = "message";
  let dataLines: string[] = [];

  const flush = () => {
    if (!dataLines.length) return;
    const raw = dataLines.join("\n");
    dataLines = [];
    dispatchStreamEvent(handlers, eventName, raw);
    eventName = "message";
  };

  const push = (chunk: string) => {
    buffer += chunk;
    const { lines, rest } = splitSseLines(buffer);
    buffer = rest;
    for (const line of lines) {
      if (line === "") {
        flush();
        continue;
      }
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim() || "message";
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
  };

  const end = () => flush();

  return { push, end };
}

/** XHR onprogress — works on React Native where fetch streaming body is often missing. */
function subscribeUltraChatStreamXhr(handlers: StreamHandlers): { close: () => void } {
  let closed = false;
  let retryMs = 1000;
  let xhr: XMLHttpRequest | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleReconnect = () => {
    if (closed) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, retryMs);
    retryMs = Math.min(retryMs * 2, 30_000);
  };

  const connect = () => {
    if (closed) return;
    const token = getUltraChatToken();
    const url = ultraChatApiUrl(`/api/notifications/stream?token=${encodeURIComponent(token)}`);
    const parser = createSseParser(handlers);
    let lastIndex = 0;
    let opened = false;

    xhr = new XMLHttpRequest();
    xhr.open("GET", url, true);
    xhr.setRequestHeader("Accept", "text/event-stream");
    xhr.setRequestHeader("Cache-Control", "no-cache");

    xhr.onprogress = () => {
      if (!xhr) return;
      if (!opened) {
        opened = true;
        retryMs = 1000;
        handlers.onOpen?.();
      }
      const text = xhr.responseText;
      const chunk = text.slice(lastIndex);
      lastIndex = text.length;
      if (chunk) parser.push(chunk);
    };

    xhr.onloadend = () => {
      parser.end();
      if (!closed && xhr && xhr.status >= 200 && xhr.status < 300) {
        scheduleReconnect();
        return;
      }
      if (!closed) {
        handlers.onError?.(new Error(`Chat stream closed (${xhr?.status ?? 0})`));
        scheduleReconnect();
      }
    };

    xhr.onerror = () => {
      if (closed) return;
      handlers.onError?.(new Error("Chat stream network error"));
      scheduleReconnect();
    };

    xhr.onabort = () => parser.end();
    xhr.send();
  };

  void connect();

  return {
    close: () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      xhr?.abort();
      xhr = null;
    },
  };
}

function subscribeUltraChatStreamFetch(handlers: StreamHandlers): { close: () => void } {
  let closed = false;
  let retryMs = 1000;
  const abortRef: { current: AbortController | null } = { current: null };
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleReconnect = () => {
    if (closed) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, retryMs);
    retryMs = Math.min(retryMs * 2, 30_000);
  };

  const connect = async () => {
    if (closed) return;
    const token = getUltraChatToken();
    const url = ultraChatApiUrl(`/api/notifications/stream?token=${encodeURIComponent(token)}`);
    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch(url, {
        headers: { Accept: "text/event-stream", "Cache-Control": "no-cache" },
        signal: abort.signal,
      });
      if (!res.ok) throw new Error(`Chat stream failed (${res.status})`);

      handlers.onOpen?.();
      retryMs = 1000;

      const reader = res.body?.getReader();
      if (!reader) throw new Error("Chat stream body unavailable");

      const decoder = new TextDecoder();
      const parser = createSseParser(handlers);

      while (!closed) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
      parser.end();
      scheduleReconnect();
    } catch (err) {
      if (closed || (err instanceof Error && err.name === "AbortError")) return;
      handlers.onError?.(err);
      scheduleReconnect();
    } finally {
      if (abortRef.current === abort) abortRef.current = null;
    }
  };

  void connect();

  return {
    close: () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      abortRef.current?.abort();
    },
  };
}

function subscribeUltraChatStreamEventSource(handlers: StreamHandlers): { close: () => void } {
  let es: EventSource | null = null;
  let closed = false;

  const token = getUltraChatToken();
  const url = ultraChatApiUrl(`/api/notifications/stream?token=${encodeURIComponent(token)}`);
  const g = globalThis as { EventSource?: typeof EventSource };
  if (typeof g.EventSource !== "undefined") {
    es = new g.EventSource(url);
    const handle = (event: MessageEvent) => {
      const name = (event as Event & { type?: string }).type || "message";
      dispatchStreamEvent(handlers, name, event.data || "");
    };

    es.onopen = () => handlers.onOpen?.();
    es.onmessage = handle;
    es.addEventListener("connected", handle as EventListener);
    es.onerror = (e) => handlers.onError?.(e);
  }

  return {
    close: () => {
      closed = true;
      try {
        es?.close();
      } catch {
        /* noop */
      }
      es = null;
    },
  };
}

/** Realtime chat updates via SSE (XHR on native, EventSource on web). */
export function subscribeUltraChatStream(handlers: StreamHandlers): { close: () => void } {
  if (Platform.OS === "web") {
    return subscribeUltraChatStreamEventSource(handlers);
  }
  return subscribeUltraChatStreamXhr(handlers);
}

export function applyStreamToContacts(
  contacts: ChatContact[],
  payload: StreamPayload | null
): ChatContact[] | null {
  const phone = phoneFromStreamPayload(payload);
  const msg = messageFromStreamPayload(payload);
  if (!phone || !msg) return null;

  const norm = normalizeWhatsAppPhone(phone);
  const preview = msg.text || "New message";
  const idx = contacts.findIndex((c) => normalizeWhatsAppPhone(c.id) === norm);

  if (idx >= 0) {
    const existing = contacts[idx];
    const updated: ChatContact = {
      ...existing,
      lastMessage: preview,
      lastMessageTime: msg.timestamp,
      unread: msg.fromMe ? existing.unread : existing.unread + 1,
    };
    return [updated, ...contacts.filter((_, i) => i !== idx)];
  }

  const name =
    String(payload?.message?.contact_name ?? payload?.message?.contactName ?? phone) || phone;
  const created: ChatContact = {
    id: norm,
    name,
    phone: norm,
    initials: initialsFor(name, norm),
    lastMessage: preview,
    lastMessageTime: msg.timestamp,
    unread: msg.fromMe ? 0 : 1,
    online: false,
    messages: [],
  };
  return [created, ...contacts];
}

export { formatTime };
