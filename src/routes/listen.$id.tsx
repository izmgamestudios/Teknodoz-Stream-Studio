// src/routes/listen.$id.tsx
// Public live listening page for a big audience: one play button, nothing else. The audio is the
// server's live MP3 of the podcast mix (see src/server/listen.ts).
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { titleFromMatches } from "@/studio/branding/head";
import { useT } from "@/studio/i18n/use-t";
import { BTN_ACCENT } from "@/studio/ui/fields";

export const Route = createFileRoute("/listen/$id")({
  head: ({ matches }) => ({
    meta: [
      { title: titleFromMatches(matches, "Listen") },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ListenPage,
});

function ListenPage() {
  const t = useT();
  const { id } = Route.useParams();
  const audio = useRef<HTMLAudioElement>(null);
  const [live, setLive] = useState<boolean | null>(null);
  const [title, setTitle] = useState("");
  const [playing, setPlaying] = useState(false);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const d = (await (await fetch(`/api/listen/${id}`)).json()) as {
          live: boolean;
          title: string;
        };
        if (!stop) {
          setLive(d.live);
          setTitle(d.title);
        }
      } catch {
        if (!stop) setLive(false);
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 6000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [id]);

  function play() {
    const a = audio.current;
    if (!a) return;
    // a fresh connection each time: a stale one would resume seconds (or minutes) behind
    a.src = `/listen/${id}/live.mp3?t=${Date.now()}`;
    a.play().then(
      () => {
        setPlaying(true);
        setBlocked(false);
      },
      () => setBlocked(true),
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-md space-y-4 p-4">
      <header className="pt-4">
        <p className="text-xs uppercase tracking-[0.3em] text-speaker-b">
          Teknodoz Podcast
        </p>
        <h1 className="mt-1 text-2xl font-bold">
          {title || t("listen.title")}
        </h1>
      </header>
      <p className="flex items-center gap-2 font-semibold" role="status">
        <span
          className={`inline-block size-2 rounded-full ${live ? "bg-red-500" : "bg-muted-foreground"}`}
        />
        {live === null ? "…" : live ? t("listen.live") : t("listen.offline")}
      </p>
      <audio
        ref={audio}
        playsInline
        onEnded={() => setPlaying(false)}
        onError={() => setPlaying(false)}
      />
      {live && (!playing || blocked) && (
        <button className={`${BTN_ACCENT} w-full py-6 text-xl`} onClick={play}>
          {t("listen.play")}
        </button>
      )}
    </div>
  );
}
