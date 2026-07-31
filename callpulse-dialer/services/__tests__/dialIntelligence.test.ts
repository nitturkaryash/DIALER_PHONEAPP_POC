import {
  PRIORITY_WEIGHTS,
  groupCallsByContact,
  rankPriorityContacts,
  scoreContact,
  type PrioritySignals,
} from "../dialIntelligence";
import type { CallHistoryItem } from "../../types";
import type { ChatContact } from "../chatData";

const NOW = new Date("2026-06-07T12:00:00.000Z").getTime();

function minutesAgo(min: number): string {
  return new Date(NOW - min * 60_000).toISOString();
}

function call(overrides: Partial<CallHistoryItem> = {}): CallHistoryItem {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    call_id: overrides.call_id ?? "c",
    customer_name: overrides.customer_name ?? "Test User",
    phone_number: overrides.phone_number ?? "7887898195",
    status: overrides.status ?? "completed",
    started_at: overrides.started_at ?? minutesAgo(120),
    duration_seconds: overrides.duration_seconds ?? 60,
    disposition: overrides.disposition ?? null,
    notes: overrides.notes ?? null,
    wrapped_at: overrides.wrapped_at ?? null,
    ...overrides,
  };
}

function chat(overrides: Partial<ChatContact> = {}): ChatContact {
  return {
    id: overrides.id ?? "917887898195",
    name: overrides.name ?? "Chat User",
    phone: overrides.phone ?? "917887898195",
    initials: "CU",
    lastMessage: overrides.lastMessage ?? "hi",
    lastMessageTime: overrides.lastMessageTime ?? minutesAgo(10),
    unread: overrides.unread ?? 0,
    online: false,
    messages: overrides.messages ?? [],
  };
}

function signals(overrides: Partial<PrioritySignals> = {}): PrioritySignals {
  return {
    attempts: 1,
    hasInboundReply: false,
    unreadCount: 0,
    ...overrides,
  };
}

describe("scoreContact", () => {
  it("ranks an explicit callback as highest urgency", () => {
    const result = scoreContact(signals({ dispositionCode: "CALLBACK", lastCallAt: minutesAgo(200) }), NOW);
    expect(result.reason).toBe("Callback due");
    expect(result.urgency).toBe("high");
    expect(result.suppressed).toBe(false);
  });

  it("includes the attempt count in the no-answer retry reason", () => {
    const result = scoreContact(
      signals({ dispositionCode: "NO_ANSWER", attempts: 3, lastCallAt: minutesAgo(200) }),
      NOW
    );
    expect(result.reason).toBe("No answer ×3 — retry");
  });

  it("drops contacts at or over the max attempt cap", () => {
    const result = scoreContact(
      signals({ dispositionCode: "NO_ANSWER", attempts: PRIORITY_WEIGHTS.maxAttempts }),
      NOW
    );
    expect(result.suppressed).toBe(true);
  });

  it("suppresses invalid numbers", () => {
    const result = scoreContact(signals({ dispositionCode: "INVALID" }), NOW);
    expect(result.suppressed).toBe(true);
  });

  it("applies a cooldown penalty to a just-called contact", () => {
    const justCalled = scoreContact(signals({ dispositionCode: "CONNECTED", lastCallAt: minutesAgo(2) }), NOW);
    const older = scoreContact(signals({ dispositionCode: "CONNECTED", lastCallAt: minutesAgo(90) }), NOW);
    expect(justCalled.score).toBeLessThan(older.score);
  });

  it("formats a recent inbound reply reason", () => {
    const result = scoreContact(
      signals({ hasInboundReply: true, lastChatAt: minutesAgo(5), unreadCount: 1 }),
      NOW
    );
    expect(result.reason).toMatch(/^Replied \d+m ago$/);
  });
});

describe("rankPriorityContacts", () => {
  it("returns an empty list for empty input", () => {
    expect(rankPriorityContacts({ calls: [], chats: [], now: NOW })).toEqual([]);
  });

  it("merges a call and chat for the same phone into one 'both' contact", () => {
    const ranked = rankPriorityContacts({
      calls: [call({ phone_number: "7887898195" })],
      chats: [chat({ id: "917887898195", phone: "917887898195", unread: 2, lastMessageTime: minutesAgo(8) })],
      now: NOW,
    });
    expect(ranked).toHaveLength(1);
    expect(ranked[0].source).toBe("both");
  });

  it("orders callback ahead of a generic follow-up", () => {
    const ranked = rankPriorityContacts({
      calls: [
        call({ phone_number: "9000000001", disposition: { id: "d1", code: "CONNECTED", name: "Connected" } }),
        call({ phone_number: "9000000002", disposition: { id: "d2", code: "CALLBACK", name: "Callback" } }),
      ],
      now: NOW,
    });
    expect(ranked[0].reason).toBe("Callback due");
  });

  it("honors a server score override via the seam", () => {
    const ranked = rankPriorityContacts({
      calls: [call({ phone_number: "7887898195", disposition: { id: "d", code: "CONNECTED", name: "Connected" } })],
      now: NOW,
      serverScores: { "917887898195": { score: 99, reason: "LLM: high intent" } },
    });
    expect(ranked[0].score).toBe(99);
    expect(ranked[0].reason).toBe("LLM: high intent");
  });
});

describe("groupCallsByContact", () => {
  it("collapses repeated calls into one thread with a count", () => {
    const threads = groupCallsByContact([
      call({ phone_number: "7887898195", started_at: minutesAgo(60) }),
      call({ phone_number: "7887898195", started_at: minutesAgo(10) }),
      call({ phone_number: "9999999999", started_at: minutesAgo(5) }),
    ]);
    expect(threads).toHaveLength(2);
    const main = threads.find((t) => t.phone === "917887898195");
    expect(main?.count).toBe(2);
  });

  it("orders threads by most recent call first", () => {
    const threads = groupCallsByContact([
      call({ phone_number: "1111111111", started_at: minutesAgo(300) }),
      call({ phone_number: "2222222222", started_at: minutesAgo(5) }),
    ]);
    expect(threads[0].phone).toBe("912222222222");
  });
});
