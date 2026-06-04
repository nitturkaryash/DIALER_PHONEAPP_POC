import type { NavigatorScreenParams } from "@react-navigation/native";

import type { Lead } from "../types";

export type CampaignsStackParamList = {
  CampaignList: undefined;
  Leads: { processId: string; processName: string; handler?: "ai" | "human" };
};

export type MainTabParamList = {
  Dashboard: undefined;
  Dial: undefined;
  Chats: undefined;
  CallHistory: undefined;
  Campaigns: NavigatorScreenParams<CampaignsStackParamList> | undefined;
};

export type RootStackParamList = {
  Login: undefined;
  MainTabs: NavigatorScreenParams<MainTabParamList> | undefined;
  OutboundCall: { callId: string; phone: string; customerName: string };
  /**
   * Agent-talks-on-phone live call. WebSocket PCM bridge to the backend.
   * Web target only — native needs additional audio integration.
   */
  HumanCall: {
    callId: string;
    phone: string;
    customerName: string;
  };
  Call: { processId: string; processName: string; lead: Lead; handler?: "ai" | "human" };
  Disposition: {
    callId: string;
    lead: Lead;
    returnTo: "dial" | "leads";
    processId?: string;
    processName?: string;
  };
  CallHistoryDetail: {
    callId: string;
  };
  ChatDetail: {
    contactId: string;
    contactName: string;
    contactPhone: string;
    contactInitials: string;
    contactOnline: boolean;
  };
  AgentStatus: undefined;
};
