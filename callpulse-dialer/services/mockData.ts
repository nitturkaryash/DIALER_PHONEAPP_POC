import type { Agent, Campaign, CallSession, Lead } from "../types";

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
