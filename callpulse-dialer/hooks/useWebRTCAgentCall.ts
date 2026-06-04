/**
 * Production-grade agent audio leg over WebRTC.
 *
 * Pattern matches the commons WebSocket dialer:
 *   • Mount → pre-warm the mic permission only (so the prompt appears
 *     immediately, not 10 s later). NO RTCPeerConnection yet.
 *   • Status === in_progress (customer answered) → create the PC, add the
 *     track, gather ICE, POST the offer, set the remote description. Just
 *     like the WebSocket dialer would open its socket only after the call
 *     is live.
 *
 * Why not pre-build the PC at mount? Browsers add the local track to the
 * encoder pipeline as soon as it's attached, and if the track sits there
 * for ~10 s before the remote SDP arrives, some browsers ship a backlog of
 * captured audio at the moment of negotiation — which lands as 1.7-2 ×
 * real-time audio at the customer's end ("slow / weird voice"). The backend
 * also enforces a paced sender as a safety net, but this is the structural
 * fix.
 *
 *   • Web (browser): native `RTCPeerConnection`.
 *   • Native (EAS dev build): `@livekit/react-native-webrtc` with the same shape.
 *   • Expo Go: native modules aren't linked → reports `unavailable`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";

import { BASE_URL, getOutboundCallStatus, getToken, hangupCall } from "../services/api";

export type AgentCallConnectionState =
  | "idle"
  | "waiting"
  | "connecting"
  | "connected"
  | "disconnected"
  | "unavailable"
  | "error";

const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "busy",
  "no_answer",
  "canceled",
  "cancelled",
  "ended",
]);

const ACTIVE_STATUSES = new Set(["in_progress", "connected", "live", "answered"]);

const REMOTE_AUDIO_ELEMENT_ID = "callpulse-agent-remote-audio";

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  {
    urls: [
      "turn:openrelay.metered.ca:80",
      "turn:openrelay.metered.ca:443",
      "turn:openrelay.metered.ca:443?transport=tcp",
    ],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

const log = (...args: unknown[]) => {
  console.log("[WebRTC]", ...args);
};
const warn = (...args: unknown[]) => {
  console.warn("[WebRTC]", ...args);
};

// ─── Platform-specific RTC API loading ─────────────────────────────────────

type RTCApis = {
  RTCPeerConnection: any;
  RTCSessionDescription: any;
  getUserMedia: (constraints: { audio: boolean | object }) => Promise<any>;
};

let nativeApisPromise: Promise<RTCApis | null> | null = null;

async function loadNativeApisOnce(): Promise<RTCApis | null> {
  if (Constants.appOwnership === "expo") {
    log("appOwnership === 'expo' → native WebRTC unavailable in Expo Go");
    return null;
  }
  try {
    log("importing @livekit/react-native-webrtc…");
    const lk: any = await import("@livekit/react-native-webrtc");
    if (typeof lk.registerGlobals === "function") {
      try {
        lk.registerGlobals();
        log("registerGlobals() done");
      } catch (e) {
        warn("registerGlobals() threw:", e);
      }
    }
    if (!lk.RTCPeerConnection || !lk.mediaDevices) {
      warn("native module missing RTCPeerConnection / mediaDevices");
      return null;
    }
    return {
      RTCPeerConnection: lk.RTCPeerConnection,
      RTCSessionDescription: lk.RTCSessionDescription,
      getUserMedia: (c) => lk.mediaDevices.getUserMedia(c),
    };
  } catch (e) {
    warn("Failed to load @livekit/react-native-webrtc:", e);
    return null;
  }
}

async function loadRTCApis(): Promise<RTCApis | null> {
  if (Platform.OS === "web") {
    if (typeof window === "undefined") return null;
    const w = window as any;
    if (!w.RTCPeerConnection || !navigator?.mediaDevices?.getUserMedia) return null;
    return {
      RTCPeerConnection: w.RTCPeerConnection,
      RTCSessionDescription: w.RTCSessionDescription,
      getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
    };
  }
  if (!nativeApisPromise) {
    nativeApisPromise = loadNativeApisOnce();
  }
  return nativeApisPromise;
}

function attachRemoteStreamToDom(stream: any): void {
  if (typeof document === "undefined") return;
  let el = document.getElementById(REMOTE_AUDIO_ELEMENT_ID) as HTMLAudioElement | null;
  if (!el) {
    el = document.createElement("audio");
    el.id = REMOTE_AUDIO_ELEMENT_ID;
    el.autoplay = true;
    el.style.display = "none";
    (el as any).playsInline = true;
    el.muted = false;
    el.volume = 1.0;
    document.body.appendChild(el);
  }
  el.srcObject = stream;
  el.play().catch(() => undefined);
}

function detachRemoteStreamFromDom(): void {
  if (typeof document === "undefined") return;
  const el = document.getElementById(REMOTE_AUDIO_ELEMENT_ID) as HTMLAudioElement | null;
  if (el) {
    el.srcObject = null;
    el.remove();
  }
}

async function waitForIceGathering(pc: any, timeoutMs = 6000): Promise<void> {
  if (pc.iceGatheringState === "complete") return;
  await new Promise<void>((resolve) => {
    let resolved = false;
    const done = (reason: string) => {
      if (resolved) return;
      resolved = true;
      log(`ICE gathering finished (${reason})`);
      try {
        pc.onicegatheringstatechange = null;
        pc.onicecandidate = null;
      } catch {
        /* noop */
      }
      // 100 ms grace so rn-webrtc finishes writing candidates into the SDP.
      setTimeout(resolve, 100);
    };
    pc.onicecandidate = (ev: any) => {
      const cand = ev?.candidate;
      if (cand == null) {
        done("onicecandidate(null)");
        return;
      }
      const line: string = cand.candidate || "";
      if (line) log("  cand:", line.substring(0, 100));
    };
    pc.onicegatheringstatechange = () => {
      log("iceGatheringState:", pc.iceGatheringState);
      if (pc.iceGatheringState === "complete") done("state=complete");
    };
    setTimeout(() => done(`${timeoutMs}ms timeout`), timeoutMs);
    if (pc.iceGatheringState === "complete") done("already complete");
  });
}

// ─── The hook ──────────────────────────────────────────────────────────────

export function useWebRTCAgentCall({ callId }: { callId: string }) {
  const [connectionState, setConnectionState] = useState<AgentCallConnectionState>("waiting");
  const [muted, setMuted] = useState(false);
  const [callStatus, setCallStatus] = useState("queued");
  const [error, setError] = useState("");

  const pcRef = useRef<any>(null);
  const streamRef = useRef<any>(null);
  const micPrewarmRef = useRef<Promise<void> | null>(null);
  const connectStartedRef = useRef(false);
  const teardownRef = useRef(false);

  // ── Mic-only pre-warm: ask for permission immediately so the prompt
  // appears on screen mount, not 10 s later when the SIP dial completes.
  // We deliberately do NOT touch RTCPeerConnection here — building it
  // before the remote SDP arrives caused some browsers to buffer
  // captured audio, which then arrived at the customer ~1.7 × real-time
  // ("slow / weird" voice).
  useEffect(() => {
    let cancelled = false;
    const prewarm = (async () => {
      const rtc = await loadRTCApis();
      if (!rtc || cancelled) return;
      try {
        log("pre-warm: requesting mic permission only");
        const stream = await rtc.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks?.().forEach((t: any) => t.stop?.());
          return;
        }
        streamRef.current = stream;
        log("pre-warm: mic permission granted (track held idle)");
      } catch (e) {
        warn("pre-warm: mic denied (will retry at connect):", e);
      }
    })();
    micPrewarmRef.current = prewarm;
    return () => {
      cancelled = true;
    };
  }, []);

  const cleanup = useCallback(async () => {
    teardownRef.current = true;
    const pc = pcRef.current;
    pcRef.current = null;
    if (pc) {
      try {
        pc.close();
      } catch {
        /* noop */
      }
    }
    if (Platform.OS === "web") detachRemoteStreamFromDom();
    setConnectionState((prev) => (prev === "error" ? "error" : "disconnected"));
  }, []);

  // ── Phase 2 — when the SIP dial reports the customer has answered, do
  // the full WebRTC handshake. This matches the commons WebSocket dialer:
  // the WS opens at the same moment.
  const connect = useCallback(async () => {
    if (connectStartedRef.current) return;
    connectStartedRef.current = true;
    setConnectionState("connecting");
    setError("");

    try {
      log("step 1: load RTC APIs");
      const rtc = await loadRTCApis();
      if (!rtc) {
        setConnectionState("unavailable");
        setError(
          Platform.OS === "web"
            ? "WebRTC isn't supported in this browser."
            : "Live audio needs a dev build (Expo Go can't load the WebRTC native module)."
        );
        return;
      }

      log("step 2: get auth token");
      const token = await getToken();
      if (!token) {
        setConnectionState("error");
        setError("Not signed in");
        return;
      }

      log("step 3: get mic (prefer pre-warmed)");
      try {
        await micPrewarmRef.current;
      } catch {
        /* logged in pre-warm */
      }
      let stream: any = streamRef.current;
      const usable =
        stream &&
        typeof stream.getTracks === "function" &&
        stream.getTracks().some((t: any) => t.readyState === "live");
      if (!usable) {
        try {
          // Match commons exactly: `{ audio: true }` — browser defaults
          // give the AEC + NS + AGC tuned for voice calls.
          stream = await rtc.getUserMedia({ audio: true });
          streamRef.current = stream;
          log("got mic on-demand");
        } catch (e) {
          warn("getUserMedia failed:", e);
          setConnectionState("error");
          setError("Microphone permission is required for live calls");
          return;
        }
      } else {
        log("using pre-warmed mic");
      }

      log("step 4: create RTCPeerConnection (now, not earlier)");
      let pc: any;
      try {
        pc = new rtc.RTCPeerConnection({ iceServers: ICE_SERVERS });
      } catch (e) {
        warn("RTCPeerConnection ctor failed:", e);
        setConnectionState("error");
        setError("Failed to initialise WebRTC");
        return;
      }
      pcRef.current = pc;

      pc.ontrack = (ev: any) => {
        log("ontrack: kind=", ev?.track?.kind, "streams=", ev?.streams?.length);
        if (Platform.OS === "web") {
          const remoteStream = ev?.streams?.[0];
          if (remoteStream) attachRemoteStreamToDom(remoteStream);
        }
      };
      pc.onconnectionstatechange = () => {
        if (teardownRef.current) return;
        const state = pc.connectionState;
        log("connectionState:", state);
        if (state === "connected") setConnectionState("connected");
        else if (state === "failed") {
          setConnectionState("error");
          setError("Audio connection failed");
        } else if (state === "disconnected") {
          setConnectionState("disconnected");
        }
      };
      pc.oniceconnectionstatechange = () => {
        log("iceConnectionState:", pc.iceConnectionState);
      };

      log("step 5: add track + lock bitrate");
      const audioSenders: any[] = [];
      try {
        for (const track of stream.getTracks?.() ?? []) {
          const sender = pc.addTrack(track, stream);
          if (sender && track.kind === "audio") audioSenders.push(sender);
        }
      } catch (e) {
        warn("addTrack failed:", e);
      }
      for (const sender of audioSenders) {
        try {
          const params = sender.getParameters?.() || {};
          if (!params.encodings || !params.encodings.length) params.encodings = [{}];
          params.encodings[0].maxBitrate = 48000;
          params.encodings[0].priority = "high";
          params.encodings[0].networkPriority = "high";
          await sender.setParameters?.(params);
        } catch (e) {
          warn("setParameters non-fatal:", e);
        }
      }

      log("step 6: createOffer");
      let offer: any;
      try {
        offer = await pc.createOffer({});
        await pc.setLocalDescription(offer);
      } catch (e) {
        warn("createOffer/setLocalDescription failed:", e);
        setConnectionState("error");
        setError("Failed to create offer");
        return;
      }

      log("step 7: gather ICE");
      await waitForIceGathering(pc, 6000);
      const finalSdp = pc.localDescription?.sdp || offer.sdp;
      const finalType = pc.localDescription?.type || offer.type || "offer";

      log("step 8: POST /webrtc-offer");
      const response = await fetch(
        `${BASE_URL}/api/calls/${encodeURIComponent(callId)}/webrtc-offer`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ sdp: finalSdp, type: finalType }),
        }
      );
      log("backend status:", response.status);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `WebRTC negotiation failed (${response.status})`);
      }
      const answer = await response.json();
      log("got answer, setRemoteDescription");
      await pc.setRemoteDescription(new rtc.RTCSessionDescription(answer));
      log("waiting for ICE connectivity → audio");
    } catch (e) {
      warn("connect error:", e);
      setConnectionState("error");
      setError(e instanceof Error ? e.message : "Failed to connect");
      await cleanup();
    }
  }, [callId, cleanup]);

  // ── Status polling — kicks off `connect()` only when the SIP side is live.
  useEffect(() => {
    teardownRef.current = false;
    connectStartedRef.current = false;
    let mounted = true;
    let interval: ReturnType<typeof setInterval> | undefined;

    const poll = async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const data = await getOutboundCallStatus(token, callId);
        if (!mounted) return;
        setCallStatus(data.status);
        const normalized = data.status.toLowerCase();
        if (ACTIVE_STATUSES.has(normalized) && !connectStartedRef.current) {
          connect();
        }
        if (TERMINAL_STATUSES.has(normalized)) {
          if (interval) clearInterval(interval);
          cleanup();
        }
      } catch {
        // best-effort
      }
    };

    poll();
    interval = setInterval(poll, 1500);
    return () => {
      mounted = false;
      if (interval) clearInterval(interval);
    };
  }, [callId, connect, cleanup]);

  // ── Controls.
  const toggleMute = useCallback(async () => {
    setMuted((prev) => {
      const next = !prev;
      const stream = streamRef.current;
      if (stream) {
        try {
          stream.getAudioTracks().forEach((t: any) => {
            t.enabled = !next;
          });
        } catch {
          /* noop */
        }
      }
      return next;
    });
  }, []);

  const hangup = useCallback(async () => {
    const token = await getToken();
    if (token) await hangupCall(token, callId).catch(() => undefined);
    await cleanup();
  }, [callId, cleanup]);

  // ── Final teardown on unmount.
  useEffect(() => {
    return () => {
      teardownRef.current = true;
      const pc = pcRef.current;
      pcRef.current = null;
      if (pc) {
        try {
          pc.close();
        } catch {
          /* noop */
        }
      }
      const stream = streamRef.current;
      streamRef.current = null;
      if (stream) {
        try {
          stream.getTracks?.().forEach((t: any) => t.stop?.());
        } catch {
          /* noop */
        }
      }
      if (Platform.OS === "web") detachRemoteStreamFromDom();
    };
  }, []);

  return {
    connectionState,
    callStatus,
    muted,
    error,
    toggleMute,
    hangup,
  };
}
