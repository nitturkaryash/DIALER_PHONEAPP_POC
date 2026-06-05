import { getToken } from "./api";

/**
 * DEMO: UltraChat inbox on CallPulse Chats tab → server.qualiabits.com
 * Set ULTRACHAT_DEMO_ENABLED to false before production builds.
 */
export const ULTRACHAT_DEMO_ENABLED = true;

export const ULTRACHAT_API_BASE =
  process.env.EXPO_PUBLIC_ULTRACHAT_API_URL ?? "https://server.qualiabits.com";

/**
 * Tenant WhatsApp Business line (token owner) — NOT a customer to message.
 * Shown for reference only; chats come from /api/chats/contacts (customers).
 */
export const ULTRACHAT_BUSINESS_PHONE = "917887898195";

/** Commons JWT — same token provided for Interactions demo */
export const ULTRACHAT_DEMO_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJxdWFsaWEtY29tbW9ucy1hdXRoIiwic3ViIjoiMDgwNmNkMGYtMjEyZS00ZjM0LTkzY2YtNjAxYTg4ZWJkZWY2IiwiYXVkIjpbInVsdHJhLWNoYXQiLCJjYWxsLXB1bHNlIiwidm9pY2UtYWdlbnQiXSwiaWF0IjoxNzgwNTkwMTg3LCJuYmYiOjE3ODA1OTAxODcsImp0aSI6IjA4MDZjZDBmLTIxMmUtNGYzNC05M2NmLTYwMWE4OGViZGVmNl8xNzgwNTkwMTg3X2c4ZjJicmMiLCJ2ZXJzaW9uIjoicXVhbGlhLWF1dGgtdjIiLCJlbWFpbCI6ImluZm9AdGhlLWNvbm5lY3Rpb25zLmNvbSIsInRlbmFudF9pZCI6ImNvbm5lY3Rpb25zIiwicm9sZSI6InVzZXIiLCJ1c2VyX3R5cGUiOiJ1c2VyIiwicGVybWlzc2lvbnMiOlsicmVhZCIsIndyaXRlIiwiZGVsZXRlIiwibWFuYWdlX3NldHRpbmdzIiwibWFuYWdlX3RlbXBsYXRlcyIsIm1hbmFnZV9jb252ZXJzYXRpb25zIiwidmlld19hbmFseXRpY3MiLCJtYW5hZ2Vfd2ViaG9va3MiLCJ0ZW1wbGF0ZXNfcmVhZCIsInRlbXBsYXRlc193cml0ZSIsImNhbXBhaWduc19yZWFkIiwiY2FtcGFpZ25zX3dyaXRlIiwicmVwb3J0c192aWV3Il0sInByb2R1Y3RzIjp7InVsdHJhX2NoYXQiOnRydWV9LCJkaXNwbGF5X25hbWUiOiJUaGUgQ29ubmVjdGlvbnMiLCJmdWxsX25hbWUiOiJUaGUgQ29ubmVjdGlvbnMiLCJjb21wYW55X25hbWUiOiJUaGVDb25uZWN0aW9ucyIsInN1YnNjcmlwdGlvbl9wbGFuIjoiYmFzaWMiLCJzdWJzY3JpcHRpb25fc3RhdHVzIjoiYWN0aXZlIiwiZXhwIjoxNzgwNjc2NTg3fQ.moMk-9GTK_8LvjdP64VYvt4sdVXxu3MMcqTzdXoUH0g";

/** Prefer Commons login JWT; fall back to demo token for offline inbox testing. */
export async function getUltraChatToken(): Promise<string> {
  const loginToken = await getToken();
  return loginToken || ULTRACHAT_DEMO_TOKEN;
}

export function ultraChatApiUrl(path: string): string {
  const base = ULTRACHAT_API_BASE.replace(/\/$/, "");
  const endpoint = path.startsWith("/") ? path.slice(1) : path;
  return `${base}/${endpoint}`;
}
