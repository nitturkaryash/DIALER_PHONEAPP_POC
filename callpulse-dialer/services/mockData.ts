import type {
  Agent,
  AgentStatusCode,
  Campaign,
  CallHistoryResponse,
  DispositionCatalogItem,
  Lead,
  OutboundCallRequest,
  OutboundCallResponse,
  OutboundCallStatus,
} from "../types";

export const DEV_TOKEN = "dev_token";
export const ENABLE_DEV_MOCKS = process.env.EXPO_PUBLIC_ENABLE_DEV_MOCKS === "true";

export const mockAgent: Agent = {
  id: "dev-agent-1",
  user_id: "dev-agent-1",
  tenant_id: "dev-tenant",
  email: "agent@callpulse.dev",
  full_name: "Dev Agent",
  display_name: "Dev Agent",
  role: "agent",
};

export const mockCampaigns: Campaign[] = [
  { id: "camp-1", name: "Q2 Outbound Leads", status: "active", handler: "human", total_contacts: 142, completed_contacts: 30 },
  { id: "camp-2", name: "Renewal Follow-up", status: "active", handler: "ai", total_contacts: 87, completed_contacts: 10 },
  { id: "camp-3", name: "Cold Prospects June", status: "paused", handler: "human", total_contacts: 310, completed_contacts: 0 },
  { id: "camp-4", name: "Warm Inbound List", status: "active", handler: "ai", total_contacts: 55, completed_contacts: 5 },
];

export const mockLeads: Lead[] = [
  { id: "lead-1", name: "Sarah Johnson", phone: "+15552043311", status: "pending", email: "sarah.j@email.com" },
  { id: "lead-2", name: "Michael Torres", phone: "+15558710092", status: "pending" },
  { id: "lead-3", name: "Emily Chen", phone: "+15554397761", status: "pending", email: "echen@work.com" },
  { id: "lead-4", name: "David Patel", phone: "+15556542200", status: "pending" },
  { id: "lead-5", name: "Rachel Kim", phone: "+15553219045", status: "called" },
  { id: "lead-6", name: "James Okafor", phone: "+15557881144", status: "pending" },
];

export const mockPauseCodes: AgentStatusCode[] = [
  { id: "ps-lunch", code: "LUNCH", label: "Lunch" },
  { id: "ps-bio", code: "BIO", label: "Bio Break" },
  { id: "ps-training", code: "TRAINING", label: "Training" },
  { id: "ps-meeting", code: "MEETING", label: "Team meeting" },
];

export const mockDispositions: DispositionCatalogItem[] = [
  { id: "disp-1", code: "CONNECTED", name: "Connected", active: true, requires_callback: false },
  { id: "disp-2", code: "NO_ANSWER", name: "No Answer", active: true, requires_callback: false },
  { id: "disp-3", code: "BUSY", name: "Busy", active: true, requires_callback: false },
  { id: "disp-4", code: "CALLBACK", name: "Call Later", active: true, requires_callback: true },
  { id: "disp-5", code: "INVALID", name: "Invalid Number", active: true, requires_callback: false },
];

export function mockOutboundCallResponse(payload: OutboundCallRequest): OutboundCallResponse {
  return {
    success: true,
    call_id: `mock-call-${Date.now()}`,
    status: "queued",
    message: `Dialing ${payload.phone_number}`,
    provider: "mock",
  };
}

export function mockOutboundCallStatus(callId: string): OutboundCallStatus {
  return {
    call_id: callId,
    status: "in_progress",
    phone_number: "+10000000000",
    handler: "human",
    agent_bridge_ready: true,
    started_at: new Date(Date.now() - 5000).toISOString(),
  };
}

export const mockCallHistory: CallHistoryResponse = {
  ok: true,
  calls: [
    {
      id: "h-1",
      call_id: "call-h-1",
      customer_name: "Sarah Johnson",
      phone_number: "+15552043311",
      status: "completed",
      campaign_name: "Q2 Outbound",
      started_at: new Date(Date.now() - 3600000).toISOString(),
      duration_seconds: 145,
      handler: "human",
      disposition: { id: "disp-1", code: "CONNECTED", name: "Connected" },
    },
    {
      id: "h-2",
      call_id: "call-h-2",
      customer_name: "Michael Torres",
      phone_number: "+15558710092",
      status: "no_answer",
      campaign_name: "Renewal Follow-up",
      started_at: new Date(Date.now() - 7200000).toISOString(),
      duration_seconds: 0,
      handler: "ai",
    },
    {
      id: "h-3",
      call_id: "call-h-3",
      customer_name: "Emily Chen",
      phone_number: "+15554397761",
      status: "completed",
      campaign_name: "Q2 Outbound",
      started_at: new Date(Date.now() - 86400000).toISOString(),
      duration_seconds: 210,
      handler: "human",
      disposition: { id: "disp-1", code: "CONNECTED", name: "Connected" },
    },
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

export type TimelineEventType =
  | "call_outbound"
  | "call_inbound"
  | "message_sent"
  | "message_received"
  | "disposition"
  | "followup_scheduled"
  | "note"
  | "ai_call";

export type TimelineEvent = {
  id: string;
  type: TimelineEventType;
  timestamp: string;
  title: string;
  subtitle: string;
  outcome?: string;
  outcomeSentiment?: "positive" | "neutral" | "negative";
  agentName?: string;
  duration?: string;
};

export type LeadTimeline = {
  contactId: string;
  events: TimelineEvent[];
};

export const MOCK_TIMELINES: LeadTimeline[] = [
  {
    contactId: "1",
    events: [
      {
        id: "e1",
        type: "call_outbound",
        timestamp: "2026-05-29T06:00:00Z",
        title: "Outbound call",
        subtitle: "Q2 Outbound campaign",
        outcome: "Completed",
        outcomeSentiment: "positive",
        agentName: "You",
        duration: "2m 14s",
      },
      {
        id: "e2",
        type: "disposition",
        timestamp: "2026-05-29T06:02:30Z",
        title: "Disposition logged",
        subtitle: "Interested — wants callback next week",
        outcomeSentiment: "positive",
        agentName: "You",
      },
      {
        id: "e3",
        type: "followup_scheduled",
        timestamp: "2026-05-29T06:03:00Z",
        title: "Follow-up scheduled",
        subtitle: "Fri 5 Jun at 10:00 AM",
        outcomeSentiment: "neutral",
      },
      {
        id: "e4",
        type: "message_sent",
        timestamp: "2026-05-28T14:20:00Z",
        title: "WhatsApp message sent",
        subtitle: "Hi, your policy is up for renewal soon...",
        outcomeSentiment: "neutral",
        agentName: "You",
      },
      {
        id: "e5",
        type: "message_received",
        timestamp: "2026-05-28T14:45:00Z",
        title: "WhatsApp reply received",
        subtitle: "Sure, please call me tomorrow morning.",
        outcomeSentiment: "positive",
      },
      {
        id: "e6",
        type: "call_outbound",
        timestamp: "2026-05-27T09:00:00Z",
        title: "Outbound call",
        subtitle: "Q2 Outbound campaign",
        outcome: "No answer",
        outcomeSentiment: "negative",
        agentName: "You",
        duration: "0m",
      },
      {
        id: "e7",
        type: "ai_call",
        timestamp: "2026-05-26T08:30:00Z",
        title: "AI voice call",
        subtitle: "Renewal reminder — auto dialer",
        outcome: "Voicemail left",
        outcomeSentiment: "neutral",
      },
      {
        id: "e8",
        type: "note",
        timestamp: "2026-05-25T11:00:00Z",
        title: "Note added",
        subtitle: "Customer mentioned comparing with HDFC. Follow up with competitive offer.",
        outcomeSentiment: "neutral",
        agentName: "You",
      },
    ],
  },
  {
    contactId: "2",
    events: [
      {
        id: "e9",
        type: "call_outbound",
        timestamp: "2026-05-29T05:00:00Z",
        title: "Outbound call",
        subtitle: "Renewal Follow-up campaign",
        outcome: "No answer",
        outcomeSentiment: "negative",
        agentName: "You",
        duration: "0m",
      },
      {
        id: "e10",
        type: "call_outbound",
        timestamp: "2026-05-28T10:00:00Z",
        title: "Outbound call",
        subtitle: "Renewal Follow-up campaign",
        outcome: "No answer",
        outcomeSentiment: "negative",
        agentName: "You",
        duration: "0m",
      },
      {
        id: "e11",
        type: "message_sent",
        timestamp: "2026-05-27T09:00:00Z",
        title: "WhatsApp message sent",
        subtitle: "Hi, we tried reaching you. Please let us know a good time to call.",
        outcomeSentiment: "neutral",
        agentName: "You",
      },
    ],
  },
  {
    contactId: "3",
    events: [
      {
        id: "e12",
        type: "call_outbound",
        timestamp: "2026-05-28T07:00:00Z",
        title: "Outbound call",
        subtitle: "Q2 Outbound campaign",
        outcome: "Completed",
        outcomeSentiment: "positive",
        agentName: "You",
        duration: "3m 05s",
      },
      {
        id: "e13",
        type: "disposition",
        timestamp: "2026-05-28T07:03:30Z",
        title: "Disposition logged",
        subtitle: "Policy renewed — payment confirmed",
        outcomeSentiment: "positive",
        agentName: "You",
      },
    ],
  },
];
