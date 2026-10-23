// src/studio/ui/record-bar.tsx
// Record / marker controls with a live timer and chapter list.
import { useEffect, useState } from "react";

import { Link } from "@tanstack/react-router";

import { useT } from "../i18n/use-t";
import { useRuntimeSnapshot, useStudio } from "../runtime/use-studio";
import { useAdmin } from "../watch/admin-session";
import { uploadMedia } from "../watch/media-client";
import {
  BTN,
  BTN_ACCENT,
  BTN_PRIMARY,
  Check,
  formatMs,
  INPUT_AUTO,
  PANEL,
} from "./fields";

const AUTO_KEY = "studio.autoupload.v1";

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
      {!live && snap.lastRecording && <SendToLibrary />}
    </section>
  );
}

type UploadState =
  | { s: "idle" }
  | { s: "sending"; p: number }
  | { s: "done"; id: string }
  | {
      s: "error";
      key:
        | "rec.up.err.auth"
        | "rec.up.err.big"
        | "rec.up.err.type"
        | "rec.up.err.quota"
        | "rec.up.err.net";
    };

/** After a recording: send it to the server media library (database) for editing + publishing. */
function SendToLibrary() {
  const t = useT();
  const rt = useStudio();
  const snap = useRuntimeSnapshot();
  const last = snap.lastRecording;
  const [state, setState] = useState<UploadState>({ s: "idle" });
  const { admin } = useAdmin();
  const [auto, setAuto] = useState(false);

  useEffect(() => {
    try {
      setAuto(localStorage.getItem(AUTO_KEY) === "1");
    } catch {
      /* default off */
    }
  }, []);

  const send = async () => {
    const data = rt.getLastRecording();
    if (!data) return;
    setState({ s: "sending", p: 0 });
    // the admin session cookie authenticates the upload
    const r = await uploadMedia(
      "",
      data.blob,
      {
        title: data.name.replace(/\.[^.]+$/, ""),
        filename: data.name,
        origin: "studio",
        chapters: data.markers,
      },
      (p) => setState({ s: "sending", p }),
    );
    if (r.ok) {
      // the lossless audio of the same take goes up as its own (audio) library item
      if (data.wav)
        await uploadMedia("", data.wav.blob, {
          title: `${data.name.replace(/\.[^.]+$/, "")} (WAV)`,
          filename: data.wav.name,
          origin: "studio",
          chapters: data.markers,
        });
      setState({ s: "done", id: r.media.id });
    } else
      setState({
        s: "error",
        key:
          r.reason === "unauthorized"
            ? "rec.up.err.auth"
            : r.reason === "quota"
              ? "rec.up.err.quota"
              : r.reason === "too-large"
                ? "rec.up.err.big"
                : r.reason === "unsupported"
                  ? "rec.up.err.type"
                  : "rec.up.err.net",
      });
  };

  // automatic upload right after the recording ends (needs an admin session)
  const lastName = last?.name;
  useEffect(() => {
    if (auto && admin && lastName && state.s === "idle") void send();
    // only when a new recording appears
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastName, auto, admin]);

  if (!last) return null;
  return (
    <div className="mt-3 rounded-lg border border-dashed p-2 text-xs">
      <p className="font-semibold">
        ☁ {t("rec.up.title")} — {last.name} (
        {(last.size / 1024 / 1024).toFixed(1)} MB)
      </p>
      {last.wav && (
        <p className="mt-1 text-muted-foreground">
          🎧 {t("rec.up.wav")} {last.wav.name} (
          {(last.wav.size / 1024 / 1024).toFixed(1)} MB)
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {admin ? (
          <button
            className={BTN_ACCENT}
            disabled={state.s === "sending" || state.s === "done"}
            onClick={() => void send()}
          >
            {t("rec.up.send")}
          </button>
        ) : (
          <Link to="/admin" className={BTN_ACCENT}>
            🔒 {t("admin.login.link")}
          </Link>
        )}
        <Check
          checked={auto}
          onChange={(v) => {
            setAuto(v);
            try {
              localStorage.setItem(AUTO_KEY, v ? "1" : "0");
            } catch {
              /* not persisted */
            }
          }}
        >
          {t("rec.up.auto")}
        </Check>
        <button className={BTN} onClick={() => rt.clearLastRecording()}>
          {t("common.cancel")}
        </button>
      </div>
      {state.s === "sending" && (
        <div className="mt-2" role="status">
          <progress className="w-full" value={state.p} max={1} />
          <span>{Math.round(state.p * 100)} %</span>
        </div>
      )}
      {state.s === "done" && (
        <p className="mt-2" role="status">
          ✓ {t("rec.up.done")}{" "}
          <Link to="/admin/media" className="underline">
            {t("rec.up.open")}
          </Link>
        </p>
      )}
      {state.s === "error" && (
        <p role="alert" className="mt-2 text-destructive">
          {t(state.key)}
        </p>
      )}
    </div>
  );
}
