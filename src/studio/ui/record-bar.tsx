// src/studio/ui/record-bar.tsx
// Record / marker controls with a live timer and chapter list.
import { useEffect, useState } from "react";

import { useRuntimeSnapshot, useStudio } from "../runtime/use-studio";
import { BTN, BTN_PRIMARY, formatMs, PANEL } from "./fields";

const ERROR_TEXT: Record<string, string> = {
  unsupported: "Bu tarayıcı kaydı desteklemiyor (MediaRecorder yok).",
  "record-failed": "Kayıt başlatılamadı.",
};

export function RecordBar() {
  const rt = useStudio();
  const snap = useRuntimeSnapshot();
  const rec = snap.recorder;
  const live = rec?.status === "recording" || rec?.status === "paused";
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(
      () => setNow(rt.getRecordingElapsedMs()),
      250,
    );
    return () => window.clearInterval(id);
  }, [live, rt]);

  const markers = rec?.markers ?? [];

  return (
    <section className={PANEL} aria-label="Kayıt">
      <div className="flex flex-wrap items-center gap-2">
        <button
          className={
            live
              ? "inline-flex animate-pulse items-center gap-1.5 rounded-md bg-destructive px-4 py-2 text-sm font-bold text-primary-foreground"
              : BTN_PRIMARY
          }
          disabled={rec?.status === "stopping"}
          onClick={() => rt.toggleRecording()}
          title="Kaydı başlat/bitir (Shift+R)"
        >
          {live
            ? "■ Kaydı bitir"
            : snap.countdown > 0
              ? `${snap.countdown}… iptal`
              : "● Kayda başla"}
        </button>
        {!live && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Geri sayım
            <select
              className="rounded-md border bg-background px-1.5 py-1 text-xs text-foreground"
              value={rt.getCountdownSec()}
              onChange={(e) => rt.setCountdownSec(Number(e.target.value))}
              aria-label="Kayıt öncesi geri sayım"
            >
              {[0, 3, 5, 10].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? "Yok" : `${n} sn`}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="font-mono text-sm tabular-nums" aria-live="off">
          {formatMs(live ? now : 0)}
        </span>
        <button
          className={BTN}
          disabled={!live}
          onClick={() => rt.addMarker()}
          title="Bölüm işareti ekle (M)"
        >
          🔖 İşaret{" "}
          <kbd className="ml-1 rounded border px-1 text-[10px]">M</kbd>
        </button>
        {live && rec && (
          <span className="text-xs text-muted-foreground">
            {(rec.bytes / 1024 / 1024).toFixed(1)} MB · {rec.ext?.toUpperCase()}
          </span>
        )}
      </div>
      {snap.recorderWarning && (
        <p role="alert" className="mt-2 text-xs text-primary">
          {snap.recorderWarning.message}
        </p>
      )}
      {snap.error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {ERROR_TEXT[snap.error] ?? "Kayıt hatası."}
        </p>
      )}
      {markers.length > 0 && (
        <ol className="mt-2 flex flex-wrap gap-1.5 text-xs">
          {markers.map((m, i) => (
            <li
              key={`${m.t}-${i}`}
              className="rounded bg-secondary px-1.5 py-0.5 font-mono"
            >
              {formatMs(m.t)} · {m.label}
            </li>
          ))}
        </ol>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        Kayıt bitince video, YouTube uyumlu <code>chapters.txt</code> ve{" "}
        <code>.srt</code> dosyalarıyla birlikte iner.
      </p>
    </section>
  );
}
