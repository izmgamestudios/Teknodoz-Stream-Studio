// src/studio/ui/audio-mixer.tsx
// Per-channel gain (0-150 %), mute and live VU meters (polled in one rAF loop, no re-renders).
import { useEffect, useRef } from "react";

import { meterFraction } from "../engine/audio-bus";
import { useAudioState, useStudio } from "../runtime/use-studio";
import { PANEL, PanelTitle, RangeInput } from "./fields";

const KIND_ICON: Record<string, string> = {
  mic: "🎙",
  system: "🖥",
  music: "🎵",
  guest: "👤",
  sfx: "✨",
  video: "🎞",
};

export function AudioMixer() {
  const rt = useStudio();
  const state = useAudioState();
  const bars = useRef(new Map<string, HTMLDivElement>());
  const master = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      for (const [id, el] of bars.current) {
        const frac = meterFraction(rt.audio.getLevel(id).db);
        el.style.width = `${(frac * 100).toFixed(1)}%`;
        el.dataset["hot"] = frac > 0.92 ? "1" : "0";
      }
      if (master.current) {
        master.current.style.width = `${(meterFraction(rt.audio.getMasterLevel().db) * 100).toFixed(1)}%`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [rt]);

  const channels = state.channels;

  return (
    <section className={PANEL} aria-label="Ses mikseri">
      <PanelTitle>Ses mikseri</PanelTitle>
      {channels.length === 0 && (
        <p className="mb-2 text-xs text-muted-foreground">
          Henüz ses kaynağı yok. Kamerayı açın veya müzik ekleyin.
        </p>
      )}
      <ul className="space-y-2">
        {channels.map((c) => (
          <li key={c.id} className={c.active ? "" : "opacity-50"}>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate">
                {KIND_ICON[c.kind] ?? "🔊"} {c.label}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <span className="tabular-nums text-muted-foreground">
                  {Math.round(c.gain * 100)}%
                </span>
                <button
                  aria-label={
                    c.muted ? `${c.label} sesini aç` : `${c.label} sustur`
                  }
                  aria-pressed={c.muted}
                  className={`rounded px-1.5 py-0.5 ${c.muted ? "bg-destructive text-primary-foreground" : "bg-secondary hover:bg-accent"}`}
                  onClick={() =>
                    c.kind === "guest"
                      ? rt.setGuestMuted(c.id.slice("guest:".length), !c.muted)
                      : rt.audio.setMuted(c.id, !c.muted)
                  }
                >
                  {c.muted ? "M" : "🔈"}
                </button>
              </span>
            </div>
            <RangeInput
              label={`${c.label} ses seviyesi`}
              value={c.gain}
              min={0}
              max={1.5}
              step={0.01}
              onChange={(g) =>
                c.kind === "guest"
                  ? rt.setGuestGain(c.id.slice("guest:".length), g)
                  : rt.audio.setGain(c.id, g)
              }
            />
            <div
              className="h-1.5 overflow-hidden rounded-full bg-secondary"
              aria-hidden
            >
              <div
                ref={(el) => {
                  if (el) bars.current.set(c.id, el);
                  else bars.current.delete(c.id);
                }}
                className="h-full w-0 bg-speaker-b transition-[width] duration-75 data-[hot='1']:bg-destructive"
              />
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 border-t pt-2">
        <div className="flex items-center justify-between text-xs">
          <span>🔊 Ana çıkış</span>
          <button
            aria-pressed={state.masterMuted}
            className={`rounded px-1.5 py-0.5 ${state.masterMuted ? "bg-destructive text-primary-foreground" : "bg-secondary hover:bg-accent"}`}
            onClick={() => rt.audio.setMasterMuted(!state.masterMuted)}
          >
            {state.masterMuted ? "M" : "🔈"}
          </button>
        </div>
        <div
          className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary"
          aria-hidden
        >
          <div
            ref={master}
            className="h-full w-0 bg-speaker-a transition-[width] duration-75"
          />
        </div>
      </div>
    </section>
  );
}
