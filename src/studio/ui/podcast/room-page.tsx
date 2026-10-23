// src/studio/ui/podcast/room-page.tsx
// /r/CODE?mode=podcast — the page a guest or listener opens from the QR code / link.
// Deliberately minimal: a name, one button, then either a mute button + own script (guest) or a
// play button (listener).
import { useEffect, useState, useSyncExternalStore } from "react";

import { useT } from "../../i18n/use-t";
import type { MessageKey } from "../../i18n/messages";
import { RoomGuestSession, type GuestSnapshot } from "../../room/guest-session";
import { BTN_ACCENT, INPUT } from "../fields";
import { CreditsFooter } from "../credits";
import { openGuestMic, type GuestMic } from "./guest-mic";
import { PodcastGuestSeat, PodcastListenerSeat } from "./seats";

const IDLE: GuestSnapshot = {
  phase: "idle",
  hostOnline: true,
  error: null,
  name: "",
  role: null,
  client: null,
};
const noopSubscribe = () => () => undefined;
type Check = "checking" | "ok" | "missing" | "closed" | "unavailable";

export function PodcastRoomPage({
  code,
  seat,
}: {
  code: string;
  seat: "guest" | "listener";
}) {
  const t = useT();
  const [session, setSession] = useState<RoomGuestSession | null>(null);
  const [check, setCheck] = useState<Check>("checking");
  const [name, setName] = useState("");
  const [mic, setMic] = useState<GuestMic | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    const s = new RoomGuestSession({ code, usePublicStun: true });
    let off = false;
    setSession(s);
    void s.check().then((r) => {
      if (!off) setCheck(r);
    });
    const onHide = () => s.leave();
    window.addEventListener("pagehide", onHide);
    return () => {
      off = true;
      window.removeEventListener("pagehide", onHide);
      s.leave();
      s.dispose();
    };
  }, [code]);

  useEffect(() => () => mic?.stop(), [mic]);

  const snap = useSyncExternalStore(
    session ? session.subscribe : noopSubscribe,
    session ? session.getSnapshot : () => IDLE,
    () => IDLE,
  );

  async function join() {
    if (!session) return;
    setErr("");
    if (seat === "guest") {
      try {
        setMic(await openGuestMic());
      } catch {
        setErr(t("pod.guest.err.mic"));
        return;
      }
    }
    await session.join(name, seat === "guest" ? "guest" : "viewer", {
      audio: true,
    });
  }

  const form =
    check === "ok" &&
    ["idle", "error", "rejected", "closed"].includes(snap.phase);
  const joining = snap.phase === "joining";
  const connected = snap.phase === "connected" && snap.client;
  const notice =
    check === "missing"
      ? t("room.missing")
      : check === "closed"
        ? t("room.closed")
        : check === "unavailable"
          ? t("room.unavailable")
          : snap.phase === "rejected"
            ? t("room.rejected")
            : snap.phase === "closed"
              ? t("room.closedNow")
              : snap.phase === "error"
                ? t(`room.err.${snap.error}` as MessageKey)
                : err;

  return (
    <div className="mx-auto min-h-screen max-w-md space-y-4 p-4">
      <header className="pt-4">
        <p className="text-xs uppercase tracking-[0.3em] text-speaker-b">
          Teknodoz Podcast
        </p>
        <h1 className="mt-1 text-2xl font-bold">
          {seat === "guest" ? t("pod.guest.title") : t("pod.listen.title")}
        </h1>
      </header>

      {notice && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 p-3 text-sm text-destructive"
        >
          {notice}
        </p>
      )}

      {(form || joining) && (
        <form
          className="space-y-3 rounded-xl border bg-card p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void join();
          }}
        >
          <label className="block text-xs text-muted-foreground">
            {t("room.name")}
            <input
              className={`${INPUT} mt-1`}
              value={name}
              maxLength={40}
              autoComplete="name"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button
            className={`${BTN_ACCENT} w-full py-4 text-lg`}
            type="submit"
            disabled={joining || !session}
          >
            {joining ? t("room.sending") : t("pod.guest.join")}
          </button>
        </form>
      )}

      {(snap.phase === "waiting" || snap.phase === "connecting") && (
        <p className="flex items-center gap-2 font-semibold" role="status">
          <span className="inline-block size-2 animate-pulse rounded-full bg-speaker-b" />
          {t("room.waiting")}
        </p>
      )}

      {connected && seat === "guest" && mic && (
        <PodcastGuestSeat client={snap.client!} mic={mic} name={name} />
      )}
      {connected && seat === "listener" && (
        <PodcastListenerSeat client={snap.client!} />
      )}

      <CreditsFooter className="border-t pt-3" />
    </div>
  );
}
