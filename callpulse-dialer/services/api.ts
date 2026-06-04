import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

import type {
  Agent,
  AgentStatusClearResponse,
  AgentStatusCodesResponse,
  AgentStatusCurrentResponse,
  AgentStatusSelectResponse,
  AgentStatusSummaryResponse,
  Campaign,
  CampaignContact,
  CampaignDetailResponse,
  CampaignListResponse,
  CallHistoryDetailResponse,
  CallHistoryResponse,
  ConversationResponse,
  DispositionCatalogItem,
  DispositionListResponse,
  DispositionPayload,
  Lead,
  LoginResponse,
  OutboundCallRequest,
  OutboundCallResponse,
  OutboundCallStatus,
} from "../types";
import { contactToLead } from "../types";
import {
  DEV_TOKEN,
  ENABLE_DEV_MOCKS,
  mockAgent,
  mockCallHistory,
  mockCampaigns,
  mockDispositions,
  mockLeads,
  mockOutboundCallResponse,
  mockOutboundCallStatus,
  mockPauseCodes,
} from "./mockData";

// ─── Configuration ──────────────────────────────────────────────────────────

/** Voice-Assisstant-Backend base URL (all calling, campaign, history, agent-status APIs). */
export const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000";

/** Qualia-Commons-Backend base URL (login / refresh / me). */
export const COMMONS_URL = process.env.EXPO_PUBLIC_COMMONS_API_URL ?? "http://localhost:4100";

export const TOKEN_KEY = "callpulse_access_token";
export const REFRESH_TOKEN_KEY = "callpulse_refresh_token";

export class AuthError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "AuthError";
  }
}

// ─── Token storage (SecureStore on native, localStorage on web) ─────────────

async function readKey(key: string): Promise<string | null> {
  if (Platform.OS === "web") return localStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}

async function writeKey(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function deleteKey(key: string): Promise<void> {
  if (Platform.OS === "web") {
    localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export async function getToken(): Promise<string | null> {
  return readKey(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  await writeKey(TOKEN_KEY, token);
}

export async function getRefreshToken(): Promise<string | null> {
  return readKey(REFRESH_TOKEN_KEY);
}

export async function setRefreshToken(token: string): Promise<void> {
  await writeKey(REFRESH_TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await deleteKey(TOKEN_KEY);
  await deleteKey(REFRESH_TOKEN_KEY);
}

// ─── Generic request helper ─────────────────────────────────────────────────

type RequestOptions = RequestInit & { baseUrl?: string };

async function request<T>(path: string, options: RequestOptions = {}, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const baseUrl = options.baseUrl ?? BASE_URL;
  const { baseUrl: _ignored, ...fetchOptions } = options;
  const response = await fetch(`${baseUrl}${path}`, { ...fetchOptions, headers });

  if (response.status === 401) {
    await clearToken();
    throw new AuthError("Session expired");
  }

  if (!response.ok) {
    const text = await response.text();
    try {
      const json = JSON.parse(text) as { detail?: string | { msg?: string }[]; message?: string; error?: { message?: string } };
      if (typeof json.detail === "string") throw new Error(json.detail);
      if (Array.isArray(json.detail) && json.detail[0]?.msg) throw new Error(json.detail[0].msg);
      if (json.message) throw new Error(json.message);
      if (json.error?.message) throw new Error(json.error.message);
    } catch (e) {
      if (e instanceof Error && e.message !== text) throw e;
    }
    throw new Error(text || `Request failed (${response.status})`);
  }

  if (response.status === 204) return {} as T;
  return (await response.json()) as T;
}

// ─── Auth (Qualia-Commons-Backend) ──────────────────────────────────────────

/** Sign in via Qualia Commons. Returns {access_token, refresh_token, user}. */
export async function login(email: string, password: string): Promise<LoginResponse["data"]> {
  const response = await request<LoginResponse>(
    "/auth/login",
    {
      method: "POST",
      body: JSON.stringify({ email, password }),
      baseUrl: COMMONS_URL,
    }
  );
  return response.data;
}

/** Refresh an expired access token via Commons. */
export async function refresh(refreshToken: string): Promise<LoginResponse["data"]> {
  const response = await request<LoginResponse>(
    "/auth/refresh",
    {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken }),
      baseUrl: COMMONS_URL,
    }
  );
  return response.data;
}

/** Sign out: revoke the refresh token on Commons (best-effort). */
export async function logout(): Promise<void> {
  const refreshToken = await getRefreshToken();
  if (refreshToken) {
    try {
      await request(
        "/auth/logout",
        {
          method: "POST",
          body: JSON.stringify({ refresh_token: refreshToken }),
          baseUrl: COMMONS_URL,
        }
      );
    } catch {
      // best-effort: server may already have rotated the token
    }
  }
  await clearToken();
}

/** Get the current authenticated user (uses Voice backend's /api/auth/me, which decodes the Commons JWT). */
export async function getMe(token: string): Promise<Agent> {
  if (ENABLE_DEV_MOCKS && token === DEV_TOKEN) return mockAgent;
  const response = await request<{ ok: boolean; user: Agent }>("/api/auth/me", { method: "GET" }, token);
  return response.user;
}

// ─── Campaigns ──────────────────────────────────────────────────────────────

export async function getCampaigns(token: string, page = 1, limit = 50): Promise<Campaign[]> {
  if (ENABLE_DEV_MOCKS && token === DEV_TOKEN) return mockCampaigns;
  const response = await request<CampaignListResponse>(
    `/api/campaigns?page=${page}&limit=${limit}`,
    { method: "GET" },
    token
  );
  return response.campaigns || [];
}

export async function getCampaignDetail(
  token: string,
  campaignId: string,
  page = 1,
  limit = 500
): Promise<CampaignDetailResponse> {
  return request(
    `/api/campaigns/${encodeURIComponent(campaignId)}?page=${page}&limit=${limit}`,
    { method: "GET" },
    token
  );
}

/** Fetch leads for a campaign (mapped from CampaignContact). Optional status filter (case-insensitive). */
export async function getLeads(token: string, campaignId: string, status = "pending"): Promise<Lead[]> {
  if (ENABLE_DEV_MOCKS && token === DEV_TOKEN) {
    if (!status || status === "all") return mockLeads;
    return mockLeads.filter((l) => l.status.toLowerCase() === status.toLowerCase());
  }
  const detail = await getCampaignDetail(token, campaignId, 1, 500);
  const leads = (detail.contacts || []).map(contactToLead);
  if (!status || status === "all") return leads;
  return leads.filter((l) => l.status === status.toLowerCase());
}

// ─── Outbound calls ─────────────────────────────────────────────────────────

/** Start an outbound call. handler="human" = agent talks (WebSocket bridge); handler="ai" = bot talks. */
export async function initiateOutboundCall(
  token: string,
  payload: OutboundCallRequest
): Promise<OutboundCallResponse> {
  if (ENABLE_DEV_MOCKS && token === DEV_TOKEN) return mockOutboundCallResponse(payload);
  return request(
    "/api/calls/outbound",
    { method: "POST", body: JSON.stringify(payload) },
    token
  );
}

export async function getOutboundCallStatus(token: string, callId: string): Promise<OutboundCallStatus> {
  if (ENABLE_DEV_MOCKS && token === DEV_TOKEN) return mockOutboundCallStatus(callId);
  return request(`/api/calls/${encodeURIComponent(callId)}/status`, { method: "GET" }, token);
}

export async function hangupCall(token: string, callId: string): Promise<{ ok: boolean; success: boolean }> {
  if (ENABLE_DEV_MOCKS && token === DEV_TOKEN) return { ok: true, success: true };
  return request(`/api/calls/${encodeURIComponent(callId)}/hangup`, { method: "POST" }, token);
}

/** Build the WebSocket URL for the agent's audio bridge on a given call. JWT goes in the query string. */
export function buildAgentAudioWsUrl(callId: string, token: string): string {
  const wsBase = BASE_URL.replace(/^http/i, "ws");
  return `${wsBase}/api/calls/${encodeURIComponent(callId)}/agent-audio?token=${encodeURIComponent(token)}`;
}

// ─── Dispositions ───────────────────────────────────────────────────────────

export async function getDispositionCatalog(token: string): Promise<DispositionCatalogItem[]> {
  if (ENABLE_DEV_MOCKS && token === DEV_TOKEN) return mockDispositions;
  const response = await request<DispositionListResponse>(
    "/api/disposition?skip=0&limit=200",
    { method: "GET" },
    token
  );
  return response.dispositions || [];
}

/** Save the disposition + notes for a finished call. */
export async function saveCallDisposition(
  token: string,
  callId: string,
  payload: DispositionPayload
): Promise<void> {
  if (ENABLE_DEV_MOCKS && token === DEV_TOKEN) return;
  await request(
    `/api/calls/history/${encodeURIComponent(callId)}/disposition`,
    { method: "PUT", body: JSON.stringify(payload) },
    token
  );
}

// ─── Agent status (pause codes) ─────────────────────────────────────────────

export async function getAgentStatusCodes(token: string): Promise<AgentStatusCodesResponse["codes"]> {
  if (ENABLE_DEV_MOCKS && token === DEV_TOKEN) return mockPauseCodes;
  const response = await request<AgentStatusCodesResponse>(
    "/api/agent-status/codes?skip=0&limit=100",
    { method: "GET" },
    token
  );
  return response.codes || [];
}

export async function getCurrentAgentStatus(
  token: string,
  agentId?: string
): Promise<AgentStatusCurrentResponse["current"]> {
  if (ENABLE_DEV_MOCKS && token === DEV_TOKEN) return null;
  const suffix = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : "";
  const response = await request<AgentStatusCurrentResponse>(
    `/api/agent-status/current${suffix}`,
    { method: "GET" },
    token
  );
  return response.current;
}

export async function selectAgentStatus(
  token: string,
  agentStatusId: string,
  agentId?: string
): Promise<AgentStatusSelectResponse> {
  if (ENABLE_DEV_MOCKS && token === DEV_TOKEN) {
    return { ok: true, tracking_id: `mock-${Date.now()}`, started_at: new Date().toISOString() };
  }
  return request(
    "/api/agent-status/select",
    {
      method: "POST",
      body: JSON.stringify({ agent_status_id: agentStatusId, agent_id: agentId }),
    },
    token
  );
}

export async function clearAgentStatus(
  token: string,
  agentId?: string
): Promise<AgentStatusClearResponse> {
  if (ENABLE_DEV_MOCKS && token === DEV_TOKEN) return { ok: true, closed: true };
  return request(
    "/api/agent-status/clear",
    {
      method: "POST",
      body: JSON.stringify({ agent_id: agentId }),
    },
    token
  );
}

export async function getAgentStatusSummary(
  token: string,
  agentId?: string
): Promise<AgentStatusSummaryResponse["summary"]> {
  if (ENABLE_DEV_MOCKS && token === DEV_TOKEN) return [];
  const suffix = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : "";
  const response = await request<AgentStatusSummaryResponse>(
    `/api/agent-status/summary${suffix}`,
    { method: "GET" },
    token
  );
  return response.summary || [];
}

// ─── Call history & conversation ────────────────────────────────────────────

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
    disposition_id?: string;
  } = {}
): Promise<CallHistoryResponse> {
  if (ENABLE_DEV_MOCKS && token === DEV_TOKEN) return mockCallHistory;
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.limit) query.set("limit", String(params.limit));
  if (params.search) query.set("search", params.search);
  if (params.status) query.set("status", params.status);
  if (params.campaign_id) query.set("campaign_id", params.campaign_id);
  if (params.date_from) query.set("date_from", params.date_from);
  if (params.date_to) query.set("date_to", params.date_to);
  if (params.disposition_id) query.set("disposition_id", params.disposition_id);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request(`/api/calls/history${suffix}`, { method: "GET" }, token);
}

export async function getCallHistoryDetail(
  token: string,
  callId: string
): Promise<CallHistoryDetailResponse> {
  return request(`/api/calls/history/${encodeURIComponent(callId)}`, { method: "GET" }, token);
}

export async function getConversation(token: string, callId: string): Promise<ConversationResponse> {
  return request(`/api/conversations/${encodeURIComponent(callId)}`, { method: "GET" }, token);
}
