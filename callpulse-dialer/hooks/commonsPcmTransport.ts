import { Audio, InterruptionModeAndroid } from "expo-av";
import Constants from "expo-constants";
import { Platform } from "react-native";

/** Same 16 kHz mono PCM as Qualia Commons web dialer. */
export const COMMONS_PCM_SAMPLE_RATE = 16000;

/**
 * Customer → agent playback boost on native (earpiece + music stream mismatch is quieter than web).
 */
export const NATIVE_CUSTOMER_PLAYBACK_GAIN = 2.75;

/** ~60 ms of 16 kHz mono before scheduling one buffer (smoother than per-RTP-packet on mobile). */
export const NATIVE_PLAYBACK_JITTER_SAMPLES = 960;

let nativeModulesOk: boolean | null = null;

/**
 * True when we can use WS + raw PCM (web always; native needs dev build + native modules).
 */
export async function isCommonsPcmAvailable(): Promise<boolean> {
  if (Platform.OS === "web") {
    return typeof window !== "undefined" && !!navigator?.mediaDevices?.getUserMedia;
  }
  if (Constants.appOwnership === "expo") return false;
  if (nativeModulesOk !== null) return nativeModulesOk;
  try {
    require("react-native-audio-api");
    require("react-native-audio-record");
    nativeModulesOk = true;
  } catch {
    nativeModulesOk = false;
  }
  return nativeModulesOk;
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const g = globalThis as { atob?: (s: string) => string };
  const decode = g.atob ?? (() => {
    throw new Error("atob missing");
  });
  const binary = decode(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export type NativeAudioRecord = {
  init: (opts: Record<string, unknown>) => void;
  on: (event: "data", cb: (data: string) => void) => void;
  start: () => void;
  stop: () => void;
};

export function loadNativeAudioRecord(): NativeAudioRecord | null {
  try {
    return require("react-native-audio-record").default as NativeAudioRecord;
  } catch {
    return null;
  }
}

/** Android crashes with IllegalStateException if start() runs without permission or while already recording. */
export async function requestNativeMicPermission(): Promise<boolean> {
  try {
    const { status } = await Audio.requestPermissionsAsync();
    return status === "granted";
  } catch {
    return false;
  }
}

export function safeNativeRecordStop(recorder: NativeAudioRecord | null | undefined): void {
  if (!recorder) return;
  try {
    recorder.stop();
  } catch {
    /* already stopped or never started */
  }
}

const NATIVE_MIC_INIT = {
  sampleRate: COMMONS_PCM_SAMPLE_RATE,
  channels: 1,
  bitsPerSample: 16,
  /**
   * Android VOICE_COMMUNICATION (7) — platform echo cancellation (web getUserMedia does this).
   * Plain MIC (1) picks up speaker → echo on phone.
   */
  audioSource: Platform.OS === "android" ? 7 : 6,
  wavFile: "",
} as const;

/**
 * Phone-call audio route: MODE_IN_COMMUNICATION on Android (pairs with VOICE_COMMUNICATION mic).
 * Earpiece keeps echo down; customer playback gain is boosted separately in useAgentAudioWebSocket.
 */
export async function configureNativeCallAudio(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: true,
      interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
    });
  } catch {
    /* best-effort */
  }
}

export async function resetNativeCallAudio(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      playThroughEarpieceAndroid: false,
    });
  } catch {
    /* noop */
  }
}

export async function prepareNativeMicRecorder(
  recorder: NativeAudioRecord
): Promise<void> {
  const granted = await requestNativeMicPermission();
  if (!granted) {
    throw new Error("Microphone permission is required for agent audio");
  }
  await configureNativeCallAudio();
  safeNativeRecordStop(recorder);
  await new Promise((r) => setTimeout(r, 80));
  recorder.init({ ...NATIVE_MIC_INIT });
}

export function safeNativeRecordStart(recorder: NativeAudioRecord): void {
  try {
    recorder.start();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Could not start microphone capture: ${msg}`);
  }
}

export function loadNativeAudioContext(): typeof AudioContext | null {
  try {
    const mod = require("react-native-audio-api");
    return (mod.AudioContext ?? mod.default?.AudioContext) as typeof AudioContext;
  } catch {
    return null;
  }
}
