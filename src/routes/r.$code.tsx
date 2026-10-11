// src/routes/r.$code.tsx
// Short invite link: https://<host>/r/K7M2QX[?as=guest|viewer|remote]
// The participant only enters a name; the studio operator approves from the waiting pool and the
// WebRTC handshake runs automatically through the relay (no codes to copy or paste).
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useSyncExternalStore } from "react";

import type { MessageKey } from "@/studio/i18n/messages";
import { useT } from "@/studio/i18n/use-t";
import type { RoomRole } from "@/studio/room/api";
import {
  RoomGuestSession,
  type GuestSnapshot,
} from "@/studio/room/guest-session";
import { ParticipantChat } from "@/studio/ui/chat-panels";
import { CreditsFooter } from "@/studio/ui/credits";
import { BTN, BTN_ACCENT, INPUT } from "@/studio/ui/fields";
import { RemoteView, ViewerGuestView } from "@/studio/ui/guest-views";
import { titleFromMatches } from "@/studio/branding/head";

export const Route = createFileRoute("/r/$code")({
  validateSearch: (s: Record<string, unknown>): { as?: RoomRole } =>
    s["as"] === "guest" ||
    s["as"] === "viewer" ||
    s["as"] === "remote" ||
    s["as"] === "chat"
      ? { as: s["as"] }
      : {},
  head: ({ matches }) => ({
    meta: [
      { title: titleFromMatches(matches) },
      { name: "robots", content: "noindex" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: RoomLanding,
});

const ROLES: { role: RoomRole; icon: string }[] = [
  { role: "guest", icon: "🎥" },
  { role: "viewer", icon: "👀" },
  { role: "remote", icon: "📱" },
  { role: "chat", icon: "💬" },
];

const IDLE: GuestSnapshot = {
  phase: "idle",
  hostOnline: true,
  error: null,
  name: "",
  role: null,
  client: null,
};
const noopSubscribe = () => () => undefined;

const KNOWN_ERRORS = new Set([
  "rate-limited",
  "full",
  "closed",
  "not-found",
  "forbidden",
  "network",
]);

type Check = "checking" | "ok" | "missing" | "closed" | "unavailable";

function RoomLanding() {
  const t = useT();
  const { code } = Route.useParams();
  const search = Route.useSearch();
  const fixedRole = search.as;
  const [session, setSession] = useState<RoomGuestSession | null>(null);
  const [check, setCheck] = useState<Check>("checking");
  const [role, setRole] = useState<RoomRole>(fixedRole ?? "guest");
  const [name, setName] = useState("");
  const [stun, setStun] = useState(true);

  useEffect(() => {
    const s = new RoomGuestSession({ code, usePublicStun: stun });
    let off = false;
    setSession(s);
    void (async () => {
      if (await s.resume()) {
        if (!off) setCheck("ok");
        return;
      }
      const r = await s.check();
      if (!off) setCheck(r);
    })();
    const onHide = () => s.leave();
    window.addEventListener("pagehide", onHide);
    return () => {
      off = true;
      window.removeEventListener("pagehide", onHide);
      s.leave();
      s.dispose();
    };
    // `stun` is read when the offer arrives; changing it later must not recreate the session
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const snap = useSyncExternalStore(
    session ? session.subscribe : noopSubscribe,
    session ? session.getSnapshot : () => IDLE,
    () => IDLE,
  );

  const activeRole = fixedRole ?? role;
  const busy = snap.phase === "joining";
  const roleTitle = (r: RoomRole) => t(`room.role.${r}` as MessageKey);
  const showForm =
    check === "ok" &&
    (snap.phase === "idle" ||
      snap.phase === "error" ||
      snap.phase === "rejected" ||
      snap.phase === "closed" ||
      busy);
  const errorText = KNOWN_ERRORS.has(snap.error ?? "")
    ? t(`room.err.${snap.error}` as MessageKey)
    : t("room.err.default");

  return (
    <div className="mx-auto min-h-screen max-w-2xl space-y-4 p-4">
      <header className="pt-4">
        <p className="text-xs uppercase tracking-[0.3em] text-speaker-b">
          Teknodoz Studio
        </p>
        <h1 className="mt-1 text-2xl font-bold">{t("room.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("room.code")}{" "}
          <span className="font-mono font-bold tracking-widest text-foreground">
            {code.toUpperCase()}
          </span>
        </p>
      </header>

      {check === "checking" && (
        <p className="text-sm text-muted-foreground">{t("room.checking")}</p>
      )}
      {check === "missing" && <Notice>{t("room.missing")}</Notice>}
      {check === "closed" && <Notice>{t("room.closed")}</Notice>}
      {check === "unavailable" && (
        <Notice>
          {t("room.unavailable")} (
          <a className="underline" href="/join">
            /join
          </a>
          )
        </Notice>
      )}

      {showForm && (
        <form
          className="space-y-4 rounded-xl border bg-card p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void session?.join(name, activeRole);
          }}
        >
          {!fixedRole ? (
            <fieldset className="grid gap-2 sm:grid-cols-3">
              <legend className="mb-1 text-xs text-muted-foreground">
                {t("room.how")}
              </legend>
              {ROLES.map((r) => (
                <label
                  key={r.role}
                  className={`cursor-pointer rounded-lg border p-3 text-sm ${activeRole === r.role ? "border-speaker-b bg-speaker-b/10" : "hover:bg-accent"}`}
                >
                  <input
                    type="radio"
                    name="role"
                    className="sr-only"
                    checked={activeRole === r.role}
                    onChange={() => setRole(r.role)}
                  />
                  <span className="block font-semibold">
                    {r.icon} {roleTitle(r.role)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t(`room.role.${r.role}.hint` as MessageKey)}
                  </span>
                </label>
              ))}
            </fieldset>
          ) : (
            <p className="text-sm">
              {ROLES.find((r) => r.role === fixedRole)?.icon}{" "}
              {t("room.joinAs", { role: roleTitle(fixedRole) })}
            </p>
          )}
          <label className="block text-xs text-muted-foreground">
            {t("room.name")}
            <input
              className={`${INPUT} mt-1`}
              value={name}
              maxLength={40}
              autoComplete="name"
              onChange={(e) => setName(e.target.value)}
              placeholder={roleTitle(activeRole)}
            />
          </label>
          {!snap.hostOnline && (
            <p className="text-xs text-primary">{t("room.hostOffline")}</p>
          )}
          {snap.phase === "rejected" && <Notice>{t("room.rejected")}</Notice>}
          {snap.phase === "closed" && <Notice>{t("room.closedNow")}</Notice>}
          {snap.phase === "error" && <Notice>{errorText}</Notice>}
          <button
            className={BTN_ACCENT}
            type="submit"
            disabled={busy || !session}
          >
            {busy ? t("room.sending") : t("room.send")}
          </button>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">{t("room.advanced")}</summary>
            <label className="mt-2 flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={stun}
                onChange={(e) => setStun(e.target.checked)}
              />
              <span>{t("room.stun")}</span>
            </label>
          </details>
          <p className="text-[11px] text-muted-foreground">
            {t("room.privacy")}
          </p>
        </form>
      )}

      {snap.phase === "waiting" && (
        <div
          className="space-y-3 rounded-xl border bg-card p-4"
          role="status"
          aria-live="polite"
        >
          <p className="flex items-center gap-2 font-semibold">
            <span className="inline-block size-2 animate-pulse rounded-full bg-speaker-b" />
            {t("room.waiting")}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("room.waiting.body")}
          </p>
          {!snap.hostOnline && (
            <p className="text-xs text-primary">
              {t("room.hostOffline.short")}
            </p>
          )}
          <button
            className={BTN}
            onClick={() => {
              session?.leave();
              location.reload();
            }}
          >
            {t("room.giveUp")}
          </button>
        </div>
      )}

      {snap.phase === "chatting" && session && (
        <div className="space-y-3">
          <div
            className="rounded-xl border bg-card p-4"
            role="status"
            aria-live="polite"
          >
            <p className="flex items-center gap-2 font-semibold">
              <span className="inline-block size-2 rounded-full bg-speaker-b" />
              {t("room.chatting")}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("room.chatting.body")}
            </p>
          </div>
          <ParticipantChat chat={session.chat} />
        </div>
      )}

      {snap.phase === "connecting" && (
        <div className="rounded-xl border bg-card p-4" role="status">
          <p className="font-semibold">{t("room.connecting")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("room.connecting.body")}
          </p>
        </div>
      )}

      {snap.phase === "connected" &&
        snap.client &&
        (snap.role === "remote" ? (
          <RemoteView client={snap.client} />
        ) : (
          <>
            <ViewerGuestView client={snap.client} />
            {session && <ParticipantChat chat={session.chat} />}
          </>
        ))}

      <CreditsFooter className="border-t pt-3" />
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-md border border-destructive/40 p-3 text-sm text-destructive"
    >
      {children}
    </p>
  );
}
