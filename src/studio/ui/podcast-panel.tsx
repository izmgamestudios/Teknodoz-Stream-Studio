// src/studio/ui/podcast-panel.tsx
// The podcast control room inside the studio: the director opens an audio-only room, shares the
// QR code, approves guests, runs the guest script and records — and the same mix goes into the
// studio recording / live output and the frequency picture on screen.
import { useStudio } from "../runtime/use-studio";
import { PodcastControlRoom } from "./podcast/control-room";

export function PodcastPanel() {
  const rt = useStudio();
  return <PodcastControlRoom host={rt.getPodcastHost()} inStudio />;
}
