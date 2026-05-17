import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { Audio } from "expo-av";
import Constants from "expo-constants";

import {
  getHumanAgentCallStatus,
  getToken,
  hangupHumanAgentCall,
  notifyHumanAgentJoined,
} from "../services/api";

export type HumanCallConnectParams = {
  callId: string;
  livekitUrl: string;
  agentToken: string;
  roomName: string;
};

export type HumanCallConnectionState = "idle" | "connecting" | "connected" | "disconnected" | "error";

type LiveKitRoom = {
  disconnect: () => Promise<void>;
  localParticipant?: {
    setMicrophoneEnabled: (enabled: boolean) => Promise<void>;
    isMicrophoneEnabled: boolean;
  };
};

const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "busy",
  "no_answer",
  "canceled",
  "cancelled",
  "ended",
]);

async function requestMicPermission(): Promise<boolean> {
  if (Platform.OS === "web") {
    if (!navigator.mediaDevices?.getUserMedia) {
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      return true;
    } catch {
      return false;
    }
  }
  const { status } = await Audio.requestPermissionsAsync();
  return status === "granted";
}

async function connectLiveKitRoom(params: HumanCallConnectParams): Promise<LiveKitRoom> {
  if (Platform.OS === "web") {
    const { Room, RoomEvent } = await import("livekit-client");
    const room = new Room({ adaptiveStream: true, dynacast: true });
    await room.connect(params.livekitUrl, params.agentToken);
    await room.localParticipant.setMicrophoneEnabled(true);
    room.on(RoomEvent.Disconnected, () => undefined);
    return room as unknown as LiveKitRoom;
  }

  // Expo Go cannot load @livekit/react-native native modules.
  // Human live audio requires a development build.
  if (Constants.appOwnership === "expo") {
    throw new Error("Live call audio is not supported in Expo Go. Use a development build.");
  }

  const { registerGlobals, AudioSession } = await import("@livekit/react-native");
  registerGlobals();
  await AudioSession.startAudioSession();
  const { Room } = await import("livekit-client");
  const room = new Room();
  await room.connect(params.livekitUrl, params.agentToken);
  await room.localParticipant.setMicrophoneEnabled(true);
  return room as unknown as LiveKitRoom;
}

export function useHumanAgentCall(params: HumanCallConnectParams) {
  const { callId, livekitUrl, agentToken, roomName } = params;
  const roomRef = useRef<LiveKitRoom | null>(null);
  const [connectionState, setConnectionState] = useState<HumanCallConnectionState>("idle");
  const [muted, setMuted] = useState(false);
  const [callStatus, setCallStatus] = useState("queued");
  const [error, setError] = useState("");

  const connect = useCallback(async () => {
    setConnectionState("connecting");
    setError("");
    try {
      const allowed = await requestMicPermission();
      if (!allowed) {
        throw new Error("Microphone permission is required for live calls");
      }
      const room = await connectLiveKitRoom({ callId, livekitUrl, agentToken, roomName });
      roomRef.current = room;
      setConnectionState("connected");
      const token = await getToken();
      if (token) {
        await notifyHumanAgentJoined(token, callId).catch(() => undefined);
      }
    } catch (e) {
      setConnectionState("error");
      setError(e instanceof Error ? e.message : "Failed to connect to call room");
    }
  }, [agentToken, callId, livekitUrl, roomName]);

  const disconnect = useCallback(async () => {
    const room = roomRef.current;
    roomRef.current = null;
    if (room) {
      try {
        await room.disconnect();
      } catch {
        // ignore teardown errors
      }
    }
    if (Platform.OS !== "web") {
      try {
        const { AudioSession } = await import("@livekit/react-native");
        await AudioSession.stopAudioSession();
      } catch {
        // ignore
      }
    }
    setConnectionState("disconnected");
  }, []);

  const toggleMute = useCallback(async () => {
    const room = roomRef.current;
    if (!room?.localParticipant) return;
    const next = !muted;
    await room.localParticipant.setMicrophoneEnabled(!next);
    setMuted(next);
  }, [muted]);

  const hangup = useCallback(async () => {
    const token = await getToken();
    if (token) {
      await hangupHumanAgentCall(token, callId).catch(() => undefined);
    }
    await disconnect();
  }, [callId, disconnect]);

  useEffect(() => {
    connect();
    return () => {
      disconnect().catch(() => undefined);
    };
  }, [connect, disconnect]);

  useEffect(() => {
    let mounted = true;
    let interval: ReturnType<typeof setInterval> | undefined;

    const poll = async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const data = await getHumanAgentCallStatus(token, callId);
        if (!mounted) return;
        setCallStatus(data.status);
        if (TERMINAL_STATUSES.has(data.status.toLowerCase())) {
          if (interval) clearInterval(interval);
        }
      } catch {
        // status polling is best-effort
      }
    };

    poll();
    interval = setInterval(poll, 2000);
    return () => {
      mounted = false;
      if (interval) clearInterval(interval);
    };
  }, [callId]);

  return {
    connectionState,
    callStatus,
    muted,
    error,
    toggleMute,
    hangup,
    disconnect,
  };
}
