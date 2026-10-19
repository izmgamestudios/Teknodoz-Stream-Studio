// src/components/prompter.tsx
import { useCallback, useEffect, useRef, useState } from "react";

import { useRemoteHost } from "@/classic/remote/host";
import type { Command } from "@/classic/remote/protocol";

export type Line = { speaker: "A" | "B"; text: string };

const PREFS_KEY = "prompter.prefs.v1";
type Prefs = {
  speed: number;
  font: number;
  mirror: boolean;
  flipText: boolean;
  dim: number;
  countdown: boolean;
  facing: "user" | "environment";
};
const DEFAULT_PREFS: Prefs = {
  speed: 40,
  font: 36,
  mirror: true,
  flipText: false,
  dim: 0.55,
  countdown: true,
  facing: "user",
};

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw
      ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) }
      : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

const mmss = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

export function Prompter({
  lines,
  nameA,
  nameB,
  onExit,
}: {
  lines: Line[];
  nameA: string;
  nameB: string;
  onExit: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pipRef = useRef<HTMLVideoElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const screenRef = useRef<HTMLVideoElement>(null);
  const screenStream = useRef<MediaStream | null>(null);

  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [prefsReady, setPrefsReady] = useState(false);
  const { speed, font, mirror, flipText, dim, countdown, facing } = prefs;
  const setPref = <K extends keyof Prefs>(k: K, v: Prefs[K]) =>
    setPrefs((p) => ({ ...p, [k]: v }));

  const [camErr, setCamErr] = useState("");
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const [count, setCount] = useState(0);
  const [sharing, setSharing] = useState(false);
  const [panel, setPanel] = useState(false);
  const [active, setActive] = useState(0);
  const [progress, setProgress] = useState(0);
  const { register, publish } = useRemoteHost();

  useEffect(() => {
    setPrefs(loadPrefs());
    setPrefsReady(true);
  }, []);
  useEffect(() => {
    if (!prefsReady) return;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* storage blocked */
    }
  }, [prefs, prefsReady]);

  // camera (re-opened when front/back changes)
  useEffect(() => {
    let dead = false;
    setCamErr("");
    navigator.mediaDevices
      ?.getUserMedia({
        video: { facingMode: facing, width: 1280, height: 720 },
        audio: true,
      })
      .then((s) => {
        if (dead) return s.getTracks().forEach((t) => t.stop());
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = s;
        if (videoRef.current) videoRef.current.srcObject = s;
        if (pipRef.current) pipRef.current.srcObject = s;
      })
      .catch(() =>
        setCamErr("Kameraya erişilemedi. Tarayıcı izinlerini kontrol edin."),
      );
    return () => {
      dead = true;
    };
  }, [facing]);
  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      screenStream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  // keep the screen on (phones) while the prompter is open
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    void navigator.wakeLock
      ?.request("screen")
      .then((l) => {
        lock = l;
      })
      .catch(() => {});
    return () => {
      void lock?.release();
    };
  }, []);

  // auto scroll
  useEffect(() => {
    if (!playing) return;
    let raf = 0,
      last = performance.now(),
      acc = 0;
    const tick = (now: number) => {
      const el = scrollRef.current;
      if (el) {
        acc += ((now - last) / 1000) * speed;
        const px = Math.floor(acc);
        if (px) {
          el.scrollTop += px;
          acc -= px;
        }
        const end = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
        if (end) setPlaying(false);
      }
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed]);

  // active line (the one at the reading guide) + progress
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const guide = el.getBoundingClientRect().top + el.clientHeight * 0.3;
    let best = 0,
      bestD = Infinity;
    lineRefs.current.forEach((n, i) => {
      if (!n) return;
      const r = n.getBoundingClientRect();
      const d = Math.abs((r.top + r.bottom) / 2 - guide);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setActive(best);
    const max = el.scrollHeight - el.clientHeight;
    setProgress(max > 0 ? Math.round((el.scrollTop / max) * 100) : 0);
  }, []);
  useEffect(onScroll, [onScroll, font, lines]);

  useEffect(() => {
    if (!recording) return;
    setRecSecs(0);
    const id = setInterval(() => setRecSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

  function restart() {
    const el = scrollRef.current;
    if (el) el.scrollTop = 0;
  }

  async function toggleShare() {
    if (sharing) {
      screenStream.current?.getTracks().forEach((t) => t.stop());
      screenStream.current = null;
      setSharing(false);
      return;
    }
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      screenStream.current = s;
      const vt = s.getVideoTracks()[0];
      if (vt)
        vt.onended = () => {
          screenStream.current = null;
          setSharing(false);
        };
      setSharing(true);
      setTimeout(() => {
        if (screenRef.current) screenRef.current.srcObject = s;
      });
    } catch {
      /* user cancelled */
    }
  }

  function startRecording() {
    if (!streamRef.current) return;
    const chunks: Blob[] = [];
    let recStream: MediaStream = streamRef.current;
    if (screenStream.current) {
      // compose screen + camera bubble on a canvas
      const c = document.createElement("canvas");
      c.width = 1920;
      c.height = 1080;
      const ctx = c.getContext("2d")!;
      const draw = () => {
        if (screenRef.current)
          ctx.drawImage(screenRef.current, 0, 0, 1920, 1080);
        if (videoRef.current)
          ctx.drawImage(videoRef.current, 1920 - 500, 1080 - 300, 460, 260);
        if (recRef.current?.state === "recording") requestAnimationFrame(draw);
      };
      recStream = new MediaStream([
        ...c.captureStream(30).getVideoTracks(),
        ...streamRef.current.getAudioTracks(),
      ]);
      setTimeout(draw, 50);
    }
    const r = new MediaRecorder(recStream);
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob(chunks, { type: r.mimeType }));
      a.download = `podcast-${Date.now()}.webm`;
      a.click();
      setRecording(false);
    };
    r.start(1000);
    recRef.current = r;
    setRecording(true);
    setPlaying(true);
  }

  const toggleRec = useCallback(() => {
    if (recRef.current?.state === "recording") {
      recRef.current.stop();
      return;
    }
    if (count > 0 || !streamRef.current) return;
    if (!countdown) return startRecording();
    setCount(3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, countdown]);

  useEffect(() => {
    if (count <= 0) return;
    const id = setTimeout(() => {
      if (count === 1) startRecording();
      setCount((c) => c - 1);
    }, 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  // phone remote
  const cmdRef = useRef<(c: Command) => void>(() => {});
  cmdRef.current = (c) => {
    const n = Number(c.arg);
    switch (c.cmd) {
      case "play":
        return setPlaying((p) => !p);
      case "speed":
        return setPrefs((p) => ({
          ...p,
          speed: Math.min(300, Math.max(0, p.speed + n)),
        }));
      case "font":
        return setPrefs((p) => ({
          ...p,
          font: Math.min(80, Math.max(20, p.font + n)),
        }));
      case "restart":
        return restart();
      case "mirror":
        return setPrefs((p) => ({ ...p, mirror: !p.mirror }));
      case "rec":
        return toggleRec();
    }
  };
  useEffect(() => register((c) => cmdRef.current(c)), [register]);
  useEffect(() => {
    publish({
      page: "prompter",
      playing,
      speed,
      font,
      mirror,
      recording,
      recSecs,
      progress,
    });
  }, [publish, playing, speed, font, mirror, recording, recSecs, progress]);
  useEffect(() => () => publish({ page: "idle" }), [publish]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT") return;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
      if (e.key === "ArrowUp") setPref("speed", Math.min(300, speed + 10));
      if (e.key === "ArrowDown") setPref("speed", Math.max(0, speed - 10));
      if (e.key === "+" || e.key === "=")
        setPref("font", Math.min(80, font + 4));
      if (e.key === "-") setPref("font", Math.max(20, font - 4));
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onExit, speed, font]);

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const flip = (mirror ? "scaleX(-1)" : "") || undefined;
  const textFlip = flipText ? "scaleX(-1)" : undefined;
  const chip =
    "min-h-11 rounded-lg bg-secondary px-3 py-2 text-sm hover:bg-accent";

  return (
    <div className="fixed inset-0 z-50 bg-background">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="absolute inset-0 h-full w-full object-cover"
        style={{ transform: flip }}
      />
      {sharing && (
        <>
          <video
            ref={screenRef}
            autoPlay
            muted
            playsInline
            className="absolute inset-0 h-full w-full bg-background object-contain"
          />
          <div className="absolute bottom-28 right-3 z-30 h-28 w-48 overflow-hidden rounded-xl border-2 border-speaker-a sm:h-36 sm:w-64">
            <video
              ref={pipRef}
              autoPlay
              muted
              playsInline
              className="h-full w-full object-cover"
              style={{ transform: flip }}
            />
          </div>
        </>
      )}
      <div
        className="absolute inset-0 bg-background"
        style={{ opacity: dim }}
      />
      {camErr && (
        <p className="absolute left-1/2 top-16 z-40 w-[90%] max-w-md -translate-x-1/2 rounded-md bg-destructive px-4 py-2 text-center text-sm text-primary-foreground">
          {camErr}
        </p>
      )}

      {/* progress + status */}
      <div className="absolute inset-x-0 top-0 z-20 pt-[env(safe-area-inset-top)]">
        <div className="h-1 bg-secondary/60">
          <div
            className="h-full bg-speaker-b transition-[width]"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex items-center justify-between px-3 py-2 text-xs">
          <button
            onClick={onExit}
            className="rounded-md bg-card/80 px-3 py-2 text-sm backdrop-blur"
            aria-label="Metne dön"
          >
            ← Metin
          </button>
          <span className="flex items-center gap-2">
            {recording && (
              <span className="flex items-center gap-1 rounded-md bg-destructive px-2 py-1 font-bold text-primary-foreground">
                <span className="size-2 animate-pulse rounded-full bg-white" />
                REC {mmss(recSecs)}
              </span>
            )}
            <span className="rounded-md bg-card/80 px-2 py-1 backdrop-blur">
              %{progress}
            </span>
            <button
              onClick={fullscreen}
              className="rounded-md bg-card/80 px-3 py-2 text-sm backdrop-blur"
              aria-label="Tam ekran"
            >
              ⛶
            </button>
          </span>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-[30%] z-10 h-px bg-ring/60" />

      <div
        ref={scrollRef}
        onScroll={onScroll}
        onClick={() => setPlaying((p) => !p)}
        className="absolute inset-0 overflow-y-auto px-4 sm:px-8 md:px-16 [scrollbar-width:none]"
        style={{
          paddingTop: "30vh",
          paddingBottom: "70vh",
          transform: textFlip,
        }}
      >
        <div className="mx-auto max-w-6xl space-y-6 sm:space-y-8">
          {lines.map((l, i) => (
            <div
              key={i}
              ref={(n) => {
                lineRefs.current[i] = n;
              }}
              className={`flex transition-opacity duration-300 ${l.speaker === "A" ? "justify-start" : "justify-end"} ${i === active ? "opacity-100" : "opacity-50"}`}
            >
              <div
                className={`max-w-[90%] sm:max-w-[75%] ${l.speaker === "A" ? "text-left" : "text-right"}`}
              >
                <p
                  className={`mb-1 text-xs font-bold uppercase tracking-widest sm:text-sm ${l.speaker === "A" ? "text-speaker-a" : "text-speaker-b"}`}
                >
                  {l.speaker === "A" ? nameA : nameB}
                </p>
                <p
                  className={`font-medium leading-snug ${l.speaker === "A" ? "text-speaker-a" : "text-speaker-b"}`}
                  style={{
                    fontSize: font,
                    textShadow: "0 2px 8px oklch(0 0 0 / 80%)",
                  }}
                >
                  {l.text}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {count > 0 && (
        <div
          className="absolute inset-0 z-40 grid place-items-center bg-background/60 backdrop-blur-sm"
          onClick={() => setCount(0)}
        >
          <span className="text-[30vw] font-black leading-none text-primary sm:text-[18vw]">
            {count}
          </span>
        </div>
      )}

      {/* settings sheet */}
      {panel && (
        <div className="absolute inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 mx-auto max-h-[55vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border bg-card/95 p-4 text-sm shadow-xl backdrop-blur">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center justify-between gap-3">
              Hız {speed}
              <input
                className="w-40"
                type="range"
                min={0}
                max={300}
                value={speed}
                onChange={(e) => setPref("speed", +e.target.value)}
              />
            </label>
            <label className="flex items-center justify-between gap-3">
              Yazı {font}
              <input
                className="w-40"
                type="range"
                min={20}
                max={80}
                value={font}
                onChange={(e) => setPref("font", +e.target.value)}
              />
            </label>
            <label className="flex items-center justify-between gap-3">
              Arka plan koyuluğu
              <input
                className="w-40"
                type="range"
                min={0}
                max={0.9}
                step={0.05}
                value={dim}
                onChange={(e) => setPref("dim", +e.target.value)}
              />
            </label>
            <label className="flex items-center justify-between gap-3">
              Geri sayım (3-2-1)
              <input
                type="checkbox"
                className="size-5"
                checked={countdown}
                onChange={(e) => setPref("countdown", e.target.checked)}
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => setPref("mirror", !mirror)} className={chip}>
              Kamera aynası: {mirror ? "Açık" : "Kapalı"}
            </button>
            <button
              onClick={() => setPref("flipText", !flipText)}
              className={chip}
            >
              Metni ters çevir ↔
            </button>
            <button
              onClick={() =>
                setPref("facing", facing === "user" ? "environment" : "user")
              }
              className={chip}
            >
              📷 {facing === "user" ? "Ön" : "Arka"} kamera
            </button>
            <button onClick={() => void toggleShare()} className={chip}>
              {sharing ? "Ekranı kapat" : "🖥 Ekran paylaş"}
            </button>
          </div>
          <p className="mt-3 hidden text-xs text-muted-foreground md:block">
            Boşluk: oynat · ↑↓: hız · +/−: yazı · Esc: çık · Ekrana dokun:
            oynat/durdur
          </p>
        </div>
      )}

      {/* dock */}
      <div className="absolute inset-x-0 bottom-0 z-30 flex items-center justify-center gap-2 bg-card/90 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur">
        <button
          onClick={() => setPanel((p) => !p)}
          aria-label="Ayarlar"
          aria-expanded={panel}
          className={chip}
        >
          ⚙
        </button>
        <button onClick={restart} aria-label="Başa dön" className={chip}>
          ⏮
        </button>
        <button
          onClick={() => setPlaying((p) => !p)}
          className="min-h-12 min-w-32 flex-1 rounded-lg bg-speaker-a px-4 font-bold text-background sm:flex-none"
        >
          {playing ? "❚❚ Durdur" : "▶ Kaydır"}
        </button>
        <button
          onClick={toggleRec}
          disabled={!!camErr}
          className={`min-h-12 rounded-lg px-4 font-bold text-primary-foreground disabled:opacity-40 ${recording ? "animate-pulse bg-destructive" : "bg-primary"}`}
        >
          {recording ? "■ Bitir" : "● Kaydet"}
        </button>
      </div>
    </div>
  );
}
