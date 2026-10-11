// src/routes/join.tsx
// Viewer / guest page. Opened from an invite link (code in the URL fragment, never sent anywhere).
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import {
  createLevelMeter,
  isP2PError,
  levelToUnit,
  p2pErrorMessage,
  stopStream,
  testMedia,
  type ClientStatus,
} from "@/studio/p2p";
import { CreditsFooter } from "@/studio/ui/credits";
import { ConnectCard } from "@/studio/ui/connect-card";
import { BTN, BTN_ACCENT, INPUT } from "@/studio/ui/fields";
import { useClientConnection } from "@/studio/ui/use-client";

export const Route = createFileRoute("/join")({
  head: () => ({
    meta: [
      { title: "Yayına katıl — Teknodoz Studio" },
      { name: "robots", content: "noindex" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: JoinPage,
});

const STATUS_TEXT: Record<ClientStatus, string> = {
  connecting: "Bağlanıyor…",
  connected: "Bağlandı — yayını izliyorsunuz",
  requesting: "Katılma isteği gönderiliyor…",
  waiting: "Kulistesiniz. Yayıncı sizi yayına alınca görüntünüz yayınlanır.",
  "on-air": "● Yayındasınız — kulaklık takmanız önerilir",
  rejected: "Yayıncı isteğinizi reddetti.",
  disconnected: "Bağlantı koptu.",
};

function JoinPage() {
  const conn = useClientConnection();
  const { client, status } = conn;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [needSound, setNeedSound] = useState(false);

  const [stream, setStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    if (!client) return;
    return client.onStream(setStream);
  }, [client]);

  const connected = conn.phase === "answer" && status !== "connecting";

  // Attach once both the stream and the <video> exist (the element only renders when connected).
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !stream) return;
    v.srcObject = stream;
    v.muted = false;
    v.play().catch(() => {
      // autoplay with sound was blocked: fall back to muted and offer a button
      v.muted = true;
      setNeedSound(true);
      void v.play().catch(() => undefined);
    });
  }, [stream, connected]);

  return (
    <div className="mx-auto min-h-screen max-w-2xl space-y-4 p-4">
      <header className="pt-4">
        <p className="text-xs uppercase tracking-[0.3em] text-speaker-b">
          Teknodoz Studio
        </p>
        <h1 className="mt-1 text-2xl font-bold">Yayına katıl</h1>
      </header>

      <ConnectCard
        phase={conn.phase}
        answer={conn.answer}
        status={status}
        error={conn.error}
        askName
        onConnect={conn.connect}
      />

      {connected && (
        <section
          className="space-y-3 rounded-xl border bg-card p-4"
          aria-live="polite"
        >
          <p className="text-sm font-medium">{STATUS_TEXT[status]}</p>
          <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              controls
              className="h-full w-full object-contain"
            />
          </div>
          {needSound && (
            <button
              className={BTN}
              onClick={() => {
                if (videoRef.current) videoRef.current.muted = false;
                setNeedSound(false);
              }}
            >
              🔊 Sesi aç
            </button>
          )}
          {client?.role === "guest" && status !== "disconnected" && (
            <GuestControls client={client} status={status} />
          )}
        </section>
      )}

      <CreditsFooter className="border-t pt-3" />
    </div>
  );
}

function GuestControls({
  client,
  status,
}: {
  client: NonNullable<ReturnType<typeof useClientConnection>["client"]>;
  status: ClientStatus;
}) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [name, setName] = useState(client.name);
  const [err, setErr] = useState("");
  const previewRef = useRef<HTMLVideoElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  const joined =
    status === "requesting" || status === "waiting" || status === "on-air";

  useEffect(() => {
    const v = previewRef.current;
    if (v) v.srcObject = stream;
    if (!stream) return;
    let raf = 0;
    let meter: ReturnType<typeof createLevelMeter> | null = null;
    try {
      meter = createLevelMeter(stream);
    } catch {
      meter = null;
    }
    const tick = () => {
      if (meter && meterRef.current)
        meterRef.current.style.width = `${levelToUnit(meter.getLevel()) * 100}%`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      meter?.dispose();
    };
  }, [stream]);

  useEffect(() => () => stopStream(stream), [stream]);

  async function test() {
    setErr("");
    try {
      const r = await testMedia();
      setStream(r.stream);
    } catch (e) {
      setErr(
        isP2PError(e) ? p2pErrorMessage(e.code) : "Kamera/mikrofon açılamadı.",
      );
    }
  }

  async function join() {
    if (!stream) return;
    setErr("");
    try {
      await client.startGuest(stream, name);
    } catch (e) {
      setErr(isP2PError(e) ? p2pErrorMessage(e.code) : "İstek gönderilemedi.");
    }
  }

  return (
    <div className="space-y-3 border-t pt-3">
      <h2 className="text-sm font-semibold">Konuk olarak katıl</h2>
      {!stream ? (
        <button className={BTN_ACCENT} onClick={() => void test()}>
          🎥 Kamera ve mikrofonu test et
        </button>
      ) : (
        <>
          <div className="flex flex-wrap items-start gap-3">
            <video
              ref={previewRef}
              autoPlay
              muted
              playsInline
              className="h-28 w-48 rounded-md bg-black object-cover"
              style={{ transform: "scaleX(-1)" }}
            />
            <div className="min-w-0 flex-1 space-y-2">
              <label className="block text-xs text-muted-foreground">
                Adınız
                <input
                  className={`${INPUT} mt-1`}
                  value={name}
                  maxLength={40}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <div>
                <p className="mb-1 text-xs text-muted-foreground">
                  Mikrofon seviyesi
                </p>
                <div
                  className="h-2 overflow-hidden rounded-full bg-secondary"
                  aria-hidden
                >
                  <div
                    ref={meterRef}
                    className="h-full w-0 bg-speaker-b transition-[width] duration-75"
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {!joined ? (
              <button className={BTN_ACCENT} onClick={() => void join()}>
                Kulise gir (istek gönder)
              </button>
            ) : (
              <button className={BTN} onClick={() => void client.leaveGuest()}>
                Ayrıl (izleyiciye dön)
              </button>
            )}
            <button
              className={BTN}
              onClick={() => {
                void client.leaveGuest().catch(() => undefined);
                setStream(null);
              }}
            >
              Kamerayı kapat
            </button>
          </div>
        </>
      )}
      {err && (
        <p role="alert" className="text-xs text-destructive">
          {err}
        </p>
      )}
    </div>
  );
}
