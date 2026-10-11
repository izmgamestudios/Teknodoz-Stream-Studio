// src/studio/ui/live-panel.tsx
// Host side of the serverless P2P layer: invites (link/QR), answer codes, peer list and the
// green room (preview waiting guests, bring on air, gain/mute).
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import {
  extractCode,
  isP2PError,
  p2pErrorMessage,
  isSignalError,
} from "../p2p";
import { isP2PSupported } from "../p2p/rtc";
import { usePeers, useStudio } from "../runtime/use-studio";
import type { PeerInfo, PeerRole } from "../types";
import {
  BTN,
  BTN_ACCENT,
  INPUT,
  PANEL,
  PanelTitle,
  RangeInput,
} from "./fields";
import { QrImage } from "./qr-image";
import { QrScanner, isQrScanSupported } from "./qr-scanner";
import { RoomLinks, RoomPool } from "./room-panels";

interface Invite {
  peerId: string;
  role: PeerRole;
  url: string;
}

const ROLE_LABEL: Record<PeerRole, string> = {
  viewer: "İzleyici",
  guest: "İzleyici + konuk",
  remote: "Telefon kumandası",
};

const STATUS_LABEL: Record<PeerInfo["status"], string> = {
  connecting: "bağlanıyor…",
  connected: "izliyor",
  waiting: "kulis (bekliyor)",
  "on-air": "● yayında",
  disconnected: "bağlantı koptu",
};

function errText(e: unknown): string {
  if (isP2PError(e)) return p2pErrorMessage(e.code);
  if (isSignalError(e))
    return "Kod geçersiz veya bozuk. Tamamını kopyaladığınızdan emin olun.";
  return "Bağlantı kurulamadı.";
}

export function LivePanel() {
  const rt = useStudio();
  const peers = usePeers();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const supported = isP2PSupported();

  async function create(role: PeerRole) {
    setBusy(true);
    setErr("");
    try {
      const r = await rt.createInvite(role);
      setInvites((cur) => [...cur, { peerId: r.peerId, role, url: r.url }]);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  // an invite disappears once its peer is connected, expired or kicked
  const pending = invites.filter((i) => {
    const p = peers.find((x) => x.id === i.peerId);
    return p && p.status === "connecting";
  });

  const guests = peers.filter(
    (p) =>
      p.role === "guest" && (p.status === "waiting" || p.status === "on-air"),
  );
  const others = peers.filter(
    (p) =>
      !(
        p.role === "guest" &&
        (p.status === "waiting" || p.status === "on-air")
      ),
  );

  return (
    <section className={PANEL} aria-label="Canlı bağlantılar">
      <PanelTitle
        aside={
          <Link
            to="/room"
            className="text-[11px] text-speaker-b underline-offset-2 hover:underline"
          >
            Oda yönetimi →
          </Link>
        }
      >
        Canlı bağlantılar &amp; kulis
      </PanelTitle>
      {!supported && (
        <p role="alert" className="mb-2 text-xs text-destructive">
          Bu tarayıcıda WebRTC kullanılamıyor.
        </p>
      )}

      <RoomLinks compact />
      <div className="mt-3">
        <RoomPool compact />
      </div>

      {guests.length > 0 && (
        <div className="mt-3 space-y-2 border-t pt-3">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Kulis
          </h3>
          {guests.map((p) => (
            <GuestCard key={p.id} peer={p} />
          ))}
        </div>
      )}

      {others.length > 0 && (
        <ul className="mt-3 space-y-1 border-t pt-3">
          {others.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-2 rounded-md bg-secondary/60 px-2 py-1 text-xs"
            >
              <span className="min-w-0 flex-1 truncate">
                {p.name}{" "}
                <span className="text-muted-foreground">
                  · {ROLE_LABEL[p.role]}
                </span>
              </span>
              <span className="shrink-0 text-muted-foreground">
                {STATUS_LABEL[p.status]}
              </span>
              <button
                aria-label={`${p.name} bağlantısını kes`}
                className="px-1 text-destructive hover:opacity-80"
                onClick={() => rt.kickPeer(p.id)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <details className="mt-3 border-t pt-3">
        <summary className="cursor-pointer text-xs text-muted-foreground">
          Manuel bağlantı (sunucusuz, kod değişimi)
        </summary>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            className={BTN}
            disabled={busy || !supported}
            onClick={() => void create("guest")}
          >
            + Yayın daveti
          </button>
          <button
            className={BTN}
            disabled={busy || !supported}
            onClick={() => void create("viewer")}
          >
            + Salt izleyici
          </button>
          <button
            className={BTN}
            disabled={busy || !supported}
            onClick={() => void create("remote")}
          >
            📱 Telefon kumandası
          </button>
        </div>
        {err && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {err}
          </p>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          Oda rölesi yoksa kullanın: daveti gönderin, karşı tarafın{" "}
          <b>yanıt kodunu</b> yapıştırın (veya QR'ını tarayın).
        </p>
        {pending.map((inv) => (
          <InviteCard
            key={inv.peerId}
            invite={inv}
            onCancel={() => {
              rt.kickPeer(inv.peerId);
              setInvites((cur) => cur.filter((i) => i.peerId !== inv.peerId));
            }}
          />
        ))}
      </details>
    </section>
  );
}

function InviteCard({
  invite,
  onCancel,
}: {
  invite: Invite;
  onCancel: () => void;
}) {
  const rt = useStudio();
  const [answer, setAnswer] = useState("");
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(invite.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setMsg("Kopyalanamadı: bağlantıyı elle seçip kopyalayın.");
    }
  }

  async function connect(override?: string) {
    setBusy(true);
    setMsg("");
    try {
      await rt.acceptAnswer(invite.peerId, extractCode(override ?? answer));
      setMsg("Yanıt alındı, bağlanılıyor…");
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-2 rounded-lg border p-2">
      <div className="flex items-center justify-between text-xs">
        <b>{ROLE_LABEL[invite.role]} daveti</b>
        <button
          className="text-muted-foreground hover:text-foreground"
          onClick={onCancel}
        >
          İptal
        </button>
      </div>
      <div className="flex flex-wrap items-start gap-3">
        <QrImage text={invite.url} size={168} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-[11px] text-muted-foreground">
            1) Bağlantıyı gönderin veya QR’ı okutun. Kod bağlantının{" "}
            <code>#</code> kısmındadır; hiçbir sunucuya gitmez.
          </p>
          <input
            readOnly
            className={INPUT}
            value={invite.url}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Davet bağlantısı"
          />
          <button className={BTN} onClick={() => void copy()}>
            {copied ? "✓ Kopyalandı" : "Bağlantıyı kopyala"}
          </button>
        </div>
      </div>
      <label className="block text-[11px] text-muted-foreground">
        2) Karşı tarafın verdiği <b>yanıt kodunu</b> yapıştırın
        <textarea
          className={`${INPUT} mt-1 h-16 resize-y font-mono`}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="TKZ1.…"
          spellCheck={false}
        />
      </label>
      <div className="flex items-center gap-2">
        <button
          className={BTN_ACCENT}
          disabled={busy || answer.trim() === ""}
          onClick={() => void connect()}
        >
          Bağlan
        </button>
        <button
          className={BTN}
          disabled={busy}
          title={
            isQrScanSupported()
              ? "Karşı tarafın yanıt QR'ını kamerayla tara"
              : "Bu tarayıcı QR taramayı desteklemiyor"
          }
          onClick={() => setScanning((v) => !v)}
        >
          📷 Yanıt QR'ını tara
        </button>
        {msg && (
          <span role="status" className="text-xs text-muted-foreground">
            {msg}
          </span>
        )}
      </div>
      {scanning && (
        <QrScanner
          labels={{
            title: "Yanıt QR'ını tara",
            hint: "Konuğun ekranındaki QR kodunu kameraya tutun; okununca otomatik bağlanır.",
            close: "Kapat",
            denied: "Kamera açılamadı. İzin verin veya kodu yapıştırın.",
            unsupported:
              "Bu tarayıcı QR taramayı desteklemiyor (Android/macOS Chrome gerekir). Yanıt kodunu yapıştırın.",
          }}
          onClose={() => setScanning(false)}
          onResult={(text) => {
            setScanning(false);
            setAnswer(text);
            void connect(text);
          }}
        />
      )}
    </div>
  );
}

export function GuestCard({ peer }: { peer: PeerInfo }) {
  const rt = useStudio();
  const videoRef = useRef<HTMLVideoElement>(null);
  const meter = useRef<HTMLDivElement>(null);
  const stream = rt.getGuestStream(peer.id);
  const onAir = peer.status === "on-air";

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.srcObject = stream;
  }, [stream]);

  // live VU of the guest channel
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const lv = rt.audio.hasChannel(`guest:${peer.id}`)
        ? rt.audio.getLevel(`guest:${peer.id}`).db
        : -100;
      if (meter.current)
        meter.current.style.width = `${Math.max(0, Math.min(100, ((lv + 60) / 60) * 100))}%`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [rt, peer.id]);

  return (
    <div
      className={`rounded-lg border p-2 ${onAir ? "border-primary/60" : ""}`}
    >
      <div className="flex gap-2">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="h-20 w-32 shrink-0 rounded-md bg-black object-cover"
        />
        <div className="min-w-0 flex-1 space-y-1 text-xs">
          <div className="flex items-center justify-between gap-2">
            <b className="truncate">{peer.name}</b>
            <span className={onAir ? "text-primary" : "text-muted-foreground"}>
              {STATUS_LABEL[peer.status]}
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {onAir ? (
              <button
                className={BTN}
                onClick={() => rt.takeGuestOffAir(peer.id)}
              >
                Yayından al
              </button>
            ) : (
              <>
                <button
                  className={BTN_ACCENT}
                  onClick={() => rt.bringGuestOnAir(peer.id)}
                >
                  Yayına al
                </button>
                <button className={BTN} onClick={() => rt.rejectGuest(peer.id)}>
                  Reddet
                </button>
              </>
            )}
            <button className={BTN} onClick={() => rt.kickPeer(peer.id)}>
              At
            </button>
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs">
        <span className="w-14 shrink-0 text-muted-foreground">
          Ses %{Math.round(peer.gain * 100)}
        </span>
        <span className="flex-1">
          <RangeInput
            label={`${peer.name} ses seviyesi`}
            min={0}
            max={1.5}
            step={0.01}
            value={peer.gain}
            onChange={(g) => rt.setGuestGain(peer.id, g)}
          />
        </span>
        <button
          aria-pressed={peer.muted}
          className={`rounded px-1.5 py-0.5 ${peer.muted ? "bg-destructive text-primary-foreground" : "bg-secondary hover:bg-accent"}`}
          onClick={() => rt.setGuestMuted(peer.id, !peer.muted)}
        >
          {peer.muted ? "M" : "🔈"}
        </button>
      </div>
      <div
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary"
        aria-hidden
      >
        <div
          ref={meter}
          className="h-full w-0 bg-speaker-b transition-[width] duration-75"
        />
      </div>
      {!onAir && (
        <p className="mt-1 text-[10px] text-muted-foreground">
          Kulisteki konuğun sesi yayına karışmaz.
        </p>
      )}
    </div>
  );
}
