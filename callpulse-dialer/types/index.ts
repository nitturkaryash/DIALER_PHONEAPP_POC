export type Agent = {
  id: string;
  user_id?: string;
  tenant_id?: string | null;
  email: string;
  role: string;
  display_name?: string | null;
  full_name?: string | null;
  company_name?: string | null;
  phone?: string | null;
};

export type LoginResponse = {
  status: string;
  data: {
    user: {
      id: string;
      email: string;
      tenant_id?: string | null;
      full_name?: string | null;
      display_name?: string | null;
      company_name?: string | null;
      phone?: string | null;
      role: string;
    };
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: "bearer";
  };
};

export type Campaign = {
  id: string;
  name: string;
  status: string;
  handler?: string;
  total_contacts?: number;
  completed_contacts?: number;
  pending_contacts?: number;
  assigned_agents?: string[];
  created_at?: string | null;
  ai_config?: Record<string, unknown> | null;
};

export type CampaignListResponse = {
  ok: boolean;
  campaigns: Campaign[];
  pagination?: { total?: number; page?: number; limit?: number };
};

export type CampaignContact = {
  id: string;
  campaign_id: string;
  phone_number: string;
  customer_name?: string | null;
  state?: string;
  assigned_agent_id?: string | null;
  csv_payload?: Record<string, string> | null;
  attempts?: number;
};

export type CampaignDetailResponse = {
  ok: boolean;
  campaign: Campaign;
  contacts: CampaignContact[];
  pagination?: { total?: number; page?: number; limit?: number };
};

export type Lead = {
  id: string;
  name: string;
  phone: string;
  status: string;
  email?: string;
  campaign_id?: string;
  attempts?: number;
};

export function contactToLead(contact: CampaignContact): Lead {
  const csv = contact.csv_payload || {};
  const name = (contact.customer_name as string) || (csv.name as string) || (csv.customer_name as string) || "Unknown";
  return {
    id: contact.id,
    name,
    phone: contact.phone_number,
    status: (contact.state || "pending").toLowerCase(),
    email: (csv.email as string) || undefined,
    campaign_id: contact.campaign_id,
    attempts: contact.attempts || 0,
  };
}

export type DispositionCatalogItem = {
  id: string;
  user_id?: string;
  code: string;
  name: string;
  description?: string | null;
  active: boolean;
  requires_callback: boolean;
  created_at?: string;
  updated_at?: string;
};

export type DispositionListResponse = {
  ok: boolean;
  dispositions: DispositionCatalogItem[];
};

export type DispositionPayload = {
  disposition_id: string | null;
  notes?: string | null;
};

export type OutboundCallRequest = {
  phone_number: string;
  customer_name: string;
  customer_id?: string;
  handler?: "ai" | "human";
  verification_context?: {
    campaign_id?: string;
    campaign_contact_id?: string;
    assigned_agent_id?: string;
    handler?: "ai" | "human";
  };
  initial_greeting?: string;
  bot_system_prompt?: string;
  voice_agent?: string;
  tts_language?: string;
};

export type OutboundCallResponse = {
  success: boolean;
  call_id: string;
  status?: string;
  message?: string;
  provider?: string;
  // backend may surface these in handler-specific responses:
  agent_audio_ws_path?: string;
};

export type OutboundCallStatus = {
  call_id: string;
  status: string;
  phone_number: string;
  handler?: string | null;
  /** True when Issabel/Exotel human bridge is up — safe to open agent-audio WebSocket. */
  agent_bridge_ready?: boolean;
  call_requested_at?: string | null;
  sip_joined_at?: string | null;
  first_bot_audio_at?: string | null;
  first_user_audio_at?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  duration_seconds?: number | null;
};

export type CallDispositionRef = {
  id: string;
  code: string;
  name: string;
};

export type CallHistoryItem = {
  id: string;
  call_id: string;
  customer_name: string;
  phone_number: string;
  status: string;
  campaign_name?: string | null;
  started_at?: string | null;
  duration_seconds?: number | null;
  handler?: string;
  disposition_id?: string | null;
  disposition?: CallDispositionRef | null;
  wrapped_at?: string | null;
  notes?: string | null;
};

export type CallHistorySummaryItem = {
  campaign_id?: string | null;
  campaign_name: string;
  total_calls: number;
  total_duration_seconds: number;
};

export type CallHistorySummary = {
  total_calls: number;
  completed_calls: number;
  total_duration_seconds: number;
  campaign_total_duration_seconds?: number;
  direct_total_duration_seconds?: number;
  campaign_breakdown?: CallHistorySummaryItem[];
};

export type CallHistoryPagination = {
  total: number;
  page: number;
  limit: number;
  total_pages: number;
};

export type CallHistoryResponse = {
  ok: boolean;
  calls: CallHistoryItem[];
  summary: CallHistorySummary;
  pagination: CallHistoryPagination;
};

export type CallHistoryDetail = CallHistoryItem & {
  ended_at?: string | null;
  created_at?: string | null;
  audio_url?: string | null;
  transcription?: string | null;
};

export type CallHistoryDetailResponse = {
  ok: boolean;
  call: CallHistoryDetail;
};

export type ConversationEvent = {
  call_id: string;
  speaker?: string;
  text?: string;
  type?: string;
  created_at?: string;
  payload?: Record<string, unknown>;
};

export type ConversationResponse = {
  ok: boolean;
  events: ConversationEvent[];
  booking?: Record<string, unknown> | null;
};

export type AgentStatusCode = {
  id: string;
  code: string;
  label: string;
  created_at?: string;
};

export type AgentStatusCodesResponse = {
  ok: boolean;
  codes: AgentStatusCode[];
};

export type AgentStatusCurrent = {
  id: string;
  user_id?: string;
  agent_id?: string;
  agent_status_id: string;
  started_at: string;
  ended_at?: string | null;
  duration_seconds?: number | null;
};

export type AgentStatusCurrentResponse = {
  ok: boolean;
  current: AgentStatusCurrent | null;
};

export type AgentStatusSelectResponse = {
  ok: boolean;
  tracking_id: string;
  started_at: string;
};

export type AgentStatusClearResponse = {
  ok: boolean;
  closed: boolean;
};

export type AgentStatusSummaryItem = {
  code: string;
  label: string;
  duration_seconds: number;
};

export type AgentStatusSummaryResponse = {
  ok: boolean;
  summary: AgentStatusSummaryItem[];
};

// Disposition outcome used purely for UI grouping if no catalog code matches
export type Disposition = "Connected" | "No Answer" | "Busy" | "Call Later" | "Invalid";
