import type { NavigatorScreenParams } from "@react-navigation/native";

import type { Lead } from "../types";

export type CampaignsStackParamList = {
  CampaignList: undefined;
  Leads: { processId: string; processName: string };
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
  HumanCall: {
    callId: string;
    phone: string;
    customerName: string;
    livekitUrl: string;
    agentToken: string;
    roomName: string;
  };
  Call: { processId: string; processName: string; lead: Lead };
  Disposition: {
    callId: string;
    lead: Lead;
    returnTo: "dial" | "leads";
    callMode?: "dialer" | "human";
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
};
