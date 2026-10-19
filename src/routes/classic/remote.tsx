import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { useRemoteClient } from "@/classic/remote/client";
import {
  isRoomId,
  type PrompterState,
  type StudioState,
} from "@/classic/remote/protocol";

export const Route = createFileRoute("/classic/remote")({
  validateSearch: (s: Record<string, unknown>) => ({
    room: typeof s["room"] === "string" ? s["room"] : "",
  }),
  head: () => ({
    meta: [
      { title: "Telefon Kumandası — Teknodoz Studio" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Remote,
});

const buzz = () => {
  try {
    navigator.vibrate?.(15);
  } catch {
    /* unsupported */
  }
};
const mmss = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

function Remote() {
  const { room } = Route.useSearch();
  const valid = isRoomId(room);
  const {
    status,
    state,
    send,
    shareCamera,
    stopCamera,
    guestLive,
    guestErr,
    retry,
  } = useRemoteClient(valid ? room : null);
  const [name, setName] = useState("Telefon");

  // keep the phone awake while it is the remote
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

  const cmd = (c: string, arg?: string | number) => {
    buzz();
    send(arg === undefined ? { cmd: c } : { cmd: c, arg });
  };
  const btn =
    "min-h-14 rounded-xl bg-secondary px-3 py-3 text-base font-semibold active:scale-95 active:bg-accent";

  if (!valid) {
    return (
      <main className="grid min-h-screen place-items-center p-6 text-center">
        <div>
          <p className="text-5xl">📵</p>
          <h1 className="mt-3 text-xl font-bold">
            Geçersiz kumanda bağlantısı
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Bilgisayardaki Stüdyo veya Prompter ekranında “📱 Telefon kumandası”
            kutusundaki QR kodu okut.
          </p>
          <Link
            to="/"
            className="mt-4 inline-block rounded-lg bg-secondary px-4 py-2"
          >
            Ana sayfa
          </Link>
        </div>
      </main>
    );
  }

  const dot =
    status === "connected"
      ? "bg-speaker-b"
      : status === "connecting"
        ? "animate-pulse bg-speaker-a"
        : "bg-destructive";
  return (
    <main className="mx-auto max-w-md space-y-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">📱 Kumanda</h1>
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className={`size-2.5 rounded-full ${dot}`} />
          {status === "connected"
            ? "Bağlı"
            : status === "connecting"
              ? "Bağlanıyor…"
              : "Bağlantı yok"}
        </span>
      </header>

      {(status === "lost" || status === "error") && (
        <button
          onClick={retry}
          className="w-full rounded-xl bg-destructive py-3 font-bold text-primary-foreground"
        >
          Yeniden bağlan
        </button>
      )}

      {status === "connected" && state.page === "idle" && (
        <p className="rounded-xl border p-4 text-center text-sm text-muted-foreground">
          Bilgisayarda Stüdyo ya da Prompter sayfasını aç.
        </p>
      )}
      {state.page === "studio" && <StudioPad s={state} cmd={cmd} btn={btn} />}
      {state.page === "prompter" && (
        <PrompterPad s={state} cmd={cmd} btn={btn} />
      )}

      <section className="space-y-2 rounded-xl border bg-card p-3">
        <h2 className="font-semibold">📷 Telefon kamerası konuk olsun</h2>
        <p className="text-xs text-muted-foreground">
          İkinci kamera olarak stüdyoya gönderilir; bilgisayarda “kabul et”
          demen gerekir.
        </p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Konuk adı"
          className="w-full rounded-lg border bg-background px-3 py-2"
        />
        {guestLive ? (
          <button
            onClick={stopCamera}
            className={`${btn} w-full bg-destructive text-primary-foreground`}
          >
            Kamerayı kapat
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => void shareCamera(name, "user")}
              className={`${btn} flex-1`}
            >
              Ön kamera
            </button>
            <button
              onClick={() => void shareCamera(name, "environment")}
              className={`${btn} flex-1`}
            >
              Arka kamera
            </button>
          </div>
        )}
        {guestErr && <p className="text-sm text-destructive">{guestErr}</p>}
      </section>
    </main>
  );
}

type PadProps<S> = {
  s: S;
  cmd: (c: string, arg?: string | number) => void;
  btn: string;
};

function RecButton({
  recording,
  secs,
  cmd,
}: {
  recording: boolean;
  secs: number;
  cmd: PadProps<unknown>["cmd"];
}) {
  return (
    <button
      onClick={() => cmd("rec")}
      className={`min-h-16 w-full rounded-xl text-lg font-bold text-primary-foreground active:scale-95 ${recording ? "animate-pulse bg-destructive" : "bg-primary"}`}
    >
      {recording ? `■ Kaydı bitir · ${mmss(secs)}` : "● Kayda başla"}
    </button>
  );
}

function StudioPad({ s, cmd, btn }: PadProps<StudioState>) {
  return (
    <>
      <div className="grid grid-cols-[1fr_2fr] gap-2">
        <button onClick={() => cmd("prev")} className={btn}>
          ⏮ Önceki
        </button>
        <button
          onClick={() => cmd("next")}
          className={`${btn} bg-speaker-b text-background`}
        >
          ⏭ Sıradaki sahne
        </button>
      </div>
      <button
        onClick={() => cmd("golive")}
        className={`${btn} w-full ${s.isLive ? "" : "animate-pulse"}`}
      >
        Taslağı yayına al →
      </button>
      <RecButton recording={s.recording} secs={s.recSecs} cmd={cmd} />

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Sahneler
        </h2>
        {s.scenes.length === 0 && (
          <p className="text-sm text-muted-foreground">Rundown boş.</p>
        )}
        {s.scenes.map((n, i) => (
          <div
            key={i}
            className={`flex overflow-hidden rounded-xl border ${s.live === i ? "border-primary bg-primary/10" : "bg-card"}`}
          >
            <button
              onClick={() => cmd("scene", i)}
              className="min-h-14 flex-1 px-3 text-left font-semibold active:bg-accent"
            >
              {s.live === i && (
                <span className="mr-2 text-primary">● CANLI</span>
              )}
              {i + 1}. {n}
            </button>
            <button
              onClick={() => cmd("edit", i)}
              aria-label={`${n} sahnesini düzenle`}
              className="px-4 text-sm text-muted-foreground active:bg-accent"
            >
              ✎
            </button>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Ses efektleri
        </h2>
        <div className="grid grid-cols-3 gap-2">
          {s.sfx.map((f) => (
            <button
              key={f.id}
              onClick={() => cmd("sfx", f.id)}
              className="min-h-14 rounded-xl bg-speaker-a px-1 py-2 text-sm font-bold text-background active:scale-95"
            >
              <span className="block text-xl">{f.emoji}</span>
              {f.label}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">Müzik</h2>
        <div className="flex flex-wrap gap-2">
          {s.tracks.map((t) => (
            <button
              key={t.id}
              onClick={() => cmd("music", t.id)}
              className={`${btn} ${s.music === t.id ? "bg-speaker-b text-background" : ""}`}
            >
              ♪ {t.name}
            </button>
          ))}
          {s.music && (
            <button onClick={() => cmd("music", "stop")} className={btn}>
              ■ Durdur
            </button>
          )}
        </div>
      </section>
    </>
  );
}

function PrompterPad({ s, cmd, btn }: PadProps<PrompterState>) {
  return (
    <>
      <button
        onClick={() => cmd("play")}
        className="min-h-24 w-full rounded-2xl bg-speaker-a text-2xl font-bold text-background active:scale-95"
      >
        {s.playing ? "❚❚ Durdur" : "▶ Kaydır"}
      </button>
      <div className="h-2 overflow-hidden rounded bg-secondary">
        <div
          className="h-full bg-speaker-b"
          style={{ width: `${s.progress}%` }}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => cmd("speed", -10)} className={btn}>
          🐢 Yavaşla ({s.speed})
        </button>
        <button onClick={() => cmd("speed", 10)} className={btn}>
          🐇 Hızlan
        </button>
        <button onClick={() => cmd("font", -4)} className={btn}>
          A− Küçült ({s.font})
        </button>
        <button onClick={() => cmd("font", 4)} className={btn}>
          A+ Büyüt
        </button>
        <button onClick={() => cmd("restart")} className={btn}>
          ⏮ Başa dön
        </button>
        <button onClick={() => cmd("mirror")} className={btn}>
          Ayna: {s.mirror ? "Açık" : "Kapalı"}
        </button>
      </div>
      <RecButton recording={s.recording} secs={s.recSecs} cmd={cmd} />
    </>
  );
}
