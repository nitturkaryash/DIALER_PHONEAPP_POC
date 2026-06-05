import React, { useEffect, useState } from "react";
import { Platform } from "react-native";

import { isCommonsPcmAvailable } from "../hooks/commonsPcmTransport";
import type { AgentCallConnectionState } from "../hooks/agentAudioTypes";
import { useAgentAudioWebSocket } from "../hooks/useAgentAudioWebSocket";

export type HumanCallAudioState = {
  connectionState: AgentCallConnectionState;
  callStatus: string;
  muted: boolean;
  error: string;
  toggleMute: () => Promise<void>;
  hangup: () => Promise<void>;
  transport: "websocket" | "detecting" | "unavailable";
};

type BridgeProps = {
  callId: string;
  children: (audio: HumanCallAudioState) => React.ReactNode;
};

function WsBridge({ callId, children }: BridgeProps) {
  const audio = useAgentAudioWebSocket({ callId, enabled: true });
  return <>{children({ ...audio, transport: "websocket" })}</>;
}

const DETECTING: HumanCallAudioState = {
  connectionState: "waiting",
  callStatus: "queued",
  muted: false,
  error: "",
  toggleMute: async () => {},
  hangup: async () => {},
  transport: "detecting",
};

const UNAVAILABLE: HumanCallAudioState = {
  connectionState: "unavailable",
  callStatus: "queued",
  muted: false,
  error:
    "Commons PCM audio needs a dev build with native mic modules (not Expo Go).",
  toggleMute: async () => {},
  hangup: async () => {},
  transport: "unavailable",
};

/** Commons WS + 16 kHz PCM only (same path as web dialer). */
export function HumanCallAudioBridge({ callId, children }: BridgeProps) {
  const [pcmOk, setPcmOk] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    isCommonsPcmAvailable().then((ok) => {
      if (!cancelled) setPcmOk(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (pcmOk === null) return <>{children(DETECTING)}</>;
  if (!pcmOk) return <>{children(UNAVAILABLE)}</>;
  return <WsBridge callId={callId}>{children}</WsBridge>;
}

export function transportTipLabel(transport: HumanCallAudioState["transport"]): string {
  if (transport === "websocket") {
    return Platform.OS === "web"
      ? "Commons PCM audio (same as web dialer)."
      : "Commons PCM over WebSocket.";
  }
  if (transport === "detecting") return "Preparing Commons audio…";
  return "Audio unavailable on this build.";
}
