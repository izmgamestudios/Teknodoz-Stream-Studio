// src/studio/podcast/mic.ts
// Opens the podcast microphone: first any mic (to unlock device labels), then — when an AI
// microphone such as "Microphone (NVIDIA Broadcast)" exists — that one, so the driver-level noise
// removal is used automatically. Browser APIs are injected for tests.
import { listChoices, type DeviceChoice } from "../engine/audio-devices";
import { podcastVoicePlan, type PodcastVoicePlan } from "./voice-setup";

export interface MediaDevicesLike {
  getUserMedia(c: MediaStreamConstraints): Promise<MediaStream>;
  enumerateDevices(): Promise<MediaDeviceInfo[]>;
}

export interface OpenedMic {
  stream: MediaStream;
  deviceId: string;
  label: string;
  plan: PodcastVoicePlan;
  choices: DeviceChoice[];
}

const stop = (s: MediaStream | null): void =>
  s?.getTracks().forEach((t) => t.stop());

export async function openPodcastMic(
  devices: MediaDevicesLike,
  opts: { deviceId?: string; strong?: boolean } = {},
): Promise<OpenedMic> {
  // 1) any microphone, so labels are readable
  let stream = await devices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
  const all = await devices
    .enumerateDevices()
    .catch(() => [] as MediaDeviceInfo[]);
  const choices = listChoices(all, "audioinput");
  const currentId = stream.getAudioTracks()[0]?.getSettings().deviceId ?? "";

  // 2) the requested device, else the first AI microphone, else keep what we have
  const wanted =
    opts.deviceId && choices.some((c) => c.deviceId === opts.deviceId)
      ? choices.find((c) => c.deviceId === opts.deviceId)
      : choices.find((c) => c.ai);
  let chosen = choices.find((c) => c.deviceId === currentId) ?? choices[0];
  if (wanted && wanted.deviceId !== currentId) {
    const plan = podcastVoicePlan(wanted.label, opts.strong);
    try {
      const next = await devices.getUserMedia({
        audio: { deviceId: { exact: wanted.deviceId }, ...plan.constraints },
      });
      stop(stream);
      stream = next;
      chosen = wanted;
    } catch {
      /* the AI device is busy / gone: keep the default microphone */
    }
  }
  const label = chosen?.label ?? stream.getAudioTracks()[0]?.label ?? "";
  return {
    stream,
    deviceId: chosen?.deviceId ?? currentId,
    label,
    plan: podcastVoicePlan(label, opts.strong),
    choices,
  };
}

/** Invite links: guests and listeners open the podcast view of the room page. */
export function podcastLink(
  origin: string,
  code: string,
  seat: "guest" | "listener",
): string {
  const base = `${origin.replace(/\/+$/, "")}/r/${code.toUpperCase()}`;
  return `${base}?as=${seat === "guest" ? "guest" : "viewer"}&mode=podcast`;
}
