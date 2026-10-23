// src/studio/ui/podcast/seats.tsx
// The two participant screens of a podcast room: the guest seat (mute button + own script) and
// the listener seat (play button). Both are deliberately tiny.
import { useEffect, useRef, useState } from "react";

import { useT } from "../../i18n/use-t";
import type { StudioClient } from "../../p2p";
import { DEFAULT_PROMPTER } from "../../podcast/prompter";
import type { PodcastPrompter } from "../../types";
import { BTN, BTN_ACCENT } from "../fields";
import { useClientStatus } from "../guest-views";
import type { GuestMic } from "./guest-mic";
import { PrompterView } from "./prompter-view";

function useLevel(stream: MediaStream | null) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!stream) return;
    const ctx = new AudioContext();
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.fftSize);
    let raf = 0;
    const tick = () => {
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      const lvl = Math.min(1, Math.sqrt(sum / buf.length) * 3.2);
      if (bar.current) bar.current.style.width = `${Math.round(lvl * 100)}%`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      void ctx.close().catch(() => undefined);
    };
  }, [stream]);
  return bar;
}

export function PodcastGuestSeat({
  client,
  mic,
  name,
}: {
  client: StudioClient;
  mic: GuestMic;
  name: string;
}) {
  const t = useT();
  const status = useClientStatus(client);
  const [muted, setMuted] = useState(false);
  const [locked, setLocked] = useState(client.isHostMuted);
  const [prompter, setPrompter] = useState<PodcastPrompter>(DEFAULT_PROMPTER);
  const [err, setErr] = useState("");
  const bar = useLevel(mic.stream);
  const audioTrack = mic.stream.getAudioTracks()[0] ?? null;

  useEffect(() => {
    let off = false;
    client.startGuest(mic.stream, name).catch(() => {
      if (!off) setErr(t("pod.guest.err.send"));
    });
    const stopP = client.onPrompter(setPrompter);
    const stopM = client.onHostMute((m) => {
      setLocked(m);
      if (m) {
        setMuted(true);
        if (audioTrack) audioTrack.enabled = false;
      }
    });
    return () => {
      off = true;
      stopP();
      stopM();
    };
    // joins once per mounted seat
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, mic]);

  function toggle() {
    if (locked) return;
    const next = !muted;
    setMuted(next);
    if (audioTrack) audioTrack.enabled = !next;
    client.sendMic(next);
  }

  const live = status === "on-air";
  return (
    <section className="space-y-4" aria-live="polite" data-status={status}>
      <p className="flex items-center gap-2 font-semibold" role="status">
        <span
          className={`inline-block size-2 rounded-full ${live ? "bg-red-500" : "animate-pulse bg-speaker-b"}`}
        />
        {live ? t("pod.guest.live") : t("pod.guest.waiting")}
      </p>
      <button
        type="button"
        data-testid="mute-toggle"
        onClick={toggle}
        disabled={locked}
        aria-pressed={muted}
        className={`${muted ? BTN : BTN_ACCENT} w-full py-6 text-xl`}
      >
        {muted ? "🔇" : "🎙️"} {muted ? t("pod.mic.unmute") : t("pod.mic.mute")}
      </button>
      {locked && (
        <p className="text-sm text-primary" role="alert">
          {t("pod.hostLocked")}
        </p>
      )}
      <div
        className="h-2 overflow-hidden rounded-full bg-secondary"
        aria-hidden
      >
        <div ref={bar} className="h-full w-0 bg-speaker-b" />
      </div>
      <p className="text-xs text-muted-foreground">
        {t(mic.summary)} · {t("pod.guest.headphones")}
      </p>
      {err && (
        <p role="alert" className="text-sm text-destructive">
          {err}
        </p>
      )}
      <PrompterView
        state={prompter}
        empty={t("pod.prompter.empty")}
        className="h-[45vh]"
      />
    </section>
  );
}

export function PodcastListenerSeat({ client }: { client: StudioClient }) {
  const t = useT();
  const status = useClientStatus(client);
  const audio = useRef<HTMLAudioElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(client.stream);
  const [blocked, setBlocked] = useState(false);
  const [vol, setVol] = useState(1);

  useEffect(() => client.onStream(setStream), [client]);
  useEffect(() => {
    const a = audio.current;
    if (!a || !stream) return;
    a.srcObject = stream;
    a.play().then(
      () => setBlocked(false),
      () => setBlocked(true),
    );
  }, [stream]);
  useEffect(() => {
    if (audio.current) audio.current.volume = vol;
  }, [vol]);

  const hasAudio = Boolean(stream);
  return (
    <section className="space-y-4" aria-live="polite">
      <p className="flex items-center gap-2 font-semibold" role="status">
        <span
          className={`inline-block size-2 rounded-full ${hasAudio && !blocked ? "bg-red-500" : "animate-pulse bg-speaker-b"}`}
        />
        {hasAudio && !blocked
          ? t("pod.listen.live")
          : status === "disconnected"
            ? t("view.status.disconnected")
            : t("pod.listen.waiting")}
      </p>
      <audio ref={audio} autoPlay playsInline />
      {blocked && (
        <button
          type="button"
          className={`${BTN_ACCENT} w-full py-6 text-xl`}
          onClick={() => {
            void audio.current?.play().then(() => setBlocked(false));
          }}
        >
          ▶ {t("pod.listen.play")}
        </button>
      )}
      <label className="block text-xs text-muted-foreground">
        {t("pod.listen.volume")}
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={vol}
          onChange={(e) => setVol(Number(e.target.value))}
          className="mt-1 w-full"
        />
      </label>
    </section>
  );
}
