/**
 * Dial Intelligence — client-side call prioritization.
 *
 * Pure, deterministic, dependency-free scoring over data the app already has
 * (call dispositions, attempts, recency, unread chats). `now` is always injected
 * so the module is fully unit-testable.
 *
 * SEAM: `rankPriorityContacts` accepts an optional `serverScores` map keyed by
 * normalized phone. When a backend/LLM later returns a priority score + reason,
 * pass it here and it overrides the heuristic per-contact — the UI only ever
 * consumes `PriorityContact[]`, so no component changes are needed.
 */

import type { CallHistoryItem } from "../types";
import type { ChatContact, ChatMessage } from "./chatData";
import { composeCallSummary } from "./callSummary";
import { formatPhoneDisplay, normalizeWhatsAppPhone } from "./ultrachatChatApi";

export type Urgency = "high" | "medium" | "low";

export type PrioritySignals = {
  dispositionCode?: string;
  attempts: number;
  lastCallAt?: string | null;
  lastChatAt?: string | null;
  hasInboundReply: boolean;
  unreadCount: number;
  lastOutcomeSentiment?: "positive" | "neutral" | "negative";
};

export type PriorityContact = {
  phone: string; // normalized key
  name: string;
  score: number; // 0..100 clamped
  reason: string;
  urgency: Urgency;
  signals: PrioritySignals;
  source: "call" | "chat" | "both";
};

export type CallThread = {
  phone: string; // normalized key
  name: string;
  latest: CallHistoryItem;
  count: number;
  summary: string;
};

/** All tuning lives here so the rules are documented and adjustable in one place. */
export const PRIORITY_WEIGHTS = {
  // Base rule weights
  CALLBACK: 90,
  INBOUND_REPLY: 80,
  RETRY_NO_ANSWER: 55,
  RETRY_BUSY: 50,
  UNREAD_WAITING: 45,
  COLD_FOLLOWUP: 20,
  DEFAULT: 12,
  // Modifiers
  recencyBoostMax: 15,
  recencyFullWindowMin: 30, // full boost when activity is within this many minutes
  recencyZeroWindowMin: 24 * 60, // boost decays to 0 by here
  attemptsBackoffPerAttempt: 8,
  maxAttempts: 5, // contacts at/over this are dropped (anti-spam)
  sentimentPositive: 8,
  sentimentNegative: -10,
  cooldownMinutes: 10, // just-called window
  cooldownPenalty: 30,
  inboundReplyWindowMin: 60, // "Replied recently" qualifies as the inbound-reply rule
  // Urgency bands
  highBand: 70,
  mediumBand: 40,
} as const;

const SUPPRESSED_CODES = new Set(["INVALID"]);

function toMs(value?: string | null): number {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function minutesSince(value: string | null | undefined, now: number): number | null {
  const ms = toMs(value);
  if (!ms) return null;
  return Math.max(0, (now - ms) / 60000);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatAgo(minutes: number): string {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function recencyBoost(minutes: number | null): number {
  if (minutes == null) return 0;
  const { recencyBoostMax, recencyFullWindowMin, recencyZeroWindowMin } = PRIORITY_WEIGHTS;
  if (minutes <= recencyFullWindowMin) return recencyBoostMax;
  if (minutes >= recencyZeroWindowMin) return 0;
  const span = recencyZeroWindowMin - recencyFullWindowMin;
  return recencyBoostMax * (1 - (minutes - recencyFullWindowMin) / span);
}

function urgencyFor(score: number): Urgency {
  if (score >= PRIORITY_WEIGHTS.highBand) return "high";
  if (score >= PRIORITY_WEIGHTS.mediumBand) return "medium";
  return "low";
}

export type ScoreResult = { score: number; reason: string; urgency: Urgency; suppressed: boolean };

/** Score a single contact from its folded signals. Pure. */
export function scoreContact(signals: PrioritySignals, now: number): ScoreResult {
  const code = signals.dispositionCode?.toUpperCase();

  if (code && SUPPRESSED_CODES.has(code)) {
    return { score: 0, reason: "Invalid number", urgency: "low", suppressed: true };
  }
  if (signals.attempts >= PRIORITY_WEIGHTS.maxAttempts) {
    return { score: 0, reason: "Max attempts reached", urgency: "low", suppressed: true };
  }

  const chatMinutes = minutesSince(signals.lastChatAt, now);
  const candidates: Array<{ base: number; reason: string }> = [];

  if (code === "CALLBACK") {
    candidates.push({ base: PRIORITY_WEIGHTS.CALLBACK, reason: "Callback due" });
  }
  if (
    signals.hasInboundReply &&
    chatMinutes != null &&
    chatMinutes <= PRIORITY_WEIGHTS.inboundReplyWindowMin
  ) {
    candidates.push({ base: PRIORITY_WEIGHTS.INBOUND_REPLY, reason: `Replied ${formatAgo(chatMinutes)}` });
  }
  if (code === "NO_ANSWER") {
    const times = signals.attempts > 1 ? ` ×${signals.attempts}` : "";
    candidates.push({ base: PRIORITY_WEIGHTS.RETRY_NO_ANSWER, reason: `No answer${times} — retry` });
  }
  if (code === "BUSY") {
    candidates.push({ base: PRIORITY_WEIGHTS.RETRY_BUSY, reason: "Line busy — retry" });
  }
  if (signals.unreadCount > 0) {
    const plural = signals.unreadCount === 1 ? "message" : "messages";
    candidates.push({ base: PRIORITY_WEIGHTS.UNREAD_WAITING, reason: `${signals.unreadCount} unread ${plural}` });
  }
  if (code === "CONNECTED") {
    candidates.push({ base: PRIORITY_WEIGHTS.COLD_FOLLOWUP, reason: "Follow up" });
  }
  if (candidates.length === 0) {
    candidates.push({ base: PRIORITY_WEIGHTS.DEFAULT, reason: "Follow up" });
  }

  const top = candidates.reduce((best, c) => (c.base > best.base ? c : best));

  // Modifiers
  const mostRecentMinutes = (() => {
    const callMin = minutesSince(signals.lastCallAt, now);
    if (callMin == null) return chatMinutes;
    if (chatMinutes == null) return callMin;
    return Math.min(callMin, chatMinutes);
  })();

  let score = top.base + recencyBoost(mostRecentMinutes);
  score -= signals.attempts * PRIORITY_WEIGHTS.attemptsBackoffPerAttempt;

  if (signals.lastOutcomeSentiment === "positive") score += PRIORITY_WEIGHTS.sentimentPositive;
  else if (signals.lastOutcomeSentiment === "negative") score += PRIORITY_WEIGHTS.sentimentNegative;

  const callMinutes = minutesSince(signals.lastCallAt, now);
  if (code !== "CALLBACK" && callMinutes != null && callMinutes < PRIORITY_WEIGHTS.cooldownMinutes) {
    score -= PRIORITY_WEIGHTS.cooldownPenalty;
  }

  score = Math.round(clamp(score, 0, 100));
  return { score, reason: top.reason, urgency: urgencyFor(score), suppressed: false };
}

function callTimestamp(item: CallHistoryItem): number {
  return Math.max(toMs(item.started_at), toMs(item.wrapped_at));
}

function isMeaningfulName(name?: string | null): boolean {
  const n = name?.trim();
  return !!n && n.toLowerCase() !== "unknown";
}

/** Fold a phone's call rows (+ optional chat) into the signals the scorer reads. */
export function buildPrioritySignals(
  callRows: CallHistoryItem[],
  chatContact: ChatContact | undefined,
  _now: number
): PrioritySignals {
  const sorted = [...callRows].sort((a, b) => callTimestamp(b) - callTimestamp(a));
  const latest = sorted[0];

  const messages: ChatMessage[] = chatContact?.messages ?? [];
  const lastMessage = messages.length ? messages[messages.length - 1] : undefined;
  const unreadCount = chatContact?.unread ?? 0;
  const hasInboundReply = unreadCount > 0 || (lastMessage ? !lastMessage.fromMe : false);

  return {
    dispositionCode: latest?.disposition?.code ?? undefined,
    attempts: callRows.length,
    lastCallAt: latest ? new Date(callTimestamp(latest)).toISOString() : null,
    lastChatAt: chatContact?.lastMessageTime ?? null,
    hasInboundReply,
    unreadCount,
    lastOutcomeSentiment: undefined,
  };
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = map.get(k);
    if (bucket) bucket.push(item);
    else map.set(k, [item]);
  }
  return map;
}

export type RankInput = {
  calls: CallHistoryItem[];
  chats?: ChatContact[];
  now: number;
  limit?: number;
  /** SEAM: backend/LLM scores keyed by normalized phone; overrides the heuristic. */
  serverScores?: Record<string, { score: number; reason: string }>;
};

/** Top-level entry: merge call + chat sources by phone, score, filter, rank. */
export function rankPriorityContacts(input: RankInput): PriorityContact[] {
  const { calls, chats = [], now, limit = 8, serverScores } = input;

  const callsByPhone = groupBy(calls, (c) => normalizeWhatsAppPhone(c.phone_number || ""));
  const chatsByPhone = new Map<string, ChatContact>();
  for (const chat of chats) {
    chatsByPhone.set(normalizeWhatsAppPhone(chat.phone || chat.id || ""), chat);
  }

  const phones = new Set<string>([...callsByPhone.keys(), ...chatsByPhone.keys()]);
  phones.delete("");

  const results: PriorityContact[] = [];

  for (const phone of phones) {
    const callRows = callsByPhone.get(phone) ?? [];
    const chat = chatsByPhone.get(phone);
    const signals = buildPrioritySignals(callRows, chat, now);

    const latestCall = [...callRows].sort((a, b) => callTimestamp(b) - callTimestamp(a))[0];
    const name = isMeaningfulName(latestCall?.customer_name)
      ? latestCall.customer_name
      : chat?.name?.trim() || formatPhoneDisplay(phone);

    const source: PriorityContact["source"] =
      callRows.length && chat ? "both" : callRows.length ? "call" : "chat";

    const override = serverScores?.[phone];
    const scored: ScoreResult = override
      ? { score: override.score, reason: override.reason, urgency: urgencyFor(override.score), suppressed: false }
      : scoreContact(signals, now);

    if (scored.suppressed) continue;

    results.push({
      phone,
      name,
      score: scored.score,
      reason: scored.reason,
      urgency: scored.urgency,
      signals,
      source,
    });
  }

  results.sort((a, b) => b.score - a.score || toMs(b.signals.lastCallAt) - toMs(a.signals.lastCallAt));
  return results.slice(0, limit);
}

/** Group flat call history into per-contact threads with a one-line summary. */
export function groupCallsByContact(items: CallHistoryItem[]): CallThread[] {
  const byPhone = groupBy(items, (c) => normalizeWhatsAppPhone(c.phone_number || ""));
  const threads: CallThread[] = [];

  for (const [phone, rows] of byPhone) {
    const sorted = [...rows].sort((a, b) => callTimestamp(b) - callTimestamp(a));
    const latest = sorted[0];
    const name = isMeaningfulName(latest.customer_name)
      ? latest.customer_name
      : formatPhoneDisplay(phone || latest.phone_number || "");
    threads.push({
      phone: phone || latest.phone_number || "",
      name,
      latest,
      count: rows.length,
      summary: composeCallSummary(latest),
    });
  }

  threads.sort((a, b) => callTimestamp(b.latest) - callTimestamp(a.latest));
  return threads;
}
