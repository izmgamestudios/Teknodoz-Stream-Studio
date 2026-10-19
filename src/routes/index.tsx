// src/routes/index.tsx
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import {
  StudioProvider,
  useProject,
  useRuntimeSnapshot,
  useSources,
  useStudio,
  usePrompterState,
} from "@/studio/runtime/use-studio";
import { CreditsFooter, AboutDialog } from "@/studio/ui/credits";
import {
  BTN,
  BTN_ACCENT,
  BTN_PRIMARY,
  Check,
  formatMs,
  RangeInput,
} from "@/studio/ui/fields";
import { PrompterPanel } from "@/studio/ui/prompter-panel";
import { NotchView, PrompterView } from "@/studio/ui/prompter-view";
import { titleFromMatches } from "@/studio/branding/head";

export const Route = createFileRoute("/")({
  head: ({ matches }) => ({
    meta: [
      { title: titleFromMatches(matches, "Prompter") },
      {
        name: "description",
        content:
          "Sunucusuz, tarayıcıda çalışan akıllı teleprompter: sesle takip, kamera altı notch modu, burn-in ve .docx/.txt içe aktarma.",
      },
      { property: "og:title", content: titleFromMatches(matches, "Prompter") },
    ],
  }),
  component: PrompterPage,
});

function PrompterPage() {
  return (
    <StudioProvider
      fallback={
        <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
          <h1 className="sr-only">Prompter</h1>
          Yükleniyor…
        </div>
      }
    >
      <PrompterApp />
    </StudioProvider>
  );
}

function PrompterApp() {
  const rt = useStudio();
  const project = useProject();
  const [full, setFull] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (rt.handleKey(e)) e.preventDefault();
      else if (e.key === "Escape") setFull(false);
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [rt]);

  return (
    <div className="min-h-screen p-3 md:p-6">
      <header className="mx-auto mb-4 flex max-w-5xl flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-speaker-b">
            Teknodoz · DozPrompt
          </p>
          <h1 className="mt-1 text-3xl font-bold">Akıllı prompter</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Metni yapıştır ya da .docx/.txt yükle. HUD yalnızca sende görünür ve
            kayda girmez; istersen burn-in ile videoya göm.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AboutDialog />
          <button
            className={BTN_ACCENT}
            onClick={() => setFull(true)}
            disabled={project.prompter.script.trim() === ""}
          >
            ▶ Tam ekran prompter
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-5xl">
        <PrompterPanel />
      </div>

      <CreditsFooter className="mx-auto mt-6 max-w-5xl border-t pt-3" />
      {full && <FullscreenPrompter onExit={() => setFull(false)} />}
    </div>
  );
}

/** Camera behind the scrolling text, like a classic teleprompter mirror rig. */
function FullscreenPrompter({ onExit }: { onExit: () => void }) {
  const rt = useStudio();
  const project = useProject();
  const sources = useSources();
  const engine = usePrompterState();
  const snap = useRuntimeSnapshot();
  const videoRef = useRef<HTMLVideoElement>(null);
  const { settings } = project.prompter;
  const live =
    snap.recorder?.status === "recording" || snap.recorder?.status === "paused";
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!sources.webcam) void rt.sources.startWebcam();
  }, [rt, sources.webcam]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.srcObject = rt.sources.getWebcamStream();
  }, [rt, sources.webcam]);

  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(
      () => setNow(rt.getRecordingElapsedMs()),
      250,
    );
    return () => window.clearInterval(id);
  }, [live, rt]);

  return (
    <div className="fixed inset-0 z-50 bg-black">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="absolute inset-0 h-full w-full object-cover"
        style={{ transform: "scaleX(-1)" }}
      />
      <div className="absolute inset-0 bg-black/55" />
      {settings.display === "hud" ? (
        <div className="absolute inset-x-0 bottom-16 top-0">
          <PrompterView className="h-full rounded-none bg-transparent" />
        </div>
      ) : (
        <NotchView />
      )}
      {!sources.webcam && sources.error && (
        <p
          role="alert"
          className="absolute left-1/2 top-4 -translate-x-1/2 rounded-md bg-destructive px-4 py-2 text-sm text-primary-foreground"
        >
          Kameraya erişilemedi. Tarayıcı izinlerini kontrol edin.
        </p>
      )}
      <div className="absolute inset-x-0 bottom-0 z-20 flex flex-wrap items-center justify-center gap-3 bg-card/90 p-3 text-sm backdrop-blur">
        <button className={BTN} onClick={onExit}>
          ← Çık (Esc)
        </button>
        <button className={BTN_ACCENT} onClick={() => rt.prompter.toggle()}>
          {engine.playing ? "❚❚ Durdur" : "▶ Kaydır"}
        </button>
        <button className={BTN} onClick={() => rt.prompter.rewind()}>
          ⏮ Başa
        </button>
        <label className="flex items-center gap-2 text-xs">
          Hız
          <span className="w-28">
            <RangeInput
              label="Hız"
              min={0}
              max={300}
              value={settings.speedPx}
              onChange={(speedPx) =>
                rt.project.updatePrompterSettings({ speedPx })
              }
            />
          </span>
        </label>
        <label className="flex items-center gap-2 text-xs">
          Yazı
          <span className="w-28">
            <RangeInput
              label="Yazı boyutu"
              min={20}
              max={120}
              value={settings.fontSize}
              onChange={(fontSize) =>
                rt.project.updatePrompterSettings({ fontSize })
              }
            />
          </span>
        </label>
        <Check
          checked={settings.mirror}
          onChange={(mirror) => rt.project.updatePrompterSettings({ mirror })}
        >
          Ayna
        </Check>
        <button
          className={
            live
              ? "inline-flex animate-pulse items-center rounded-md bg-destructive px-4 py-1.5 text-xs font-bold text-primary-foreground"
              : BTN_PRIMARY
          }
          onClick={() => rt.toggleRecording()}
        >
          {live ? `■ Bitir ${formatMs(now)}` : "● Kaydet"}
        </button>
      </div>
    </div>
  );
}
