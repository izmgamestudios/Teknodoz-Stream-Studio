// src/studio/ui/mobile-bar.tsx
// Thumb-reach controls for phones: previous / next scene and record, pinned to the bottom.
import { getActiveScene } from "../project/store";
import {
  useProject,
  useRuntimeSnapshot,
  useStudio,
} from "../runtime/use-studio";

export function MobileBar() {
  const rt = useStudio();
  const project = useProject();
  const rec = useRuntimeSnapshot().recorder;
  const recording = rec?.status === "recording" || rec?.status === "paused";
  const active = getActiveScene(project);
  const btn = "min-h-12 rounded-lg px-3 text-sm font-semibold active:scale-95";

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-2 border-t bg-card/95 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur xl:hidden">
      <button
        className={`${btn} bg-secondary`}
        aria-label="Önceki sahne"
        onClick={() => rt.stepScene(-1)}
      >
        ⏮
      </button>
      <span
        className="min-w-0 flex-1 truncate text-center text-sm font-semibold"
        aria-live="polite"
      >
        {active.name}
      </span>
      <button
        className={`${btn} bg-secondary`}
        aria-label="Sonraki sahne"
        onClick={() => rt.stepScene(1)}
      >
        ⏭
      </button>
      <button
        className={`${btn} text-primary-foreground ${recording ? "animate-pulse bg-destructive" : "bg-primary-solid"}`}
        aria-label={recording ? "Kaydı bitir" : "Kayda başla"}
        disabled={rec?.status === "stopping"}
        onClick={() => rt.toggleRecording()}
      >
        {recording ? "■ Bitir" : "● Kaydet"}
      </button>
    </div>
  );
}
