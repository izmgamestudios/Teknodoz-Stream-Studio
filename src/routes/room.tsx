// src/routes/room.tsx
// Room management: short links + QR, waiting pool (approve / reject), connected guests, log.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
  StudioProvider,
  useAudioState,
  usePeers,
  useRoom,
  useStudio,
} from "@/studio/runtime/use-studio";
import { CreditsFooter } from "@/studio/ui/credits";
import { EditorLinkCard, ModerationDesk } from "@/studio/ui/chat-panels";
import { GuestCard } from "@/studio/ui/live-panel";
import { RoomLinks, RoomLog, RoomPool } from "@/studio/ui/room-panels";
import { useT } from "@/studio/i18n/use-t";
import {
  BTN,
  BTN_ACCENT,
  INPUT_AUTO,
  PANEL,
  PanelTitle,
} from "@/studio/ui/fields";
import { titleFromMatches } from "@/studio/branding/head";

export const Route = createFileRoute("/room")({
  head: ({ matches }) => ({
    meta: [
      { title: titleFromMatches(matches, "Oda") },
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
          <EditorLinkCard />
          {room.status === "open" && <ListingCard />}
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
        {room.status === "open" && (
          <div className="lg:col-span-2">
            <ModerationDesk
              chat={rt.room.chat}
              director
              onMode={(m) => rt.room.setChatMode(m)}
            />
          </div>
        )}
        <div className="lg:col-span-2">
          <RoomLog />
        </div>
      </div>

      <CreditsFooter className="mx-auto mt-6 max-w-6xl border-t pt-3" />
    </div>
  );
}

/** Publishes the room as a live card on the public watch page. */
function ListingCard() {
  const t = useT();
  const rt = useStudio();
  const room = useRoom();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const listed = room.listing !== null;
  return (
    <section className={PANEL} aria-label={t("room.listing")}>
      <PanelTitle>{t("room.listing")}</PanelTitle>
      <p className="mb-2 text-xs text-muted-foreground">
        {t("room.listing.body")}
      </p>
      {listed ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
            ● {room.listing?.title}
          </span>
          <button
            className={BTN}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await rt.room.setListing(null);
              setBusy(false);
            }}
          >
            {t("common.off")}
          </button>
        </div>
      ) : (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            await rt.room.setListing({
              title: title.trim(),
              category: category.trim(),
            });
            setBusy(false);
          }}
        >
          <input
            className={`${INPUT_AUTO} min-w-0 flex-1 basis-48`}
            aria-label={t("room.listing.title")}
            placeholder={t("room.listing.title")}
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input
            className={`${INPUT_AUTO} w-36`}
            aria-label={t("room.listing.category")}
            placeholder={t("room.listing.category")}
            maxLength={30}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
          <button className={BTN_ACCENT} disabled={busy || title.trim() === ""}>
            {t("common.on")}
          </button>
        </form>
      )}
    </section>
  );
}
