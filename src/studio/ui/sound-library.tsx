// src/studio/ui/sound-library.tsx
// Built-in, licence-free sounds: procedural lo-fi / ambient music (WebAudio) and synthesized
// effects (ZzFX, MIT). Everything is generated in the browser; nothing is downloaded.
import { useEffect, useState } from "react";

import { TRACKS } from "../engine/music";
import { SFX_PRESETS } from "../engine/sfx-presets";
import { useAudioState, useStudio } from "../runtime/use-studio";
import { PANEL, PanelTitle } from "./fields";

const TILE = "rounded-md px-2 py-1.5 text-left text-xs transition-colors";

export function SoundLibrary() {
  const rt = useStudio();
  useAudioState(); // re-render when the generated-music channel changes
  const [whoosh, setWhoosh] = useState(true);
  useEffect(() => setWhoosh(rt.getAutoWhoosh()), [rt]);

  // 1-8 on Alt: fire the first eight effects (plain digits already switch scenes)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const n = Number(e.key);
      const p = n >= 1 && n <= 8 ? SFX_PRESETS[n - 1] : undefined;
      if (p) {
        e.preventDefault();
        void rt.playPresetEffect(p.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rt]);

  return (
    <section className={PANEL} aria-label="Ses kütüphanesi">
      <PanelTitle>Ses kütüphanesi</PanelTitle>
      <p className="mb-2 text-[11px] text-muted-foreground">
        Müzik ve efektler kodla üretilir: dosya yok, telif yok. Kayıda ve canlı yayına karışır.
      </p>

      <label className="mb-3 flex items-center justify-between gap-2 rounded-md bg-secondary px-2 py-1.5 text-xs">
        <span>💨 Sahne geçişinde whoosh çal</span>
        <input
          type="checkbox"
          className="size-4"
          checked={whoosh}
          onChange={(e) => {
            setWhoosh(e.target.checked);
            rt.setAutoWhoosh(e.target.checked);
          }}
        />
      </label>

      <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Müzik</p>
      <ul className="mb-3 grid grid-cols-1 gap-1 sm:grid-cols-2 xl:grid-cols-1">
        {TRACKS.map((t) => {
          const on = rt.isTrackPlaying(t.id);
          return (
            <li key={t.id}>
              <button
                className={`${TILE} w-full ${on ? "bg-speaker-a text-background" : "bg-secondary hover:bg-accent"}`}
                aria-pressed={on}
                onClick={() => void rt.toggleTrack(t.id)}
              >
                <span className="font-semibold">{on ? "■" : "♪"} {t.name}</span>
                <span className="block opacity-70">{t.mood} · {t.bpm} bpm</span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
        Efektler <span className="normal-case tracking-normal">(Alt+1…8)</span>
      </p>
      <ul className="grid grid-cols-3 gap-1">
        {SFX_PRESETS.map((p, i) => (
          <li key={p.id}>
            <button
              className={`${TILE} w-full bg-secondary text-center hover:bg-accent`}
              onClick={() => void rt.playPresetEffect(p.id)}
              title={i < 8 ? `Alt+${i + 1}` : undefined}
            >
              <span className="block text-base">{p.emoji}</span>
              {p.label}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
