// src/routes/remote.tsx
// Phone remote control (Stream Deck style). Big touch buttons over the WebRTC data channel.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import type { RemoteCommand, RemoteState } from "@/studio/types";
import { ConnectCard } from "@/studio/ui/connect-card";
import { formatMs } from "@/studio/ui/fields";
import { useClientConnection } from "@/studio/ui/use-client";

export const Route = createFileRoute("/remote")({
  head: () => ({
    meta: [
      { title: "Kumanda — Teknodoz Studio" },
      { name: "robots", content: "noindex" },
      { name: "referrer", content: "no-referrer" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, maximum-scale=1",
      },
    ],
  }),
  component: RemotePage,
});

function RemotePage() {
  const conn = useClientConnection();
  const { client, status } = conn;
  const [state, setState] = useState<RemoteState | null>(null);

  useEffect(() => {
    if (!client) return;
    return client.onRemoteState(setState);
  }, [client]);

  const send = (cmd: RemoteCommand) => {
    try {
      client?.sendCommand(cmd);
      navigator.vibrate?.(12);
    } catch {
      /* not connected yet */
    }
  };

  const online =
    conn.phase === "answer" &&
    status !== "connecting" &&
    status !== "disconnected";

  if (!online) {
    return (
      <div className="mx-auto min-h-screen max-w-md space-y-4 p-4">
        <header className="pt-4">
          <p className="text-xs uppercase tracking-[0.3em] text-speaker-b">
            Teknodoz Studio
          </p>
          <h1 className="mt-1 text-2xl font-bold">📱 Telefon kumandası</h1>
        </header>
        <ConnectCard
          phase={conn.phase}
          answer={conn.answer}
          status={status}
          error={conn.error}
          askName={false}
          onConnect={conn.connect}
        />
        {status === "disconnected" && conn.phase === "answer" && (
          <p role="alert" className="text-sm text-destructive">
            Bağlantı koptu. Sayfayı yenileyip yeni bir davet isteyin.
          </p>
        )}
      </div>
    );
  }

  const big =
    "flex min-h-20 select-none items-center justify-center rounded-2xl text-lg font-bold active:scale-95 transition-transform touch-manipulation";

  return (
    <div className="mx-auto min-h-screen max-w-md space-y-4 p-3">
      <header className="flex items-center justify-between pt-2">
        <h1 className="text-lg font-bold">📱 Kumanda</h1>
        <span
          className={`text-sm font-mono ${state?.recording ? "text-primary" : "text-muted-foreground"}`}
        >
          {state?.recording ? `● ${formatMs(state.recordingMs)}` : "hazır"}
        </span>
      </header>

      {!state && (
        <p className="text-sm text-muted-foreground">
          Stüdyodan durum bekleniyor…
        </p>
      )}

      <section aria-label="Sahneler" className="grid grid-cols-2 gap-2">
        {(state?.scenes ?? []).slice(0, 9).map((s, i) => (
          <button
            key={s.id}
            className={`${big} ${s.id === state?.activeSceneId ? "bg-speaker-b text-background" : "bg-secondary"}`}
            onClick={() => send({ kind: "scene", id: s.id })}
          >
            <span className="mr-2 text-sm opacity-70">{i + 1}</span>
            <span className="truncate text-base">{s.name}</span>
          </button>
        ))}
      </section>

      <section aria-label="Prompter" className="grid grid-cols-4 gap-2">
        <button
          className={`${big} col-span-2 bg-speaker-a text-background`}
          onClick={() => send({ kind: "prompter", action: "toggle" })}
        >
          {state?.prompterPlaying ? "❚❚ Durdur" : "▶ Kaydır"}
        </button>
        <button
          className={`${big} bg-secondary`}
          aria-label="Yavaşlat"
          onClick={() => send({ kind: "prompter", action: "speedDown" })}
        >
          −
        </button>
        <button
          className={`${big} bg-secondary`}
          aria-label="Hızlandır"
          onClick={() => send({ kind: "prompter", action: "speedUp" })}
        >
          +
        </button>
        <button
          className={`${big} col-span-2 bg-secondary text-base`}
          onClick={() => send({ kind: "prompter", action: "rewind" })}
        >
          ⏮ Başa dön
        </button>
        <p className="col-span-2 self-center text-center text-sm text-muted-foreground">
          Hız: {Math.round(state?.prompterSpeed ?? 0)} px/sn
        </p>
      </section>

      <section aria-label="Kayıt ve ses" className="grid grid-cols-2 gap-2">
        <button
          className={`${big} ${state?.recording ? "animate-pulse bg-destructive text-primary-foreground" : "bg-primary text-primary-foreground"}`}
          onClick={() => send({ kind: "record", action: "toggle" })}
        >
          {state?.recording ? "■ Kaydı bitir" : "● Kayda başla"}
        </button>
        <button
          className={`${big} bg-secondary`}
          disabled={!state?.recording}
          onClick={() => send({ kind: "marker" })}
        >
          🔖 İşaret
        </button>
        <button
          className={`${big} col-span-2 ${state?.micMuted ? "bg-destructive text-primary-foreground" : "bg-secondary"}`}
          aria-pressed={state?.micMuted ?? false}
          onClick={() => send({ kind: "mute" })}
        >
          {state?.micMuted ? "🔇 Mikrofon kapalı" : "🎙 Mikrofon açık"}
        </button>
      </section>
    </div>
  );
}
