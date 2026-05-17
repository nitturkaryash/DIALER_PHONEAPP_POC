import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

import type {
  Agent,
  AgentConversionFunnel,
  AgentDashboardSummary,
  AgentDashboardTrends,
  AgentFailureBreakdown,
  Campaign,
  CallSession,
  DispositionPayload,
  Lead,
  HumanAgentCallRequest,
  HumanAgentCallResponse,
  HumanAgentCallStatus,
  CallHistoryResponse,
  CallHistoryDetailResponse,
  OutboundCallRequest,
  OutboundCallResponse,
  OutboundCallStatus,
} from "../types";
import { DEV_TOKEN, mockAgent, mockCallSession, mockCampaigns, mockLeads } from "./mockData";

export const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000";
export const TOKEN_KEY = "callpulse_access_token";
const ENABLE_DEV_MOCKS = process.env.EXPO_PUBLIC_ENABLE_DEV_MOCKS === "true";

export class AuthError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "AuthError";
  }
}

export async function getToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    return localStorage.getItem(TOKEN_KEY);
  }
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  if (Platform.OS === "web") {
    localStorage.setItem(TOKEN_KEY, token);
    return;
  }
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  if (Platform.OS === "web") {
    localStorage.removeItem(TOKEN_KEY);
    return;
  }
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  if (response.status === 401) {
    await clearToken();
    throw new AuthError("Session expired");
  }

  if (!response.ok) {
    const text = await response.text();
    try {
      const json = JSON.parse(text) as { detail?: string | { msg?: string }[]; message?: string };
      if (typeof json.detail === "string") {
        throw new Error(json.detail);
      }
      if (Array.isArray(json.detail) && json.detail[0]?.msg) {
        throw new Error(json.detail[0].msg);
      }
      if (json.message) {
        throw new Error(json.message);
      }
    } catch (e) {
      if (e instanceof Error && e.message !== text) {
        throw e;
      }
    }
    throw new Error(text || "Request failed");
  }

  if (response.status === 204) {
    return {} as T;
  }

  return (await response.json()) as T;
}

export async function login(email: string, password: string): Promise<{ access_token: string; token_type: string }> {
  return request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function getMe(token: string): Promise<Agent> {
  if (ENABLE_DEV_MOCKS && token === DEV_TOKEN) return mockAgent;
  const response = await request<{ ok: boolean; user: Agent }>("/api/auth/me", { method: "GET" }, token);
  return response.user;
}

export async function getCampaigns(token: string): Promise<Campaign[]> {
  if (ENABLE_DEV_MOCKS && token === DEV_TOKEN) return mockCampaigns;
  return request("/v1/dialer/campaigns", { method: "GET" }, token);
}

export async function getLeads(token: string, processId: string, status = "pending"): Promise<Lead[]> {
  if (ENABLE_DEV_MOCKS && token === DEV_TOKEN) return mockLeads.filter((l) => status === "pending" ? l.status === "pending" : true);
  const query = new URLSearchParams({ status });
  return request(`/v1/dialer/campaigns/${processId}/leads?${query.toString()}`, { method: "GET" }, token);
}

export async function startCall(token: string, leadId: string, processId: string): Promise<CallSession> {
  if (ENABLE_DEV_MOCKS && token === DEV_TOKEN) return mockCallSession(leadId);
  return request(
    "/v1/dialer/calls",
    {
      method: "POST",
      body: JSON.stringify({ lead_id: leadId, process_id: processId }),
    },
    token
  );
}

export async function updateCallStatus(token: string, callId: string, status: "answered" | "ended"): Promise<{ success: boolean }> {
  if (ENABLE_DEV_MOCKS && token === DEV_TOKEN) return { success: true };
  return request(
    `/v1/dialer/calls/${callId}/status`,
    {
      method: "PATCH",
      body: JSON.stringify({ status }),
    },
    token
  );
}

export async function saveDisposition(
  token: string,
  callId: string,
  data: DispositionPayload
): Promise<{ success: boolean; next_lead_id?: string }> {
  if (ENABLE_DEV_MOCKS && token === DEV_TOKEN) return { success: true };
  return request(
    `/v1/dialer/calls/${callId}/disposition`,
    {
      method: "POST",
      body: JSON.stringify(data),
    },
    token
  );
}

export async function getAgentDashboardSummary(token: string): Promise<AgentDashboardSummary> {
  const response = await request<{ ok: boolean; summary: AgentDashboardSummary }>(
    "/v1/dashboard/agent/summary",
    { method: "GET" },
    token
  );
  return response.summary;
}

export async function getAgentDashboardTrends(token: string): Promise<AgentDashboardTrends> {
  const response = await request<{ ok: boolean; trends: AgentDashboardTrends }>(
    "/v1/dashboard/agent/trends",
    { method: "GET" },
    token
  );
  return response.trends;
}

export async function getAgentFailureBreakdown(token: string): Promise<AgentFailureBreakdown> {
  const response = await request<{ ok: boolean; breakdown: AgentFailureBreakdown }>(
    "/v1/dashboard/agent/failure-breakdown",
    { method: "GET" },
    token
  );
  return response.breakdown;
}

export async function getAgentConversionFunnel(token: string): Promise<AgentConversionFunnel> {
  const response = await request<{ ok: boolean; funnel: AgentConversionFunnel }>(
    "/v1/dashboard/agent/conversion-funnel",
    { method: "GET" },
    token
  );
  return response.funnel;
}

export async function initiateOutboundCall(
  token: string,
  payload: OutboundCallRequest
): Promise<OutboundCallResponse> {
  return request(
    "/api/calls/outbound",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token
  );
}

export async function getOutboundCallStatus(token: string, callId: string): Promise<OutboundCallStatus> {
  return request(`/api/calls/${callId}/status`, { method: "GET" }, token);
}

export async function createHumanAgentCall(
  token: string,
  payload: HumanAgentCallRequest
): Promise<HumanAgentCallResponse> {
  return request(
    "/v1/agent-calls",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token
  );
}

export async function getHumanAgentCallStatus(
  token: string,
  callId: string
): Promise<HumanAgentCallStatus> {
  return request(`/v1/agent-calls/${callId}/status`, { method: "GET" }, token);
}

export async function hangupHumanAgentCall(token: string, callId: string): Promise<{ success: boolean }> {
  return request(`/v1/agent-calls/${callId}/hangup`, { method: "POST" }, token);
}

export async function saveHumanAgentDisposition(
  token: string,
  callId: string,
  data: DispositionPayload
): Promise<{ success: boolean }> {
  return request(
    `/v1/agent-calls/${callId}/disposition`,
    {
      method: "POST",
      body: JSON.stringify(data),
    },
    token
  );
}

export async function notifyHumanAgentJoined(token: string, callId: string): Promise<void> {
  await request(`/v1/agent-calls/${callId}/agent-joined`, { method: "POST" }, token);
}

export async function getCallHistory(
  token: string,
  params: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
    campaign_id?: string;
    date_from?: string;
    date_to?: string;
  } = {}
): Promise<CallHistoryResponse> {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.limit) query.set("limit", String(params.limit));
  if (params.search) query.set("search", params.search);
  if (params.status) query.set("status", params.status);
  if (params.campaign_id) query.set("campaign_id", params.campaign_id);
  if (params.date_from) query.set("date_from", params.date_from);
  if (params.date_to) query.set("date_to", params.date_to);

  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request(`/api/calls/history${suffix}`, { method: "GET" }, token);
}

export async function getCallHistoryDetail(
  token: string,
  callId: string
): Promise<CallHistoryDetailResponse> {
  return request(`/api/calls/history/${encodeURIComponent(callId)}`, { method: "GET" }, token);
}
