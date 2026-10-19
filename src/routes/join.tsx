import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { useRemoteClient } from "@/lib/remote/client";
import { isRoomId } from "@/lib/remote/protocol";

export const Route = createFileRoute("/join")({
  validateSearch: (s: Record<string, unknown>) => ({
    room: typeof s["room"] === "string" ? s["room"] : "",
  }),
  head: () => ({
    meta: [
      { title: "Konuk olarak katıl — Teknodoz Studio" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Join,
});

function Join() {
  const { room } = Route.useSearch();
  const valid = isRoomId(room);
  const { status, shareCamera, stopCamera, guestLive, guestErr, retry } =
    useRemoteClient(valid ? room : null, false);
  const [name, setName] = useState("");
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const videoRef = useRef<HTMLVideoElement>(null);

  async function join(f: "user" | "environment") {
    setFacing(f);
    const stream = await shareCamera(name.trim() || "Konuk", f);
    if (stream && videoRef.current) videoRef.current.srcObject = stream;
  }

  if (!valid) {
    return (
      <main className="grid min-h-screen place-items-center p-6 text-center">
        <div>
          <h1 className="text-xl font-bold">Geçersiz davet bağlantısı</h1>
          <Link
            to="/"
            className="mt-4 inline-block rounded-lg bg-secondary px-4 py-2"
          >
            Ana sayfa
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md space-y-4 p-4">
      <h1 className="text-xl font-bold">🎙 Yayına konuk olarak katıl</h1>
      <p className="text-sm text-muted-foreground">
        Kameran ve mikrofonun stüdyo sahibine gönderilir. Yayına girmeden önce o
        seni kabul eder.
      </p>
      <div className="aspect-video overflow-hidden rounded-xl bg-background">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="h-full w-full object-cover"
          style={{ transform: facing === "user" ? "scaleX(-1)" : undefined }}
        />
      </div>
      {status === "error" || status === "lost" ? (
        <button
          onClick={retry}
          className="w-full rounded-xl bg-destructive py-3 font-bold text-primary-foreground"
        >
          Yeniden bağlan
        </button>
      ) : guestLive ? (
        <>
          <p className="rounded-lg bg-speaker-b/15 p-3 text-center text-sm">
            📡 Gönderiliyor… Stüdyo sahibinin “kabul et” demesini bekle.
          </p>
          <button
            onClick={() => {
              stopCamera();
              if (videoRef.current) videoRef.current.srcObject = null;
            }}
            className="w-full rounded-xl bg-destructive py-3 font-bold text-primary-foreground"
          >
            Ayrıl
          </button>
        </>
      ) : (
        <>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Adın"
            aria-label="Adın"
            className="w-full rounded-lg border bg-background px-3 py-3"
          />
          <div className="flex gap-2">
            <button
              disabled={status !== "connected"}
              onClick={() => void join("user")}
              className="min-h-14 flex-1 rounded-xl bg-primary font-bold text-primary-foreground disabled:opacity-40"
            >
              Ön kamerayla katıl
            </button>
            <button
              disabled={status !== "connected"}
              onClick={() => void join("environment")}
              className="min-h-14 flex-1 rounded-xl bg-secondary font-bold disabled:opacity-40"
            >
              Arka kamera
            </button>
          </div>
          {status === "connecting" && (
            <p className="text-center text-sm text-muted-foreground">
              Sunucuya bağlanıyor…
            </p>
          )}
        </>
      )}
      {guestErr && <p className="text-sm text-destructive">{guestErr}</p>}
    </main>
  );
}
