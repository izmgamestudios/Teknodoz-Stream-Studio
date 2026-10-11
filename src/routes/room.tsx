// src/routes/room.tsx
// Room management: short links + QR, waiting pool (approve / reject), connected guests, log.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import {
  StudioProvider,
  useAudioState,
  usePeers,
  useRoom,
  useStudio,
} from "@/studio/runtime/use-studio";
import { CreditsFooter } from "@/studio/ui/credits";
import { GuestCard } from "@/studio/ui/live-panel";
import { RoomLinks, RoomLog, RoomPool } from "@/studio/ui/room-panels";
import { PANEL, PanelTitle } from "@/studio/ui/fields";

export const Route = createFileRoute("/room")({
  head: () => ({
    meta: [
      { title: "Oda — Teknodoz Studio" },
      {
        name: "description",
        content:
          "Konuk ve telefon bağlantılarını kısa link/QR ile yönetin: bekleme havuzu, onaylar ve günlük.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RoomPage,
});

function RoomPage() {
  return (
    <StudioProvider
      fallback={
        <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
          Yükleniyor…
        </div>
      }
    >
      <RoomApp />
    </StudioProvider>
  );
}

function RoomApp() {
  const rt = useStudio();
  const room = useRoom();
  const peers = usePeers();
  useAudioState(); // keeps guest VU/gain rows fresh
  // Visiting the room page is an explicit request for a room: open (or resume) it.
  useEffect(() => {
    if (room.status === "idle") void rt.room.open();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rt]);
  const guests = peers.filter(
    (p) =>
      p.role === "guest" && (p.status === "waiting" || p.status === "on-air"),
  );

  return (
    <div className="min-h-screen p-3 md:p-6">
      <header className="mx-auto mb-4 max-w-6xl">
        <p className="text-xs uppercase tracking-[0.3em] text-speaker-b">
          Teknodoz · DozGreenRoom
        </p>
        <h1 className="mt-1 text-3xl font-bold">Oda yönetimi</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Konuklar ve telefon kumandası kısa bir bağlantı veya QR ile gelir;
          adını girip istek gönderir. Siz bekleme havuzundan onaylarsınız,
          bağlantı otomatik kurulur. Kod kopyalama yok.
        </p>
        {room.status === "idle" && (
          <button className="sr-only" onClick={() => void rt.room.open()}>
            Odayı aç
          </button>
        )}
      </header>

      <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <RoomLinks />
        </div>
        <div className="space-y-4">
          <RoomPool />
          {guests.length > 0 && (
            <section className={PANEL} aria-label="Kulis">
              <PanelTitle>Kulis ve yayındakiler</PanelTitle>
              <div className="space-y-2">
                {guests.map((p) => (
                  <GuestCard key={p.id} peer={p} />
                ))}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Konuğu sahnede görmek için Stüdyo sayfasındaki canlı önizlemeye
                bakın; “Yayına al” katmanı otomatik ekler.
              </p>
            </section>
          )}
        </div>
        <div className="lg:col-span-2">
          <RoomLog />
        </div>
      </div>

      <CreditsFooter className="mx-auto mt-6 max-w-6xl border-t pt-3" />
    </div>
  );
}
