// src/routes/studio.tsx
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { getActiveScene } from "@/studio/project/store";
import { StudioProvider, useStudio } from "@/studio/runtime/use-studio";
import { importFiles } from "@/studio/ui/actions";
import { AudioMixer } from "@/studio/ui/audio-mixer";
import { AboutDialog, CreditsFooter } from "@/studio/ui/credits";
import { Inspector } from "@/studio/ui/inspector";
import { LayerPanel } from "@/studio/ui/layer-panel";
import { LivePanel } from "@/studio/ui/live-panel";
import { MediaLibrary } from "@/studio/ui/media-library";
import { MobileBar } from "@/studio/ui/mobile-bar";
import { PrompterPanel } from "@/studio/ui/prompter-panel";
import { ProjectMenu } from "@/studio/ui/project-menu";
import { PodcastPanel } from "@/studio/ui/podcast-panel";
import { PrototypePanel } from "@/studio/ui/prototype-panel";
import { RecordBar } from "@/studio/ui/record-bar";
import { ScenePanel } from "@/studio/ui/scene-panel";
import { SponsorPanel } from "@/studio/ui/sponsor-panel";
import { HealthPanel } from "@/studio/ui/health-panel";
import { FormatPicker } from "@/studio/ui/format-picker";
import { VoicePanel } from "@/studio/ui/voice-panel";
import { SoundLibrary } from "@/studio/ui/sound-library";
import { SourceBar } from "@/studio/ui/source-bar";
import { Stage } from "@/studio/ui/stage";
import { titleFromMatches } from "@/studio/branding/head";

export const Route = createFileRoute("/studio")({
  head: ({ matches }) => ({
    meta: [
      { title: titleFromMatches(matches, "Stüdyo") },
      {
        name: "description",
        content:
          "Tarayıcıda çalışan, sunucusuz yayın ve kayıt stüdyosu: sahneler, katmanlar, yeşil perde, prototip yayını, ses mikseri ve bölüm işaretleri.",
      },
      { property: "og:title", content: titleFromMatches(matches, "Stüdyo") },
    ],
  }),
  component: StudioPage,
});

function StudioPage() {
  return (
    <StudioProvider
      fallback={
        <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
          <h1 className="sr-only">Stüdyo</h1>
          Stüdyo yükleniyor…
        </div>
      }
    >
      <StudioApp />
    </StudioProvider>
  );
}

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return (
    !!el &&
    (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
  );
}

function StudioApp() {
  const rt = useStudio();
  const [selected, setSelected] = useState<string | null>(null);
  const consumedSpace = useRef(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (rt.handleKey(e)) {
        e.preventDefault();
        if (e.code === "Space") consumedSpace.current = true;
        return;
      }
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selected &&
        !isTyping(e.target)
      ) {
        const scene = getActiveScene(rt.project.getState());
        if (scene.layers.some((l) => l.id === selected)) {
          e.preventDefault();
          rt.project.removeLayer(scene.id, selected);
          setSelected(null);
        }
      }
      if ((e.ctrlKey || e.metaKey) && !isTyping(e.target)) {
        if (e.key.toLowerCase() === "z") {
          e.preventDefault();
          if (e.shiftKey) rt.project.redo();
          else rt.project.undo();
        } else if (e.key.toLowerCase() === "y") {
          e.preventDefault();
          rt.project.redo();
        }
      }
    };
    // A consumed Space keydown must not also "click" a focused button on keyup (Firefox).
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space" && consumedSpace.current) {
        e.preventDefault();
        consumedSpace.current = false;
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [rt, selected]);

  return (
    <div
      className="min-h-screen p-3 pb-24 md:p-4 xl:pb-4"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={async (e) => {
        if (e.dataTransfer.files.length === 0) return;
        e.preventDefault();
        const r = await importFiles(rt, Array.from(e.dataTransfer.files), true);
        if (r.lastLayerId) setSelected(r.lastLayerId);
      }}
    >
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">
          Stüdyo{" "}
          <span className="text-sm font-normal text-muted-foreground">
            · sahneleri kur, kaydet
          </span>
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <ProjectMenu />
          <AboutDialog />
        </div>
      </header>

      <div className="grid gap-3 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
        <div className="order-2 space-y-3 xl:order-1">
          <ScenePanel />
          <LayerPanel selectedId={selected} onSelect={setSelected} />
          <MediaLibrary onSelect={setSelected} />
          <SponsorPanel onSelect={setSelected} />
        </div>

        <div className="order-1 space-y-3 xl:order-2">
          <SourceBar />
          <FormatPicker />
          <Stage selectedId={selected} onSelect={setSelected} />
          <RecordBar />
          <section id="podcast" aria-label="Podcast">
            <PodcastPanel />
          </section>
          <HealthPanel />
          <LivePanel />
          <PrototypePanel selectedId={selected} />
        </div>

        <div className="order-3 space-y-3">
          <Inspector selectedId={selected} />
          <AudioMixer />
          <VoicePanel />
          <SoundLibrary />
          <PrompterPanel />
        </div>
      </div>

      <CreditsFooter className="mt-6 border-t pt-3" />
      <MobileBar />
    </div>
  );
}
