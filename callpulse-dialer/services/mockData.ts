import type {
  Agent, Campaign, CallSession, Lead,
  AgentDashboardSummary, AgentDashboardTrends,
  AgentFailureBreakdown, AgentConversionFunnel,
  CallHistoryResponse,
} from "../types";

export const DEV_TOKEN = "dev_token";

export const mockAgent: Agent = {
  id: "dev-agent-1",
  email: "agent@callpulse.dev",
  full_name: "Dev Agent",
  role: "agent",
};

export const mockCampaigns: Campaign[] = [
  { id: "camp-1", name: "Q2 Outbound Leads", status: "active", lead_count: 142 },
  { id: "camp-2", name: "Renewal Follow-up", status: "active", lead_count: 87 },
  { id: "camp-3", name: "Cold Prospects June", status: "paused", lead_count: 310 },
  { id: "camp-4", name: "Warm Inbound List", status: "active", lead_count: 55 },
];

export const mockLeads: Lead[] = [
  { id: "lead-1", name: "Sarah Johnson", phone: "+1 (555) 204-3311", status: "pending", email: "sarah.j@email.com" },
  { id: "lead-2", name: "Michael Torres", phone: "+1 (555) 871-0092", status: "pending" },
  { id: "lead-3", name: "Emily Chen", phone: "+1 (555) 439-7761", status: "pending", email: "echen@work.com" },
  { id: "lead-4", name: "David Patel", phone: "+1 (555) 654-2200", status: "pending" },
  { id: "lead-5", name: "Rachel Kim", phone: "+1 (555) 321-9045", status: "called" },
  { id: "lead-6", name: "James Okafor", phone: "+1 (555) 788-1144", status: "pending" },
];

export function mockCallSession(leadId: string): CallSession {
  return {
    call_id: `call-dev-${leadId}-${Date.now()}`,
    lead_name: mockLeads.find((l) => l.id === leadId)?.name ?? "Unknown",
    phone: mockLeads.find((l) => l.id === leadId)?.phone ?? "",
  };
}

export const mockDashboardSummary: AgentDashboardSummary = {
  total_calls: 48,
  connected_calls: 35,
  failed_calls: 8,
  fatal_calls: 5,
  quality_score_avg: 78,
  conversion_count: 12,
  conversion_rate: 34.3,
  avg_call_duration: 142,
  talk_time_total: 6816,
  followups_due: 4,
  lost_leads: 3,
  ghost_leads: 2,
  callbacks_booked: 7,
};

const today = new Date();
function daysAgo(n: number) {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export const mockDashboardTrends: AgentDashboardTrends = {
  last_7_days: Array.from({ length: 7 }, (_, i) => ({
    date: daysAgo(6 - i),
    calls: 4 + Math.floor(Math.random() * 8),
    connected_calls: 3 + Math.floor(Math.random() * 5),
    fatal_calls: Math.floor(Math.random() * 2),
    quality_score_avg: 70 + Math.floor(Math.random() * 20),
    conversions: Math.floor(Math.random() * 3),
  })),
  last_30_days: Array.from({ length: 30 }, (_, i) => ({
    date: daysAgo(29 - i),
    calls: 3 + Math.floor(Math.random() * 10),
    connected_calls: 2 + Math.floor(Math.random() * 7),
    fatal_calls: Math.floor(Math.random() * 3),
    quality_score_avg: 65 + Math.floor(Math.random() * 25),
    conversions: Math.floor(Math.random() * 4),
  })),
};

export const mockFailureBreakdown: AgentFailureBreakdown = {
  fatal_reasons: [
    { reason: "No answer", count: 12 },
    { reason: "Busy", count: 7 },
    { reason: "Wrong number", count: 3 },
  ],
  top_failed_qa_categories: [
    { category: "Objection handling", count: 8 },
    { category: "Closing", count: 5 },
  ],
  coaching_insights: [
    "Focus on objection handling — most losses happen at the 2-minute mark.",
    "Shorter openings correlated with higher connection rates.",
  ],
};

export const mockConversionFunnel: AgentConversionFunnel = {
  attempted: 48,
  connected: 35,
  qualified: 20,
  converted: 12,
  lost: 8,
  conversion_rate: 34.3,
};

export const mockCallHistory: CallHistoryResponse = {
  ok: true,
  calls: [
    { id: "h-1", call_id: "call-h-1", customer_name: "Sarah Johnson", phone_number: "+15552043311", status: "completed", campaign_name: "Q2 Outbound", started_at: new Date(Date.now() - 3600000).toISOString(), duration_seconds: 145 },
    { id: "h-2", call_id: "call-h-2", customer_name: "Michael Torres", phone_number: "+15558710092", status: "no_answer", campaign_name: "Renewal Follow-up", started_at: new Date(Date.now() - 7200000).toISOString(), duration_seconds: 0 },
    { id: "h-3", call_id: "call-h-3", customer_name: "Emily Chen", phone_number: "+15554397761", status: "completed", campaign_name: "Q2 Outbound", started_at: new Date(Date.now() - 86400000).toISOString(), duration_seconds: 210 },
  ],
  summary: {
    total_calls: 48,
    completed_calls: 35,
    total_duration_seconds: 6816,
    campaign_total_duration_seconds: 5200,
    direct_total_duration_seconds: 1616,
    campaign_breakdown: [
      { campaign_id: "camp-1", campaign_name: "Q2 Outbound Leads", total_calls: 28, total_duration_seconds: 3800 },
      { campaign_id: "camp-2", campaign_name: "Renewal Follow-up", total_calls: 20, total_duration_seconds: 3016 },
    ],
  },
  pagination: { total: 3, page: 1, limit: 20, total_pages: 1 },
};
