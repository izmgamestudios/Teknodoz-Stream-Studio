// src/studio/podcast/voice-setup.ts
// What the microphone chain of a podcast seat does, decided from the device (pure).
//  - an AI microphone (NVIDIA Broadcast / RTX Voice / Krisp) already removed noise in the driver:
//    the browser's own processing and our gate stay out of the way ("nvidia" preset)
//  - otherwise: RNNoise (open-source neural noise suppression) + gate + EQ + compressor + limiter
//    ("podcast" preset, or the stronger "noisy" preset)
import {
  aiDeviceKind,
  AI_DEVICE_NAME,
  type AiDeviceKind,
} from "../engine/audio-devices";
import {
  VOICE_PRESETS,
  applyVoicePreset,
  sanitizeVoiceSettings,
  type VoiceSettings,
} from "../engine/voice";

export interface PodcastVoicePlan {
  settings: VoiceSettings;
  /** browser getUserMedia processing switches */
  constraints: {
    echoCancellation: boolean;
    noiseSuppression: boolean;
    autoGainControl: boolean;
  };
  ai: AiDeviceKind | null;
  /** shown to the user: what is cleaning the sound */
  summary: "nvidia" | "rnnoise-strong" | "rnnoise";
}

export function podcastVoicePlan(
  deviceLabel: string | null | undefined,
  strong = false,
): PodcastVoicePlan {
  const ai = aiDeviceKind(deviceLabel);
  const base = sanitizeVoiceSettings({});
  if (ai)
    return {
      settings: applyVoicePreset(base, "nvidia"),
      // a second pass of the browser's suppressor would "pump" an already clean signal;
      // echo cancellation stays on (it is about the speakers, not the room)
      constraints: {
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: false,
      },
      ai,
      summary: "nvidia",
    };
  const preset = strong ? "noisy" : "podcast";
  return {
    settings: sanitizeVoiceSettings({
      ...applyVoicePreset(base, preset),
      ai: true,
    }),
    constraints: {
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: false,
    },
    ai: null,
    // RNNoise does the suppression: the browser's own (weaker) one is off to avoid double work
    summary: strong ? "rnnoise-strong" : "rnnoise",
  };
}

export const aiLabel = (kind: AiDeviceKind): string => AI_DEVICE_NAME[kind];

export { VOICE_PRESETS };
