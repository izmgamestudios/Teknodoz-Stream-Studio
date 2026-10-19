// src/components/remote-panel.tsx
import { useEffect, useState } from "react";

import { useRemoteHost } from "@/lib/remote/host";

function withSignal(url: URL) {
  try {
    const s = localStorage.getItem("studio.signal");
    if (s) url.searchParams.set("signal", s);
  } catch {
    /* storage blocked */
  }
  return url.toString();
}

/** Opt-in pairing box: phone remote (QR) and guest invite link. Nothing connects until "Başlat". */
export function RemotePanel({ className = "" }: { className?: string }) {
  const h = useRemoteHost();
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState("");

  const remoteUrl = h.roomId
    ? withSignal(new URL(`/remote?room=${h.roomId}`, location.origin))
    : "";
  const joinUrl = h.roomId
    ? withSignal(new URL(`/join?room=${h.roomId}`, location.origin))
    : "";

  useEffect(() => {
    if (!remoteUrl) return setQr("");
    let dead = false;
    void import("qrcode")
      .then((m) => m.toDataURL(remoteUrl, { width: 220, margin: 1 }))
      .then((u) => {
        if (!dead) setQr(u);
      });
    return () => {
      dead = true;
    };
  }, [remoteUrl]);

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  const btn = "rounded bg-accent px-2 py-1 text-sm hover:brightness-110";
  return (
    <div
      className={`space-y-2 rounded-lg bg-secondary p-3 text-sm ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">📱 Telefon kumandası & konuk</p>
        {h.status === "off" || h.status === "error" ? (
          <button
            onClick={h.start}
            className={`${btn} bg-speaker-b font-semibold text-background`}
          >
            {h.status === "error" ? "Tekrar dene" : "Başlat"}
          </button>
        ) : (
          <button onClick={h.stop} className={btn}>
            Kapat
          </button>
        )}
      </div>
      {h.status === "off" && (
        <p className="text-xs text-muted-foreground">
          Başlatınca eşleştirme için WebRTC sinyal sunucusuna bağlanılır; video
          ve komutlar cihazlar arasında doğrudan akar.
        </p>
      )}
      {h.status === "connecting" && (
        <p className="text-xs text-muted-foreground">Bağlanıyor…</p>
      )}
      {h.status === "error" && (
        <p className="text-xs text-destructive">
          Sinyal sunucusuna ulaşılamadı. Ağı kontrol et.
        </p>
      )}

      {h.status === "ready" && (
        <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
          {qr && (
            <img
              src={qr}
              alt="Telefon kumandası QR kodu"
              width={140}
              height={140}
              className="rounded bg-white p-1"
            />
          )}
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Telefonla QR’ı okut. Bağlı kumanda:{" "}
              <b className="text-foreground">{h.remotes}</b>
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => void copy("remote", remoteUrl)}
                className={btn}
              >
                {copied === "remote" ? "✓ Kopyalandı" : "Kumanda linki"}
              </button>
              <button
                onClick={() => void copy("join", joinUrl)}
                className={btn}
              >
                {copied === "join" ? "✓ Kopyalandı" : "🎙 Konuk daveti linki"}
              </button>
              <button
                onClick={h.renew}
                className={btn}
                title="Eski bağlantılar geçersiz olur"
              >
                ↻ Linki yenile
              </button>
            </div>
          </div>
        </div>
      )}

      {h.pending.map((g) => (
        <div
          key={g.id}
          className="flex items-center justify-between gap-2 rounded bg-background p-2"
        >
          <span>
            🎙 <b>{g.name}</b> katılmak istiyor
          </span>
          <span className="flex gap-1">
            <button
              onClick={() => h.accept(g.id)}
              className="rounded bg-speaker-b px-2 py-1 font-semibold text-background"
            >
              Kabul et
            </button>
            <button
              onClick={() => h.reject(g.id)}
              className="rounded bg-destructive px-2 py-1 text-primary-foreground"
            >
              Reddet
            </button>
          </span>
        </div>
      ))}
      {h.guest && (
        <div className="flex items-center justify-between gap-2 rounded bg-background p-2">
          <span>
            🟢 Konuk bağlı: <b>{h.guest.name}</b>
          </span>
          <button
            onClick={h.kickGuest}
            className="rounded bg-destructive px-2 py-1 text-primary-foreground"
          >
            Çıkar
          </button>
        </div>
      )}
    </div>
  );
}
