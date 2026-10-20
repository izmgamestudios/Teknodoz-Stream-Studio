// src/studio/engine/audio-devices.ts
// Recognises "AI" audio / video devices (NVIDIA Broadcast, RTX Voice, Krisp...) by their device
// label. Such devices already remove noise in the driver, so the browser's own noise suppression
// and our software gate must not process the signal a second time. Pure: unit-tested.

export type AiDeviceKind = "nvidia-broadcast" | "rtx-voice" | "krisp";

const PATTERNS: readonly [AiDeviceKind, RegExp][] = [
  ["nvidia-broadcast", /nvidia\s*broadcast/i],
  ["rtx-voice", /rtx\s*voice/i],
  ["krisp", /krisp/i],
];

export function aiDeviceKind(
  label: string | undefined | null,
): AiDeviceKind | null {
  if (!label) return null;
  for (const [kind, re] of PATTERNS) if (re.test(label)) return kind;
  return null;
}

export const AI_DEVICE_NAME: Record<AiDeviceKind, string> = {
  "nvidia-broadcast": "NVIDIA Broadcast",
  "rtx-voice": "NVIDIA RTX Voice",
  krisp: "Krisp",
};

export interface DeviceChoice {
  deviceId: string;
  label: string;
  ai: AiDeviceKind | null;
}

/** Input devices of one kind, AI devices first (the usual best choice), stable otherwise. */
export function listChoices(
  devices: readonly MediaDeviceInfo[],
  kind: "audioinput" | "videoinput",
): DeviceChoice[] {
  const out = devices
    .filter((d) => d.kind === kind && d.deviceId !== "")
    .map((d, i): DeviceChoice => ({
      deviceId: d.deviceId,
      label:
        d.label || `${kind === "audioinput" ? "Mikrofon" : "Kamera"} ${i + 1}`,
      ai: aiDeviceKind(d.label),
    }));
  return out.sort((a, b) => Number(!!b.ai) - Number(!!a.ai));
}

/** `getUserMedia` audio constraints: AI devices get the browser's processing switched off. */
export function audioConstraints(
  deviceId: string | undefined,
  ai: boolean,
): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    echoCancellation: !ai,
    noiseSuppression: !ai,
    autoGainControl: !ai,
  };
}

const MIC_KEY = "studio.micDevice.v1";
export const loadMicId = (): string => {
  try {
    return localStorage.getItem(MIC_KEY) ?? "";
  } catch {
    return "";
  }
};
export const saveMicId = (id: string): void => {
  try {
    if (id) localStorage.setItem(MIC_KEY, id);
    else localStorage.removeItem(MIC_KEY);
  } catch {
    /* storage blocked */
  }
};
