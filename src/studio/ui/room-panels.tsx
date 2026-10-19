// src/studio/ui/room-panels.tsx
// Room management UI: short links + QR, the waiting pool (approve / reject), and the activity log.
import { useEffect, useState } from "react";

import { downloadBlob } from "../engine/download";
import type { PoolEntry } from "../room/host-session";
import { logToCsv, type LogKind } from "../room/log";
import type { RoomRole } from "../room/api";
import { useRoom, useStudio } from "../runtime/use-studio";
import { BTN, BTN_ACCENT, Check, INPUT, PANEL, PanelTitle } from "./fields";
import { QrImage } from "./qr-image";

export const ROLE_INFO: Record<
  RoomRole,
  { title: string; icon: string; hint: string }
> = {
  guest: {
    title: "Konuk",
    icon: "🎥",
    hint: "İzler; kulisten yayına alınabilir",
  },
  viewer: { title: "Salt izleyici", icon: "👀", hint: "Yalnızca yayını izler" },
  remote: {
    title: "Telefon kumandası",
    icon: "📱",
    hint: "Sahne, prompter, kayıt",
  },
  chat: {
    title: "Yalnızca sohbet",
    icon: "💬",
    hint: "Görüntü/ses yok; mesajı onayınıza gider (etkinlik katılımcısı)",
  },
};

function useNow(ms = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

function ago(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return "az önce";
  const m = Math.round(s / 60);
  return m < 60 ? `${m} dk önce` : `${Math.round(m / 60)} sa önce`;
}

const STATE_LABEL: Record<PoolEntry["state"], string> = {
  waiting: "bekliyor",
  approving: "onaylanıyor…",
  connecting: "bağlanıyor…",
  connected: "bağlı",
  failed: "başarısız",
  rejected: "reddedildi",
  left: "ayrıldı",
};

const ERROR_TEXT: Record<string, string> = {
  unavailable:
    "Bu sunucuda oda rölesi yok (statik/serverless barındırma). Manuel bağlantıyı kullanın.",
  network: "Sunucuya ulaşılamadı.",
  "rate-limited": "Çok sık oda oluşturuldu. Biraz bekleyin.",
  server: "Sunucu hatası.",
  closed: "Oda kapatılmış.",
  forbidden: "Oda yetkisi kayboldu.",
  "not-found": "Oda süresi dolmuş.",
};

/* ------------------------------------------------------------------ */

export function RoomLinks({ compact = false }: { compact?: boolean }) {
  const rt = useStudio();
  const room = useRoom();
  const [qrFor, setQrFor] = useState<RoomRole | null>(compact ? null : "guest");
  const [copied, setCopied] = useState<RoomRole | null>(null);

  async function copy(role: RoomRole) {
    try {
      await navigator.clipboard.writeText(rt.room.link(role));
      setCopied(role);
      setTimeout(() => setCopied((c) => (c === role ? null : c)), 1500);
    } catch {
      // the field is selectable
    }
  }

  if (room.status === "idle" || room.status === "opening") {
    return (
      <div className={compact ? "" : PANEL}>
        <p className="mb-2 text-xs text-muted-foreground">
          Oda açınca <b>kısa bir bağlantı/QR</b> alırsınız. Katılımcılar
          yalnızca adını girer; siz bekleme havuzundan onaylarsınız, bağlantı
          otomatik kurulur.
        </p>
        <button
          className={BTN_ACCENT}
          disabled={room.status === "opening"}
          onClick={() => void rt.room.open()}
        >
          {room.status === "opening" ? "Açılıyor…" : "🚪 Odayı aç"}
        </button>
      </div>
    );
  }

  if (room.status === "unavailable" || room.status === "error") {
    return (
      <div className={compact ? "" : PANEL}>
        <p role="alert" className="mb-2 text-xs text-destructive">
          {ERROR_TEXT[room.error ?? ""] ?? "Oda açılamadı."}
        </p>
        <button className={BTN} onClick={() => void rt.room.newRoom()}>
          Tekrar dene
        </button>
      </div>
    );
  }

  const roles: RoomRole[] = ["guest", "viewer", "remote", "chat"];
  return (
    <div className={compact ? "space-y-2" : `${PANEL} space-y-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Oda kodu
          </p>
          <p className="font-mono text-2xl font-bold tracking-[0.3em]">
            {room.code}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`text-xs ${room.online ? "text-muted-foreground" : "text-destructive"}`}
          >
            {room.online ? "● röle bağlı" : "○ röle koptu, yeniden deneniyor"}
          </span>
          <button
            className={BTN}
            onClick={() => {
              if (
                window.confirm(
                  "Yeni kod üretilsin mi? Eski bağlantı ve QR'lar çalışmaz, bekleyenler düşer.",
                )
              )
                void rt.room.newRoom();
            }}
          >
            Yeni kod
          </button>
          <button
            className={BTN}
            onClick={() => {
              if (
                window.confirm(
                  "Oda kapatılsın mı? Bağlı olanlar bağlı kalır, yeni istek alınmaz.",
                )
              )
                void rt.room.close();
            }}
          >
            Kapat
          </button>
        </div>
      </div>

      <ul className="space-y-2">
        {roles.map((r) => {
          const url = rt.room.link(r);
          return (
            <li key={r} className="rounded-lg border p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold">
                  {ROLE_INFO[r].icon} {ROLE_INFO[r].title}
                  <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                    {ROLE_INFO[r].hint}
                  </span>
                </span>
                <span className="flex gap-1.5">
                  <button className={BTN} onClick={() => void copy(r)}>
                    {copied === r ? "✓ Kopyalandı" : "Kopyala"}
                  </button>
                  <button
                    className={BTN}
                    aria-pressed={qrFor === r}
                    onClick={() => setQrFor(qrFor === r ? null : r)}
                  >
                    QR
                  </button>
                </span>
              </div>
              <input
                readOnly
                className={`${INPUT} mt-1.5 font-mono`}
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                aria-label={`${ROLE_INFO[r].title} bağlantısı`}
              />
              {qrFor === r && (
                <div className="mt-2 flex items-center gap-3">
                  <QrImage text={url} size={compact ? 150 : 200} />
                  <p className="text-[11px] text-muted-foreground">
                    Telefonun kamerasıyla okutun. Katılımcı adını girip istek
                    gönderir; onayı siz verirsiniz.
                  </p>
                </div>
              )}
              {r !== "chat" ? (
                <div className="mt-1.5">
                  <Check
                    checked={room.autoApprove[r]}
                    onChange={(on) => rt.room.setAutoApprove(r, on)}
                  >
                    <span className="text-[11px]">
                      Bu bağlantıyla gelenleri otomatik onayla
                    </span>
                  </Check>
                </div>
              ) : (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Katılım onaysızdır (görüntü/ses akışı yok); denetim her
                  mesajda yapılır: Sohbet masasında onaylayın.
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-muted-foreground">
        Bağlantıya sahip herkes bekleme havuzuna istek gönderebilir;
        onaylamadığınız sürece bağlanamaz. Otomatik onay yalnızca güvendiğiniz
        kitle için açılmalı.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function RoomPool({ compact = false }: { compact?: boolean }) {
  const rt = useStudio();
  const room = useRoom();
  const now = useNow();
  if (room.status !== "open" && room.pool.length === 0) return null;

  const waiting = room.pool.filter((e) => e.state === "waiting");
  const rest = room.pool.filter((e) => e.state !== "waiting");

  return (
    <div className={compact ? "space-y-2" : `${PANEL} space-y-3`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
          Bekleme havuzu{" "}
          {waiting.length > 0 && (
            <span className="ml-1 rounded-full bg-primary-solid px-1.5 py-0.5 text-[10px] text-primary-foreground">
              {waiting.length}
            </span>
          )}
        </h3>
        {waiting.length > 1 && (
          <button className={BTN} onClick={() => void rt.room.approveAll()}>
            Hepsini onayla
          </button>
        )}
      </div>

      {room.pool.length === 0 && (
        <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
          Henüz kimse beklemiyor. Bağlantıyı veya QR'ı paylaşın.
        </p>
      )}

      <ul className="space-y-1.5" aria-live="polite">
        {[...waiting, ...rest].map((e) => (
          <PoolRow key={e.guestId} entry={e} now={now} />
        ))}
      </ul>
    </div>
  );
}

function PoolRow({ entry: e, now }: { entry: PoolEntry; now: number }) {
  const rt = useStudio();
  const busy = e.state === "approving" || e.state === "connecting";
  const done =
    e.state === "failed" || e.state === "rejected" || e.state === "left";
  return (
    <li
      className={`flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-2 text-sm ${
        e.state === "waiting"
          ? "border-primary/60 bg-primary/5"
          : done
            ? "opacity-60"
            : ""
      }`}
    >
      <span aria-hidden>{ROLE_INFO[e.role].icon}</span>
      <span className="min-w-0 flex-1">
        <b className="block truncate">{e.name}</b>
        <span className="text-[11px] text-muted-foreground">
          {ROLE_INFO[e.role].title} · {ago(e.requestedAt, now)} ·{" "}
          {STATE_LABEL[e.state]}
          {e.note ? ` — ${e.note}` : ""}
        </span>
      </span>
      {e.state === "waiting" && (
        <span className="flex gap-1.5">
          <button
            className={BTN_ACCENT}
            onClick={() => void rt.room.approve(e.guestId)}
          >
            Onayla
          </button>
          <button
            className={BTN}
            onClick={() => void rt.room.reject(e.guestId)}
          >
            Reddet
          </button>
        </span>
      )}
      {busy && (
        <span className="animate-pulse text-xs text-muted-foreground">
          {STATE_LABEL[e.state]}
        </span>
      )}
      {e.state === "connected" && (
        <button className={BTN} onClick={() => rt.room.kick(e.guestId)}>
          Bağlantıyı kes
        </button>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ */

const KIND_LABEL: Record<LogKind, string> = {
  room: "oda",
  link: "bağlantı",
  request: "istek",
  approve: "onay",
  reject: "ret",
  connect: "bağlandı",
  disconnect: "ayrıldı",
  chat: "sohbet",
  error: "hata",
};
const KIND_COLOR: Record<LogKind, string> = {
  room: "text-muted-foreground",
  link: "text-muted-foreground",
  request: "text-primary",
  approve: "text-speaker-b",
  reject: "text-destructive",
  connect: "text-speaker-b",
  disconnect: "text-muted-foreground",
  chat: "text-muted-foreground",
  error: "text-destructive",
};

export function RoomLog() {
  const rt = useStudio();
  const room = useRoom();
  const [filter, setFilter] = useState<LogKind | "all">("all");
  const rows = [...room.log]
    .reverse()
    .filter((l) => filter === "all" || l.kind === filter);

  return (
    <section className={PANEL} aria-label="Günlük">
      <PanelTitle
        aside={
          <span className="flex flex-wrap items-center gap-1.5">
            <select
              aria-label="Günlük süzgeci"
              className="rounded-md border bg-background px-2 py-1 text-xs"
              value={filter}
              onChange={(e) => setFilter(e.target.value as LogKind | "all")}
            >
              <option value="all">Tümü</option>
              {(Object.keys(KIND_LABEL) as LogKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
            <button
              className={BTN}
              disabled={room.log.length === 0}
              onClick={() =>
                downloadBlob(
                  new Blob(["﻿", logToCsv(room.log)], {
                    type: "text/csv;charset=utf-8",
                  }),
                  `oda-gunlugu-${new Date().toISOString().slice(0, 10)}.csv`,
                )
              }
            >
              CSV indir
            </button>
            <button
              className={BTN}
              disabled={room.log.length === 0}
              onClick={() => {
                if (window.confirm("Günlük silinsin mi?"))
                  void rt.room.clearLog();
              }}
            >
              Temizle
            </button>
          </span>
        }
      >
        Günlük
      </PanelTitle>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Kayıt yok. Davetler, onaylar ve bağlantılar burada listelenir.
        </p>
      ) : (
        <ul className="max-h-80 space-y-0.5 overflow-y-auto font-mono text-xs">
          {rows.map((l) => (
            <li key={l.id} className="flex gap-2">
              <time
                className="shrink-0 text-muted-foreground"
                dateTime={new Date(l.at).toISOString()}
              >
                {new Date(l.at).toLocaleTimeString("tr-TR")}
              </time>
              <span className={`w-16 shrink-0 ${KIND_COLOR[l.kind]}`}>
                {KIND_LABEL[l.kind]}
              </span>
              <span className="min-w-0 break-words">{l.text}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        Günlük yalnızca bu tarayıcıda (IndexedDB) tutulur; sunucuya gönderilmez.
      </p>
    </section>
  );
}
