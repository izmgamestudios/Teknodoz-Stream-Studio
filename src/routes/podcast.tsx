// src/routes/podcast.tsx
// Podcast control room (admin): open an audio-only room, share the QR code, approve guests, run
// the guest script and a private admin note, record the mix.
import { createFileRoute } from "@tanstack/react-router";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { titleFromMatches } from "@/studio/branding/head";
import { useT } from "@/studio/i18n/use-t";
import { PodcastHost } from "@/studio/podcast/host";
import { SPEED_STEPS, stepSpeed, wordCount } from "@/studio/podcast/prompter";
import { AdminGate } from "@/studio/ui/admin-gate";
import {
  BTN,
  BTN_ACCENT,
  Check,
  formatMs,
  INPUT,
  PANEL,
  PanelTitle,
} from "@/studio/ui/fields";
import { PrompterView } from "@/studio/ui/podcast/prompter-view";
import { QrImage } from "@/studio/ui/qr-image";
import type { MessageKey } from "@/studio/i18n/messages";

export const Route = createFileRoute("/podcast")({
  head: ({ matches }) => ({
    meta: [
      { title: titleFromMatches(matches, "Podcast") },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <AdminGate>
      <PodcastPage />
    </AdminGate>
  ),
});

const NOTE_KEY = "tkz.podcast.note.v1";

function load(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function PodcastPage() {
  const t = useT();
  const host = useMemo(() => new PodcastHost(), []);
  useEffect(() => () => host.dispose(), [host]);
  const s = useSyncExternalStore(
    host.subscribe,
    host.getSnapshot,
    host.getSnapshot,
  );
  const [strong, setStrong] = useState(false);
  const [title, setTitle] = useState("");
  const [up, setUp] = useState<"idle" | "busy" | "done" | "fail">("idle");
  const [note, setNote] = useState(() => load(NOTE_KEY));
  const [copied, setCopied] = useState("");
  const [priv, setPriv] = useState<string | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    try {
      localStorage.setItem(NOTE_KEY, note);
    } catch {
      /* private mode */
    }
  }, [note]);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 120);
    return () => clearInterval(id);
  }, []);

  const guests = s.peers.filter((p) => p.role === "guest");
  const listeners = s.peers.filter((p) => p.role === "viewer").length;
  const waiting = s.room?.pool.filter((e) => e.state === "waiting") ?? [];
  const live = s.phase === "live";
  const p = s.guestPrompter;

  async function copy(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  if (!live)
    return (
      <div className="mx-auto max-w-md space-y-4 p-4">
        <h1 className="text-2xl font-bold">🎙️ {t("pod.title")}</h1>
        <div className={`${PANEL} space-y-3`}>
          <Check checked={strong} onChange={setStrong}>
            {t("pod.strong")}
          </Check>
          <button
            className={`${BTN_ACCENT} w-full py-4 text-lg`}
            disabled={s.phase === "starting"}
            onClick={() => void host.start({ strong })}
          >
            {s.phase === "starting" ? t("pod.starting") : t("pod.start")}
          </button>
          {s.phase === "error" && (
            <p role="alert" className="text-sm text-destructive">
              {t("pod.err.start")}
            </p>
          )}
        </div>
      </div>
    );

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">🎙️ {t("pod.title")}</h1>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">
          {s.voice ? t(`pod.voice.${s.voice}` as MessageKey) : ""}
        </span>
        <span className="text-xs text-muted-foreground">{s.micLabel}</span>
        <span className="ml-auto text-xs">
          {t("pod.listeners", { n: listeners })}
        </span>
        <button
          className={s.micMuted ? BTN : BTN_ACCENT}
          aria-pressed={s.micMuted}
          onClick={() => host.setMicMuted(!s.micMuted)}
        >
          {s.micMuted ? "🔇" : "🎙️"}{" "}
          {s.micMuted ? t("pod.mic.unmute") : t("pod.mic.mute")}
        </button>
        <button className={BTN} onClick={() => void host.stop()}>
          {t("pod.stop")}
        </button>
      </header>
      <Meter level={host.getLevel("host")} />

      <div className="grid gap-4 md:grid-cols-[260px_1fr]">
        <section className={`${PANEL} space-y-3`}>
          <PanelTitle>{t("pod.invite")}</PanelTitle>
          {s.links && (
            <>
              <QrImage text={s.links.guest} size={200} />
              {(
                [
                  ["guest", s.links.guest, "pod.invite.guest"],
                  ["listener", s.links.listener, "pod.invite.listener"],
                  ["remote", s.links.remote, "pod.invite.remote"],
                ] as const
              ).map(([id, url, label]) => (
                <div key={id} className="space-y-1">
                  <p className="text-xs text-muted-foreground">{t(label)}</p>
                  {id === "remote" && (
                    <p className="text-[11px] text-muted-foreground">
                      {t("pod.invite.remote.hint")}
                    </p>
                  )}
                  <input
                    readOnly
                    className={INPUT}
                    value={url}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <button className={BTN} onClick={() => void copy(url, id)}>
                    {copied === id ? t("pod.copied") : t("pod.copy")}
                  </button>
                </div>
              ))}
            </>
          )}
          <Check checked={s.autoOnAir} onChange={(v) => host.setAutoOnAir(v)}>
            {t("pod.autoOnAir")}
          </Check>
          <Check
            checked={Boolean(s.room?.autoApprove.guest)}
            onChange={(v) => host.setAutoApprove(v)}
          >
            {t("pod.autoApprove")}
          </Check>
        </section>

        <div className="space-y-4">
          {waiting.length > 0 && (
            <section className={`${PANEL} space-y-2`} data-testid="pod-waiting">
              <PanelTitle>
                {t("pod.waiting")} ({waiting.length})
              </PanelTitle>
              {waiting.map((e) => (
                <div key={e.guestId} className="flex items-center gap-2">
                  <span className="flex-1 truncate text-sm">
                    {e.name || "—"} ·{" "}
                    {e.role === "viewer"
                      ? "🎧"
                      : e.role === "remote"
                        ? "📱"
                        : "🎙️"}
                  </span>
                  <button
                    className={BTN_ACCENT}
                    onClick={() => void host.approve(e.guestId)}
                  >
                    {t("pod.approve")}
                  </button>
                  <button
                    className={BTN}
                    onClick={() => void host.reject(e.guestId)}
                  >
                    {t("pod.reject")}
                  </button>
                </div>
              ))}
              {waiting.length > 1 && (
                <button className={BTN} onClick={() => void host.approveAll()}>
                  {t("pod.approveAll")}
                </button>
              )}
            </section>
          )}

          <section className={`${PANEL} space-y-2`}>
            <div className="flex items-center gap-2">
              <PanelTitle>{t("pod.people")}</PanelTitle>
              {guests.length > 0 && (
                <span className="ml-auto flex gap-2">
                  <button className={BTN} onClick={() => host.muteAll(true)}>
                    {t("pod.muteAll")}
                  </button>
                  <button className={BTN} onClick={() => host.muteAll(false)}>
                    {t("pod.unmuteAll")}
                  </button>
                </span>
              )}
            </div>
            {guests.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {t("pod.people.none")}
              </p>
            )}
            {guests.map((g) => (
              <div
                key={g.id}
                className="space-y-1 rounded-md border p-2"
                data-testid="pod-guest"
              >
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate font-medium">
                    {g.name || "—"}
                    {g.micMuted ? " 🔇" : ""}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {g.status}
                  </span>
                  <button
                    className={BTN}
                    onClick={() => host.lockMute(g.id, !g.muted)}
                  >
                    {g.muted ? t("pod.unmuteGuest") : t("pod.muteGuest")}
                  </button>
                  <button
                    className={BTN}
                    onClick={() => setPriv(priv === g.id ? null : g.id)}
                    aria-expanded={priv === g.id}
                  >
                    📝
                  </button>
                  <button className={BTN} onClick={() => host.kick(g.id)}>
                    {t("pod.kick")}
                  </button>
                </div>
                <Meter level={host.getLevel(g.id)} />
                {priv === g.id && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      {t("pod.prompter.private")}
                    </p>
                    <textarea
                      className={`${INPUT} h-24`}
                      value={host.getGuestScript(g.id) ?? ""}
                      onChange={(e) =>
                        host.setGuestScript(g.id, e.target.value)
                      }
                    />
                    <button
                      className={BTN}
                      onClick={() => host.setGuestScript(g.id, null)}
                    >
                      {t("pod.prompter.private.clear")}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section
              className={`${PANEL} space-y-2`}
              aria-label={t("pod.prompter.guest")}
            >
              <PanelTitle>{t("pod.prompter.guest")}</PanelTitle>
              <p className="text-xs text-muted-foreground">
                {t("pod.prompter.guest.hint")}
              </p>
              <textarea
                className={`${INPUT} h-32`}
                data-testid="guest-script"
                value={p.text}
                placeholder={t("pod.prompter.placeholder")}
                onChange={(e) =>
                  host.setGuestPrompter({ text: e.target.value, pos: 0 })
                }
              />
              <p className="text-[11px] text-muted-foreground">
                {wordCount(p.text)} / 20000
              </p>
              <div className="flex flex-wrap gap-1">
                <button
                  className={p.playing ? BTN : BTN_ACCENT}
                  onClick={() => host.setGuestPrompter({ playing: !p.playing })}
                >
                  {p.playing
                    ? `⏸ ${t("pod.prompter.pause")}`
                    : `▶ ${t("pod.prompter.play")}`}
                </button>
                <button
                  className={BTN}
                  onClick={() =>
                    host.setGuestPrompter({ playing: false, pos: 0 })
                  }
                >
                  ⏮ {t("pod.prompter.rewind")}
                </button>
                <button
                  className={BTN}
                  aria-label={t("pod.prompter.slower")}
                  onClick={() =>
                    host.setGuestPrompter({ speed: stepSpeed(p.speed, -1) })
                  }
                >
                  🐢
                </button>
                <button
                  className={BTN}
                  aria-label={t("pod.prompter.faster")}
                  onClick={() =>
                    host.setGuestPrompter({ speed: stepSpeed(p.speed, 1) })
                  }
                >
                  🐇
                </button>
                <button
                  className={BTN}
                  aria-label={t("pod.prompter.smaller")}
                  onClick={() => host.setGuestPrompter({ size: p.size - 4 })}
                >
                  A−
                </button>
                <button
                  className={BTN}
                  aria-label={t("pod.prompter.bigger")}
                  onClick={() => host.setGuestPrompter({ size: p.size + 4 })}
                >
                  A+
                </button>
                <span className="self-center text-[11px] text-muted-foreground">
                  {p.speed}/{SPEED_STEPS[SPEED_STEPS.length - 1]}
                </span>
              </div>
              <PrompterView
                state={{ ...p, size: Math.min(p.size, 32) }}
                className="h-40"
                onPos={(r) => host.reportGuestPos(r)}
                onDone={() => host.setGuestPrompter({ playing: false })}
              />
            </section>

            <section
              className={`${PANEL} space-y-2`}
              aria-label={t("pod.prompter.admin")}
            >
              <PanelTitle>🔒 {t("pod.prompter.admin")}</PanelTitle>
              <p className="text-xs text-muted-foreground">
                {t("pod.prompter.admin.hint")}
              </p>
              <textarea
                className={`${INPUT} h-64`}
                data-testid="admin-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </section>
          </div>

          <RecordPanel
            host={host}
            title={title}
            setTitle={setTitle}
            up={up}
            onUpload={async () => {
              setUp("busy");
              try {
                const r = await host.uploadLast(title || "Podcast");
                setUp(r ? "done" : "fail");
              } catch {
                setUp("fail");
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}

function Meter({ level }: { level: number }) {
  return (
    <div
      className="h-1.5 overflow-hidden rounded-full bg-secondary"
      aria-hidden
    >
      <div
        className="h-full bg-speaker-b"
        style={{ width: `${Math.round(level * 100)}%` }}
      />
    </div>
  );
}

function RecordPanel({
  host,
  title,
  setTitle,
  up,
  onUpload,
}: {
  host: PodcastHost;
  title: string;
  setTitle: (v: string) => void;
  up: "idle" | "busy" | "done" | "fail";
  onUpload: () => void;
}) {
  const t = useT();
  const s = useSyncExternalStore(
    host.subscribe,
    host.getSnapshot,
    host.getSnapshot,
  );
  const started = s.recording.startedAt;
  const now = useRef(0);
  now.current = Date.now();
  return (
    <section className={`${PANEL} space-y-2`}>
      <div className="flex flex-wrap items-center gap-2">
        {s.recording.on ? (
          <>
            <button
              className={BTN_ACCENT}
              onClick={() => void host.stopRecording()}
            >
              ⏹ {t("pod.rec.stop")}
            </button>
            <button className={BTN} onClick={() => host.addMarker("")}>
              🔖 {t("pod.rec.marker")}
            </button>
            <span className="font-mono text-sm">
              {started ? formatMs(now.current - started) : ""}
            </span>
          </>
        ) : (
          <button className={BTN_ACCENT} onClick={() => host.startRecording()}>
            ⏺ {t("pod.rec.start")}
          </button>
        )}
      </div>
      {s.lastRecording && !s.recording.on && (
        <div className="space-y-2">
          <audio
            controls
            className="w-full"
            src={URL.createObjectURL(s.lastRecording.blob)}
          />
          <input
            className={INPUT}
            value={title}
            placeholder={t("pod.rec.title")}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button
            className={BTN_ACCENT}
            disabled={up === "busy"}
            onClick={onUpload}
          >
            {up === "busy" ? t("pod.rec.uploading") : t("pod.rec.upload")}
          </button>
          {up === "done" && <p className="text-sm">{t("pod.rec.done")}</p>}
          {up === "fail" && (
            <p className="text-sm text-destructive">{t("pod.rec.fail")}</p>
          )}
        </div>
      )}
    </section>
  );
}
