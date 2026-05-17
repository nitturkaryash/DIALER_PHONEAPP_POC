export type Agent = {
  id: string;
  email: string;
  full_name: string;
  role: string;
};

export type Campaign = {
  id: string;
  name: string;
  status: string;
  lead_count: number;
};

export type Lead = {
  id: string;
  name: string;
  phone: string;
  status: string;
  email?: string;
};

export type CallSession = {
  call_id: string;
  lead_name: string;
  phone: string;
};

export type Disposition = "Connected" | "No Answer" | "Busy" | "Call Later" | "Invalid";

export type DispositionPayload = {
  outcome: Disposition;
  notes?: string;
  callback_time?: string;
};

export type AgentDashboardSummary = {
  total_calls: number;
  connected_calls: number;
  failed_calls: number;
  fatal_calls: number;
  quality_score_avg: number;
  conversion_count: number;
  conversion_rate: number;
  avg_call_duration: number;
  talk_time_total: number;
  followups_due: number;
  lost_leads: number;
  ghost_leads: number;
  callbacks_booked: number;
};

export type AgentDashboardTrendPoint = {
  date: string;
  calls: number;
  connected_calls: number;
  fatal_calls: number;
  quality_score_avg: number;
  conversions: number;
};

export type AgentDashboardTrends = {
  last_7_days: AgentDashboardTrendPoint[];
  last_30_days: AgentDashboardTrendPoint[];
};

export type AgentFailureBreakdownItem = {
  reason: string;
  count: number;
};

export type AgentFailureCategoryItem = {
  category: string;
  count: number;
};

export type AgentFailureBreakdown = {
  fatal_reasons: AgentFailureBreakdownItem[];
  top_failed_qa_categories: AgentFailureCategoryItem[];
  coaching_insights: string[];
};

export type AgentConversionFunnel = {
  attempted: number;
  connected: number;
  qualified: number;
  converted: number;
  lost: number;
  conversion_rate: number;
};

export type OutboundCallRequest = {
  phone_number: string;
  customer_name: string;
};

export type OutboundCallResponse = {
  success: boolean;
  call_id: string;
  status: string;
  message?: string;
  provider?: string;
};

export type OutboundCallStatus = {
  call_id: string;
  status: string;
  phone_number: string;
  duration_seconds?: number | null;
  ended_at?: string | null;
};

export type HumanAgentCallRequest = {
  phone_number: string;
  customer_name: string;
  provider?: "auto" | "livekit-sip" | "livekit-issabel";
  campaign_id?: string;
  lead_id?: string;
};

export type HumanAgentCallResponse = {
  call_id: string;
  room_name: string;
  livekit_url: string;
  agent_token: string;
  agent_identity: string;
  status: string;
  provider: string;
  phone_number: string;
  customer_name: string;
};

export type HumanAgentCallStatus = {
  call_id: string;
  status: string;
  phone_number: string;
  room_name?: string | null;
  provider?: string | null;
  sip_joined_at?: string | null;
  agent_joined_at?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  duration_seconds?: number | null;
};
