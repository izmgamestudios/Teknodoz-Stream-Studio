// src/routes/r.$code.tsx
// Short invite link: https://<host>/r/K7M2QX[?as=guest|viewer|remote]
// The participant only enters a name; the studio operator approves from the waiting pool and the
// WebRTC handshake runs automatically through the relay (no codes to copy or paste).
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useSyncExternalStore } from "react";

import {
  RoomGuestSession,
  type GuestSnapshot,
} from "@/studio/room/guest-session";
import type { RoomRole } from "@/studio/room/api";
import { CreditsFooter } from "@/studio/ui/credits";
import { BTN, BTN_ACCENT, INPUT } from "@/studio/ui/fields";
import { RemoteView, ViewerGuestView } from "@/studio/ui/guest-views";

export const Route = createFileRoute("/r/$code")({
  validateSearch: (s: Record<string, unknown>): { as?: RoomRole } =>
    s["as"] === "guest" || s["as"] === "viewer" || s["as"] === "remote"
      ? { as: s["as"] }
      : {},
  head: () => ({
    meta: [
      { title: "Yayına katıl — Teknodoz Studio" },
      { name: "robots", content: "noindex" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: RoomLanding,
});

const ROLES: { role: RoomRole; title: string; hint: string; icon: string }[] = [
  {
    role: "guest",
    title: "Konuk",
    hint: "Kamera ve mikrofonla yayına çıkarım",
    icon: "🎥",
  },
  {
    role: "viewer",
    title: "İzleyici",
    hint: "Yalnızca yayını izlerim",
    icon: "👀",
  },
  {
    role: "remote",
    title: "Telefon kumandası",
    hint: "Sahne, prompter ve kaydı yönetirim",
    icon: "📱",
  },
];

const IDLE: GuestSnapshot = {
  phase: "idle",
  hostOnline: true,
  error: null,
  name: "",
  role: null,
  client: null,
};
const noopSubscribe = () => () => undefined;

const ERROR_TEXT: Record<string, string> = {
  "rate-limited": "Çok fazla deneme yapıldı. Biraz bekleyip tekrar deneyin.",
  full: "Bekleme havuzu dolu. Yayıncıdan yer açmasını isteyin.",
  closed: "Oda kapatılmış.",
  "not-found": "Oda bulunamadı.",
  forbidden: "Oturum süresi doldu. Tekrar katılma isteği gönderin.",
  network: "Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin.",
};

type Check = "checking" | "ok" | "missing" | "closed" | "unavailable";

function RoomLanding() {
  const { code } = Route.useParams();
  const search = Route.useSearch();
  const fixedRole = search.as;
  const [session, setSession] = useState<RoomGuestSession | null>(null);
  const [check, setCheck] = useState<Check>("checking");
  const [role, setRole] = useState<RoomRole>(fixedRole ?? "guest");
  const [name, setName] = useState("");
  const [stun, setStun] = useState(true);

  useEffect(() => {
    const s = new RoomGuestSession({ code, usePublicStun: stun });
    let off = false;
    setSession(s);
    void (async () => {
      if (await s.resume()) {
        if (!off) setCheck("ok");
        return;
      }
      const r = await s.check();
      if (!off) setCheck(r);
    })();
    const onHide = () => s.leave();
    window.addEventListener("pagehide", onHide);
    return () => {
      off = true;
      window.removeEventListener("pagehide", onHide);
      s.leave();
      s.dispose();
    };
    // `stun` is read when the offer arrives; changing it later must not recreate the session
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const snap = useSyncExternalStore(
    session ? session.subscribe : noopSubscribe,
    session ? session.getSnapshot : () => IDLE,
    () => IDLE,
  );

  const activeRole = fixedRole ?? role;
  const busy = snap.phase === "joining";

  return (
    <div className="mx-auto min-h-screen max-w-2xl space-y-4 p-4">
      <header className="pt-4">
        <p className="text-xs uppercase tracking-[0.3em] text-speaker-b">
          Teknodoz Studio
        </p>
        <h1 className="mt-1 text-2xl font-bold">Yayına katıl</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Oda{" "}
          <span className="font-mono font-bold tracking-widest text-foreground">
            {code.toUpperCase()}
          </span>
        </p>
      </header>

      {check === "checking" && (
        <p className="text-sm text-muted-foreground">Oda kontrol ediliyor…</p>
      )}
      {check === "missing" && (
        <Notice tone="error">
          Bu oda bulunamadı veya süresi doldu. Yayıncıdan yeni bir bağlantı
          isteyin.
        </Notice>
      )}
      {check === "closed" && <Notice tone="error">Bu oda kapatılmış.</Notice>}
      {check === "unavailable" && (
        <Notice tone="error">
          Bu sunucuda hızlı oda bağlantısı kullanılamıyor. Yayıncıdan “manuel
          bağlantı” daveti isteyin (
          <a className="underline" href="/join">
            /join
          </a>
          ).
        </Notice>
      )}

      {check === "ok" &&
        (snap.phase === "idle" ||
          snap.phase === "error" ||
          snap.phase === "rejected" ||
          snap.phase === "closed" ||
          busy) && (
          <form
            className="space-y-4 rounded-xl border bg-card p-4"
            onSubmit={(e) => {
              e.preventDefault();
              void session?.join(name, activeRole);
            }}
          >
            {!fixedRole && (
              <fieldset className="grid gap-2 sm:grid-cols-3">
                <legend className="mb-1 text-xs text-muted-foreground">
                  Nasıl katılmak istiyorsunuz?
                </legend>
                {ROLES.map((r) => (
                  <label
                    key={r.role}
                    className={`cursor-pointer rounded-lg border p-3 text-sm ${activeRole === r.role ? "border-speaker-b bg-speaker-b/10" : "hover:bg-accent"}`}
                  >
                    <input
                      type="radio"
                      name="role"
                      className="sr-only"
                      checked={activeRole === r.role}
                      onChange={() => setRole(r.role)}
                    />
                    <span className="block font-semibold">
                      {r.icon} {r.title}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {r.hint}
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            {fixedRole && (
              <p className="text-sm">
                {ROLES.find((r) => r.role === fixedRole)?.icon}{" "}
                <b>{ROLES.find((r) => r.role === fixedRole)?.title}</b> olarak
                katılacaksınız.
              </p>
            )}
            <label className="block text-xs text-muted-foreground">
              Adınız (yayıncı görür)
              <input
                className={`${INPUT} mt-1`}
                value={name}
                maxLength={40}
                autoComplete="name"
                onChange={(e) => setName(e.target.value)}
                placeholder={activeRole === "remote" ? "Telefon" : "Adınız"}
              />
            </label>
            {!snap.hostOnline && (
              <p className="text-xs text-primary">
                Yayıncı şu an çevrimdışı görünüyor. İstek göndermeye devam
                edebilirsiniz; yayıncı döndüğünde görür.
              </p>
            )}
            {snap.phase === "rejected" && (
              <Notice tone="error">Yayıncı isteğinizi reddetti.</Notice>
            )}
            {snap.phase === "closed" && (
              <Notice tone="error">
                Oda kapatıldı. Yeni bir bağlantı isteyin.
              </Notice>
            )}
            {snap.phase === "error" && (
              <Notice tone="error">
                {ERROR_TEXT[snap.error ?? ""] ??
                  "Katılma isteği gönderilemedi."}
              </Notice>
            )}
            <button
              className={BTN_ACCENT}
              type="submit"
              disabled={busy || !session}
            >
              {busy ? "Gönderiliyor…" : "Katılma isteği gönder"}
            </button>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Gelişmiş</summary>
              <label className="mt-2 flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={stun}
                  onChange={(e) => setStun(e.target.checked)}
                />
                <span>
                  Genel STUN kullan (internet üzerinden bağlanmak için; yalnızca
                  IP adresiniz STUN sağlayıcısına görünür).
                </span>
              </label>
            </details>
            <p className="text-[11px] text-muted-foreground">
              Kamera, mikrofon veya ekran görüntünüz hiçbir sunucuya gitmez;
              yalnızca yayıncının tarayıcısıyla doğrudan (P2P) paylaşılır.
              Sunucu yalnızca bağlantı kurulumuna aracılık eder.
            </p>
          </form>
        )}

      {snap.phase === "waiting" && (
        <div
          className="space-y-3 rounded-xl border bg-card p-4"
          role="status"
          aria-live="polite"
        >
          <p className="flex items-center gap-2 font-semibold">
            <span className="inline-block size-2 animate-pulse rounded-full bg-speaker-b" />
            Yayıncının onayı bekleniyor…
          </p>
          <p className="text-sm text-muted-foreground">
            İsteğiniz stüdyodaki bekleme havuzuna düştü. Onaylanınca otomatik
            bağlanacaksınız; bu sayfayı açık tutun.
          </p>
          {!snap.hostOnline && (
            <p className="text-xs text-primary">
              Yayıncı şu an çevrimdışı görünüyor.
            </p>
          )}
          <button
            className={BTN}
            onClick={() => {
              session?.leave();
              location.reload();
            }}
          >
            Vazgeç
          </button>
        </div>
      )}

      {snap.phase === "connecting" && (
        <div className="rounded-xl border bg-card p-4" role="status">
          <p className="font-semibold">Onaylandı — bağlanılıyor…</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Bu birkaç saniye sürebilir.
          </p>
        </div>
      )}

      {snap.phase === "connected" &&
        snap.client &&
        (snap.role === "remote" ? (
          <RemoteView client={snap.client} />
        ) : (
          <ViewerGuestView client={snap.client} />
        ))}

      <CreditsFooter className="border-t pt-3" />
    </div>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "error" | "info";
  children: React.ReactNode;
}) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-md border p-3 text-sm ${tone === "error" ? "border-destructive/40 text-destructive" : "text-muted-foreground"}`}
    >
      {children}
    </p>
  );
}
