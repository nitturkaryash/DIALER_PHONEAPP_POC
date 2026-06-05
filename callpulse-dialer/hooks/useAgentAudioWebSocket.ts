/**
 * Qualia Commons dialer audio path (web + native dev build):
 *   WS /api/calls/{id}/agent-audio  →  16 kHz PCM  →  Issabel SIP
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

import {
  buildAgentAudioWsUrl,
  getOutboundCallStatus,
  getToken,
  hangupCall,
} from "../services/api";
import type { AgentCallConnectionState } from "./agentAudioTypes";
import {
  base64ToArrayBuffer,
  COMMONS_PCM_SAMPLE_RATE,
  isCommonsPcmAvailable,
  loadNativeAudioContext,
  loadNativeAudioRecord,
  NATIVE_CUSTOMER_PLAYBACK_GAIN,
  NATIVE_PLAYBACK_JITTER_SAMPLES,
  prepareNativeMicRecorder,
  safeNativeRecordStart,
  resetNativeCallAudio,
  safeNativeRecordStop,
} from "./commonsPcmTransport";

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

type Options = {
  callId: string;
  enabled?: boolean;
};

export function useAgentAudioWebSocket({ callId, enabled = true }: Options) {
  const [connectionState, setConnectionState] = useState<AgentCallConnectionState>("waiting");
  const [muted, setMuted] = useState(false);
  const [callStatus, setCallStatus] = useState("queued");
  const [error, setError] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const scriptNodeRef = useRef<ScriptProcessorNode | null>(null);
  const micNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const nextPlayTimeRef = useRef(0);
  const playbackGainRef = useRef<AudioNode | null>(null);
  const nativeJitterRef = useRef<Uint8Array | null>(null);
  const nativeJitterLenRef = useRef(0);
  const connectGenRef = useRef(0);
  const connectStartedRef = useRef(false);
  const teardownRef = useRef(false);
  const mutedRef = useRef(false);
  const nativeRecordRef = useRef<ReturnType<typeof loadNativeAudioRecord>>(null);
  const nativeRecordingRef = useRef(false);
  mutedRef.current = muted;

  const cleanup = useCallback(async () => {
    teardownRef.current = true;
    connectGenRef.current += 1;
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) {
      try {
        ws.close(1000, "teardown");
      } catch {
        /* noop */
      }
    }
    safeNativeRecordStop(nativeRecordRef.current);
    nativeRecordingRef.current = false;
    scriptNodeRef.current?.disconnect();
    scriptNodeRef.current = null;
    micNodeRef.current?.disconnect();
    micNodeRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      audioCtxRef.current.close().catch(() => undefined);
    }
    audioCtxRef.current = null;
    playbackGainRef.current = null;
    nativeJitterRef.current = null;
    nativeJitterLenRef.current = 0;
    void resetNativeCallAudio();
    setConnectionState((prev) => (prev === "error" ? "error" : "disconnected"));
  }, []);

  const ensurePlaybackRunning = useCallback(async (audioCtx: AudioContext) => {
    if (audioCtx.state === "suspended") {
      try {
        await audioCtx.resume();
      } catch {
        /* noop */
      }
    }
  }, []);

  const ensureCustomerPlaybackGain = useCallback((audioCtx: AudioContext) => {
    if (Platform.OS === "web") return audioCtx.destination;
    if (!playbackGainRef.current) {
      const gain = audioCtx.createGain();
      gain.gain.value = NATIVE_CUSTOMER_PLAYBACK_GAIN;
      gain.connect(audioCtx.destination);
      playbackGainRef.current = gain;
    }
    return playbackGainRef.current;
  }, []);

  const playPcmBuffer = useCallback(
    (audioCtx: AudioContext, chunk: ArrayBuffer, dest: AudioNode) => {
      const view = new DataView(chunk);
      const sampleCount = chunk.byteLength / 2;
      const float32 = new Float32Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) {
        float32[i] = view.getInt16(i * 2, true) / 32768.0;
      }
      const buffer = audioCtx.createBuffer(1, float32.length, COMMONS_PCM_SAMPLE_RATE);
      buffer.getChannelData(0).set(float32);
      const bufferSource = audioCtx.createBufferSource();
      bufferSource.buffer = buffer;
      bufferSource.connect(dest);
      let playTime = nextPlayTimeRef.current;
      if (playTime - audioCtx.currentTime > 0.12) {
        playTime = audioCtx.currentTime + 0.02;
      } else {
        playTime = Math.max(playTime, audioCtx.currentTime);
      }
      bufferSource.start(playTime);
      nextPlayTimeRef.current = playTime + buffer.duration;
    },
    []
  );

  const schedulePcmPlayback = useCallback(
    (audioCtx: AudioContext, chunk: ArrayBuffer) => {
      void ensurePlaybackRunning(audioCtx);
      const dest = ensureCustomerPlaybackGain(audioCtx);

      if (Platform.OS === "web") {
        playPcmBuffer(audioCtx, chunk, dest);
        return;
      }

      const byteLen = chunk.byteLength;
      if (byteLen < 2 || byteLen % 2 !== 0) return;

      const prevLen = nativeJitterLenRef.current;
      const merged = new Uint8Array(prevLen + byteLen);
      if (nativeJitterRef.current && prevLen > 0) {
        merged.set(nativeJitterRef.current.subarray(0, prevLen), 0);
      }
      merged.set(new Uint8Array(chunk), prevLen);

      const minBytes = NATIVE_PLAYBACK_JITTER_SAMPLES * 2;
      let offset = 0;
      while (merged.length - offset >= minBytes) {
        const slice = merged.buffer.slice(
          merged.byteOffset + offset,
          merged.byteOffset + offset + minBytes
        );
        playPcmBuffer(audioCtx, slice, dest);
        offset += minBytes;
      }
      const remain = merged.length - offset;
      if (remain > 0) {
        nativeJitterRef.current = merged.subarray(offset);
        nativeJitterLenRef.current = remain;
      } else {
        nativeJitterRef.current = null;
        nativeJitterLenRef.current = 0;
      }
    },
    [ensureCustomerPlaybackGain, ensurePlaybackRunning, playPcmBuffer]
  );

  const handleWsAudioMessage = useCallback(
    (data: unknown) => {
      if (!audioCtxRef.current) return;
      const audioCtx = audioCtxRef.current;

      const playChunk = (buf: ArrayBuffer) => schedulePcmPlayback(audioCtx, buf);

      if (data instanceof ArrayBuffer) {
        playChunk(data);
        return;
      }
      if (typeof data === "string") {
        playChunk(base64ToArrayBuffer(data));
        return;
      }
      if (typeof Blob !== "undefined" && data instanceof Blob) {
        void data.arrayBuffer().then(playChunk).catch(() => undefined);
      }
    },
    [schedulePcmPlayback]
  );

  const connectWsWeb = useCallback(
    async (token: string, connectGen: number, ws: WebSocket, attempt: number) => {
      let stream = streamRef.current;
      if (!stream || stream.getTracks().every((t) => t.readyState === "ended")) {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
          },
        });
        if (connectGen !== connectGenRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
      }

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
        audioCtxRef.current = new AudioContextClass({ sampleRate: COMMONS_PCM_SAMPLE_RATE });
        nextPlayTimeRef.current = audioCtxRef.current.currentTime;
      }
      const audioCtx = audioCtxRef.current;

      const attachMic = () => {
        if (connectGen !== connectGenRef.current || !streamRef.current) return;
        scriptNodeRef.current?.disconnect();
        micNodeRef.current?.disconnect();
        const source = audioCtx.createMediaStreamSource(streamRef.current!);
        micNodeRef.current = source;
        const processor = audioCtx.createScriptProcessor(512, 1, 1);
        scriptNodeRef.current = processor;
        processor.onaudioprocess = (e) => {
          if (mutedRef.current || ws.readyState !== WebSocket.OPEN) return;
          const input = e.inputBuffer.getChannelData(0);
          const buffer = new ArrayBuffer(input.length * 2);
          const view = new DataView(buffer);
          for (let i = 0; i < input.length; i++) {
            let s = Math.max(-1, Math.min(1, input[i]));
            view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
          }
          ws.send(buffer);
        };
        source.connect(processor);
        processor.connect(audioCtx.destination);
        if (audioCtx.state === "suspended") audioCtx.resume().catch(() => undefined);
      };

      ws.onopen = () => {
        if (connectGen !== connectGenRef.current) return;
        console.log("[AgentAudioWS] web connected (Commons PCM)");
        attachMic();
        setConnectionState("connected");
      };

      ws.onmessage = (event) => {
        if (connectGen !== connectGenRef.current) return;
        handleWsAudioMessage(event.data);
      };

      ws.onclose = (event) => {
        if (connectGen !== connectGenRef.current) return;
        if (event.code === 4004 && attempt < 8) {
          setTimeout(() => connectWs(attempt + 1), 600);
        } else if (event.code !== 1000) {
          setConnectionState("disconnected");
        }
      };

      ws.onerror = () => {
        if (attempt < 8) setTimeout(() => connectWs(attempt + 1), 600);
      };
    },
    [handleWsAudioMessage]
  );

  const connectWsNative = useCallback(
    async (token: string, connectGen: number, ws: WebSocket, attempt: number) => {
      const AudioRecord = loadNativeAudioRecord();
      const AudioContextClass = loadNativeAudioContext();
      if (!AudioRecord || !AudioContextClass) {
        throw new Error("Native PCM modules not installed — rebuild dev client");
      }

      nativeRecordRef.current = AudioRecord;

      if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
        audioCtxRef.current = new AudioContextClass({ sampleRate: COMMONS_PCM_SAMPLE_RATE });
        nextPlayTimeRef.current = audioCtxRef.current.currentTime;
        playbackGainRef.current = null;
        nativeJitterRef.current = null;
        nativeJitterLenRef.current = 0;
      }
      void ensurePlaybackRunning(audioCtxRef.current);

      ws.onopen = () => {
        if (connectGen !== connectGenRef.current || teardownRef.current) return;
        void (async () => {
          try {
            await prepareNativeMicRecorder(AudioRecord);
            if (connectGen !== connectGenRef.current || teardownRef.current) return;
            if (audioCtxRef.current) await ensurePlaybackRunning(audioCtxRef.current);
            console.log("[AgentAudioWS] native connected (Commons PCM)");
            AudioRecord.on("data", (data: string) => {
              if (mutedRef.current || ws.readyState !== WebSocket.OPEN) return;
              try {
                ws.send(base64ToArrayBuffer(data));
              } catch {
                /* noop */
              }
            });
            if (nativeRecordingRef.current) {
              safeNativeRecordStop(AudioRecord);
              nativeRecordingRef.current = false;
              await new Promise((r) => setTimeout(r, 80));
            }
            safeNativeRecordStart(AudioRecord);
            nativeRecordingRef.current = true;
            setConnectionState("connected");
          } catch (e) {
            nativeRecordingRef.current = false;
            setConnectionState("error");
            setError(e instanceof Error ? e.message : "Microphone capture failed");
          }
        })();
      };

      ws.onmessage = (event) => {
        if (connectGen !== connectGenRef.current) return;
        handleWsAudioMessage(event.data);
      };

      ws.onclose = (event) => {
        if (connectGen !== connectGenRef.current) return;
        safeNativeRecordStop(AudioRecord);
        nativeRecordingRef.current = false;
        if (event.code === 4004 && attempt < 8) {
          setTimeout(() => connectWs(attempt + 1), 600);
        } else if (event.code !== 1000) {
          setConnectionState("disconnected");
        }
      };

      ws.onerror = () => {
        if (attempt < 8) setTimeout(() => connectWs(attempt + 1), 600);
      };
    },
    [ensurePlaybackRunning, handleWsAudioMessage]
  );

  const connectWs = useCallback(
    async (attempt = 0) => {
      if (!enabled) return;
      const pcmOk = await isCommonsPcmAvailable();
      if (!pcmOk) return;

      if (connectStartedRef.current && attempt === 0) return;
      if (attempt === 0) {
        connectStartedRef.current = true;
        setConnectionState("connecting");
        setError("");
      }

      const token = await getToken();
      if (!token) {
        setConnectionState("error");
        setError("Not signed in");
        return;
      }

      const connectGen = connectGenRef.current + 1;
      connectGenRef.current = connectGen;

      try {
        const wsUrl = buildAgentAudioWsUrl(callId, token);
        const ws = new WebSocket(wsUrl);
        ws.binaryType = "arraybuffer";
        wsRef.current = ws;

        if (Platform.OS === "web") {
          await connectWsWeb(token, connectGen, ws, attempt);
        } else {
          await connectWsNative(token, connectGen, ws, attempt);
        }
      } catch (e) {
        setConnectionState("error");
        setError(e instanceof Error ? e.message : "WebSocket audio failed");
      }
    },
    [callId, enabled, connectWsWeb, connectWsNative]
  );

  useEffect(() => {
    if (!enabled) return;
    teardownRef.current = false;
    connectStartedRef.current = false;
    let mounted = true;
    let interval: ReturnType<typeof setInterval> | undefined;

    const poll = async () => {
      try {
        const token = await getToken();
        if (!token || !mounted) return;
        const data = await getOutboundCallStatus(token, callId);
        if (!mounted) return;
        setCallStatus(data.status);
        const normalized = data.status.toLowerCase();
        if (
          (data.agent_bridge_ready || ACTIVE_STATUSES.has(normalized)) &&
          !connectStartedRef.current
        ) {
          connectWs();
        }
        if (TERMINAL_STATUSES.has(normalized)) {
          if (interval) clearInterval(interval);
          cleanup();
        }
      } catch {
        /* noop */
      }
    };

    const pollMs = () => (connectStartedRef.current ? 1000 : 250);

    poll();
    interval = setInterval(poll, pollMs());
    const retune = setInterval(() => {
      if (!interval) return;
      clearInterval(interval);
      interval = setInterval(poll, pollMs());
    }, 2000);
    return () => {
      mounted = false;
      if (interval) clearInterval(interval);
      clearInterval(retune);
    };
  }, [callId, enabled, connectWs, cleanup]);

  useEffect(() => {
    if (!enabled) return;
    return () => {
      teardownRef.current = true;
      cleanup();
    };
  }, [enabled, cleanup]);

  const toggleMute = useCallback(async () => {
    setMuted((prev) => !prev);
  }, []);

  const hangup = useCallback(async () => {
    const token = await getToken();
    if (token) await hangupCall(token, callId).catch(() => undefined);
    await cleanup();
  }, [callId, cleanup]);

  return {
    connectionState: enabled ? connectionState : "unavailable",
    callStatus,
    muted,
    error,
    toggleMute,
    hangup,
    transport: "websocket" as const,
  };
}
