// src/studio/ui/guest-views.tsx
// What a connected participant sees: the program video (+ guest controls) or the phone remote.
// Shared by /join, /remote (manual codes) and /r/<code> (rooms).
import { useEffect, useRef, useState } from "react";

import type { MessageKey } from "../i18n/messages";
import { useT } from "../i18n/use-t";
import {
  createLevelMeter,
  isP2PError,
  levelToUnit,
  p2pErrorMessage,
  stopStream,
  testMedia,
  type ClientStatus,
  type StudioClient,
} from "../p2p";
import type { RemoteCommand, RemoteState } from "../types";
import { BTN, BTN_ACCENT, INPUT, formatMs } from "./fields";

export function useClientStatus(client: StudioClient | null): ClientStatus {
  const [status, setStatus] = useState<ClientStatus>(
    client?.status ?? "connecting",
  );
  useEffect(() => {
    if (!client) return;
    setStatus(client.status);
    return client.onStatus(setStatus);
  }, [client]);
  return status;
}

export function ViewerGuestView({ client }: { client: StudioClient }) {
  const t = useT();
  const status = useClientStatus(client);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(client.stream);
  const [needSound, setNeedSound] = useState(false);

  useEffect(() => client.onStream(setStream), [client]);

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
  }, [stream]);

  return (
    <section
      className="space-y-3 rounded-xl border bg-card p-4"
      aria-live="polite"
    >
      <p className="text-sm font-medium">
        {t(`view.status.${status}` as MessageKey)}
      </p>
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
          {t("view.sound")}
        </button>
      )}
      {client.role === "guest" && status !== "disconnected" && (
        <GuestControls client={client} status={status} />
      )}
    </section>
  );
}

function GuestControls({
  client,
  status,
}: {
  client: StudioClient;
  status: ClientStatus;
}) {
  const t = useT();
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
        isP2PError(e) ? p2pErrorMessage(e.code) : t("view.guest.err.media"),
      );
    }
  }

  async function join() {
    if (!stream) return;
    setErr("");
    try {
      await client.startGuest(stream, name);
    } catch (e) {
      setErr(
        isP2PError(e) ? p2pErrorMessage(e.code) : t("view.guest.err.send"),
      );
    }
  }

  return (
    <div className="space-y-3 border-t pt-3">
      <h2 className="text-sm font-semibold">{t("view.guest.title")}</h2>
      {!stream ? (
        <button className={BTN_ACCENT} onClick={() => void test()}>
          {t("view.guest.test")}
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
                {t("view.guest.name")}
                <input
                  className={`${INPUT} mt-1`}
                  value={name}
                  maxLength={40}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <div>
                <p className="mb-1 text-xs text-muted-foreground">
                  {t("view.guest.mic")}
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
                {t("view.guest.join")}
              </button>
            ) : (
              <button className={BTN} onClick={() => void client.leaveGuest()}>
                {t("view.guest.leave")}
              </button>
            )}
            <button
              className={BTN}
              onClick={() => {
                void client.leaveGuest().catch(() => undefined);
                setStream(null);
              }}
            >
              {t("view.guest.cameraOff")}
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

export function RemoteView({ client }: { client: StudioClient }) {
  const t = useT();
  const [state, setState] = useState<RemoteState | null>(client.remoteState);
  useEffect(() => client.onRemoteState(setState), [client]);

  const send = (cmd: RemoteCommand) => {
    try {
      client.sendCommand(cmd);
      navigator.vibrate?.(12);
    } catch {
      /* not connected yet */
    }
  };

  const big =
    "flex min-h-20 select-none items-center justify-center rounded-2xl text-lg font-bold active:scale-95 transition-transform touch-manipulation";

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-bold">{t("remote.heading")}</h2>
        <span
          className={`font-mono text-sm ${state?.recording ? "text-primary" : "text-muted-foreground"}`}
        >
          {state?.recording
            ? `● ${formatMs(state.recordingMs)}`
            : t("remote.ready")}
        </span>
      </header>

      {!state && (
        <p className="text-sm text-muted-foreground">{t("remote.waitState")}</p>
      )}

      <section
        aria-label={t("remote.scenes")}
        className="grid grid-cols-2 gap-2"
      >
        {(state?.scenes ?? []).slice(0, 9).map((s, i) => (
          <button
            key={s.id}
            className={`${big} ${s.id === state?.activeSceneId ? "bg-speaker-b text-background" : "bg-secondary"}`}
            onClick={() => send({ kind: "scene", id: s.id })}
          >
            <span className="mr-2 text-sm opacity-70">{i + 1}</span>
            <span className="truncate text-base">{s.name}</span>
          </button>
        ))}
      </section>

      <section
        aria-label={t("remote.prompter")}
        className="grid grid-cols-4 gap-2"
      >
        <button
          className={`${big} col-span-2 bg-speaker-a text-background`}
          onClick={() => send({ kind: "prompter", action: "toggle" })}
        >
          {state?.prompterPlaying ? t("remote.pause") : t("remote.play")}
        </button>
        <button
          className={`${big} bg-secondary`}
          aria-label={t("remote.slower")}
          onClick={() => send({ kind: "prompter", action: "speedDown" })}
        >
          −
        </button>
        <button
          className={`${big} bg-secondary`}
          aria-label={t("remote.faster")}
          onClick={() => send({ kind: "prompter", action: "speedUp" })}
        >
          +
        </button>
        <button
          className={`${big} col-span-2 bg-secondary text-base`}
          onClick={() => send({ kind: "prompter", action: "rewind" })}
        >
          {t("remote.rewind")}
        </button>
        <p className="col-span-2 self-center text-center text-sm text-muted-foreground">
          {t("remote.speed", { n: Math.round(state?.prompterSpeed ?? 0) })}
        </p>
      </section>

      <section
        aria-label={t("remote.recordGroup")}
        className="grid grid-cols-2 gap-2"
      >
        <button
          className={`${big} ${state?.recording ? "animate-pulse bg-destructive text-primary-foreground" : "bg-primary-solid text-primary-foreground"}`}
          onClick={() => send({ kind: "record", action: "toggle" })}
        >
          {state?.recording ? t("remote.stop") : t("remote.rec")}
        </button>
        <button
          className={`${big} bg-secondary`}
          disabled={!state?.recording}
          onClick={() => send({ kind: "marker" })}
        >
          {t("remote.marker")}
        </button>
        <button
          className={`${big} col-span-2 ${state?.micMuted ? "bg-destructive text-primary-foreground" : "bg-secondary"}`}
          aria-pressed={state?.micMuted ?? false}
          onClick={() => send({ kind: "mute" })}
        >
          {state?.micMuted ? t("remote.micOff") : t("remote.micOn")}
        </button>
      </section>
    </div>
  );
}
