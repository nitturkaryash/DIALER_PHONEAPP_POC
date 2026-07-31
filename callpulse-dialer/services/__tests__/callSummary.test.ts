import { composeCallSummary, formatDuration } from "../callSummary";
import type { CallHistoryItem } from "../../types";

function call(overrides: Partial<CallHistoryItem> = {}): CallHistoryItem {
  return {
    id: "1",
    call_id: "c1",
    customer_name: "Test",
    phone_number: "7887898195",
    status: "completed",
    duration_seconds: 134,
    disposition: { id: "d", code: "CONNECTED", name: "Connected" },
    notes: null,
    ...overrides,
  };
}

describe("formatDuration", () => {
  it("returns 0m for no duration", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(null)).toBe("0m");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(134)).toBe("2m 14s");
    expect(formatDuration(45)).toBe("45s");
  });
});

describe("composeCallSummary", () => {
  it("composes outcome, duration, and notes", () => {
    const summary = composeCallSummary(call({ notes: "Wants a callback Friday" }));
    expect(summary).toBe("Connected · 2m 14s · Wants a callback Friday");
  });

  it("omits duration when there is none", () => {
    const summary = composeCallSummary(
      call({ duration_seconds: 0, disposition: { id: "d", code: "NO_ANSWER", name: "No Answer" } })
    );
    expect(summary).toBe("No Answer");
  });

  it("falls back to status when no disposition", () => {
    const summary = composeCallSummary(call({ disposition: null, status: "failed", duration_seconds: 0 }));
    expect(summary).toBe("Failed");
  });

  it("truncates long notes", () => {
    const longNote = "x".repeat(100);
    const summary = composeCallSummary(call({ duration_seconds: 0, notes: longNote }));
    expect(summary.endsWith("…")).toBe(true);
    expect(summary.length).toBeLessThan("Connected · ".length + 70);
  });
});
