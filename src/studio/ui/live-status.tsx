// src/studio/ui/live-status.tsx
// Live status card: state, uptime, throughput and health warnings of the running broadcast.
import { useEffect, useState } from "react";

import { describeFailure } from "../live/messages";
import type { LiveSnapshot } from "../live/streamer";
import { formatMs, PANEL, PanelTitle } from "./fields";

function mb(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export function LiveStatusCard({ snap }: { snap: LiveSnapshot }) {
  const { phase, session, error } = snap;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (phase !== "live" && phase !== "starting") return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  if (phase === "idle") return null;
  const p = session?.progress;
  const uptime = session
    ? phase === "live" || phase === "starting"
      ? Math.max(0, now - session.startedAt)
      : session.uptimeMs
    : 0;
  const warnings: string[] = [];
  if (phase === "live" && p && p.frame > 0) {
    if (p.speed > 0 && p.speed < 0.93)
      warnings.push(
        `Sunucu CPU'su yetişemiyor (hız ${p.speed.toFixed(2)}×). Daha düşük kalite seçin.`,
      );
    if (p.dropped > 0) warnings.push(`${p.dropped} kare atlandı.`);
  }
  if (phase === "live" && snap.backlog >= 5)
    warnings.push(
      `Yükleme ${snap.backlog} sn geride: bağlantınız bu kaliteye yetmiyor olabilir.`,
    );

  const label =
    phase === "live"
      ? "● CANLI"
      : phase === "starting"
        ? "Başlatılıyor…"
        : phase === "stopping"
          ? "Durduruluyor…"
          : phase === "ended"
            ? "Yayın bitti"
            : "Yayın kesildi";

  return (
    <section className={PANEL} aria-label="Yayın durumu" aria-live="polite">
      <PanelTitle
        aside={
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
              phase === "live"
                ? "animate-pulse bg-destructive text-primary-foreground"
                : phase === "error"
                  ? "bg-destructive/20 text-destructive"
                  : "bg-secondary text-muted-foreground"
            }`}
          >
            {label}
          </span>
        }
      >
        Durum
      </PanelTitle>

      {session && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-[11px] text-muted-foreground">Süre</dt>
            <dd className="font-mono">{formatMs(uptime)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted-foreground">Yüklenen</dt>
            <dd className="font-mono">{mb(snap.bytesSent)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted-foreground">Çıkış</dt>
            <dd className="font-mono">
              {p && p.frame > 0
                ? `${p.fps.toFixed(0)} fps · ${p.bitrateKbps.toFixed(0)} kbps`
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted-foreground">Sunucu hızı</dt>
            <dd className="font-mono">
              {p && p.speed > 0 ? `${p.speed.toFixed(2)}×` : "—"}
            </dd>
          </div>
        </dl>
      )}

      {session && session.destinations.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
          {session.destinations.map((d) => (
            <li
              key={d.host + d.label}
              className="rounded-full border px-2 py-0.5"
            >
              {d.secure ? "🔒" : "⚠"} {d.label || d.host} · {d.host}
            </li>
          ))}
        </ul>
      )}

      {warnings.map((w) => (
        <p key={w} className="mt-2 text-xs text-primary">
          ⚠ {w}
        </p>
      ))}
      {error && (
        <div
          role="alert"
          className="mt-2 space-y-1 rounded-md border border-destructive/40 p-2 text-xs text-destructive"
        >
          <p>{describeFailure(error)}</p>
          {error.tail && error.tail.length > 0 && (
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-muted-foreground">
              {error.tail.join("\n")}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}
