import type { CallHistoryItem } from "../types";

/** Human-readable call length. Returns "0m" when there is no usable duration. */
export function formatDuration(seconds?: number | null): string {
  if (!seconds || seconds <= 0) return "0m";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`.replace(" 0s", "");
  return `${secs}s`;
}

function titleCase(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

const NOTES_MAX = 60;

/**
 * One-line, scannable summary of a single call, composed entirely from data we
 * already have: outcome (disposition name or status) · duration · notes snippet.
 *
 * SEAM: when the backend/LLM later returns a `summary` field on the call payload,
 * prefer it here and fall back to this composed string — no UI change required.
 */
export function composeCallSummary(item: CallHistoryItem): string {
  const parts: string[] = [];

  const outcome = item.disposition?.name?.trim() || titleCase(item.status || "");
  if (outcome) parts.push(outcome);

  if (item.duration_seconds && item.duration_seconds > 0) {
    parts.push(formatDuration(item.duration_seconds));
  }

  const notes = item.notes?.trim();
  if (notes) {
    const snippet = notes.length > NOTES_MAX ? `${notes.slice(0, NOTES_MAX - 1).trimEnd()}…` : notes;
    parts.push(snippet);
  }

  return parts.join(" · ") || "No outcome recorded";
}
