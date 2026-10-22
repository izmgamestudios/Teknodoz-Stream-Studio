// src/studio/ui/library-picker.tsx
// "From the server library" picker used by the studios: lists the videos / audio files of the
// media library (admin only, like the library itself) and hands the chosen record back.
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { useT } from "../i18n/use-t";
import { useAdmin } from "../watch/admin-session";
import { listMedia, type MediaRecord } from "../watch/media-client";
import { fold } from "../watch/filter";
import { formatMs } from "./fields";

type Kind = "video" | "audio";

function fmtSize(n: number): string {
  if (n > 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n > 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function LibraryPicker({
  kinds,
  label,
  buttonClassName,
  onPick,
}: {
  kinds: readonly Kind[];
  label?: string;
  buttonClassName?: string;
  onPick: (m: MediaRecord) => void | Promise<void>;
}) {
  const t = useT();
  const { admin } = useAdmin();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<MediaRecord[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !admin) return;
    let live = true;
    setFailed(false);
    void listMedia("").then((l) => {
      if (!live) return;
      if (l) setItems(l);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [open, admin]);

  const shown = useMemo(() => {
    const k = fold(q);
    return (items ?? []).filter(
      (m) =>
        (kinds as readonly string[]).includes(m.kind) &&
        (!k || fold(m.title).includes(k)),
    );
  }, [items, kinds, q]);

  return (
    <span className="block w-full sm:inline sm:w-auto">
      <button
        type="button"
        className={
          buttonClassName ??
          "rounded bg-accent px-2 py-1 text-xs hover:brightness-110"
        }
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        ☁ {label ?? t("libpick.button")}
      </button>
      {open && (
        <div className="mt-2 space-y-2 rounded-lg border bg-card p-2 text-xs">
          {!admin ? (
            <p>
              <Link to="/admin" className="underline">
                🔒 {t("admin.login.link")}
              </Link>{" "}
              — {t("libpick.login")}
            </p>
          ) : failed ? (
            <p role="alert" className="text-destructive">
              {t("libpick.error")}
            </p>
          ) : items === null ? (
            <p role="status">{t("libpick.loading")}</p>
          ) : (
            <>
              <input
                type="search"
                className="w-full rounded-md border bg-background px-2 py-1"
                placeholder={t("libpick.search")}
                aria-label={t("libpick.search")}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              {shown.length === 0 ? (
                <p className="text-muted-foreground">{t("libpick.none")}</p>
              ) : (
                <ul className="max-h-52 space-y-1 overflow-y-auto">
                  {shown.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        disabled={busy !== null}
                        className="flex w-full items-center gap-2 rounded-md bg-secondary/60 px-2 py-1 text-left hover:bg-accent disabled:opacity-60"
                        onClick={async () => {
                          setBusy(m.id);
                          try {
                            await onPick(m);
                            setOpen(false);
                          } finally {
                            setBusy(null);
                          }
                        }}
                      >
                        <span aria-hidden>
                          {m.kind === "video" ? "🎬" : "🎵"}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {m.title}
                        </span>
                        <span className="shrink-0 text-muted-foreground">
                          {m.durationMs ? formatMs(m.durationMs) : ""} ·{" "}
                          {fmtSize(m.size)}
                        </span>
                        {busy === m.id && <span aria-hidden>…</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </span>
  );
}
