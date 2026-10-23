// src/studio/ui/podcast/guest-mic.ts
import { VoiceProcessor } from "../../engine/voice";
import type { MessageKey } from "../../i18n/messages";
import { openPodcastMic } from "../../podcast/mic";

/** What the guest page needs before joining: an open, processed microphone. */
export interface GuestMic {
  stream: MediaStream;
  voice: VoiceProcessor;
  summary: MessageKey;
  stop(): void;
}

/** Opens the microphone (call from the Join click) and runs it through the voice chain. */
export async function openGuestMic(): Promise<GuestMic> {
  const mic = await openPodcastMic(navigator.mediaDevices);
  const voice = new VoiceProcessor();
  const stream = await voice.attach(mic.stream, mic.plan.settings);
  return {
    stream,
    voice,
    summary: `pod.voice.${mic.plan.summary}` as MessageKey,
    stop: () => {
      voice.detach();
      mic.stream.getTracks().forEach((tr) => tr.stop());
    },
  };
}
