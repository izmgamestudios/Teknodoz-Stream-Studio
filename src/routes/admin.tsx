// src/routes/admin.tsx
// Admin hub: storage status (PocketBase / JSON), links to catalog + translations management and
// JSON backup / restore. Needs the CATALOG_ADMIN_TOKEN (kept in sessionStorage for this tab).
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { titleFromMatches } from "@/studio/branding/head";
import { useLang, useT } from "@/studio/i18n/use-t";
import { BTN, BTN_ACCENT, INPUT, PANEL, PanelTitle } from "@/studio/ui/fields";
import { AdminGate } from "@/studio/ui/admin-gate";
import { logoutAdmin } from "@/studio/watch/admin-session";

export const Route = createFileRoute("/admin")({
  head: ({ matches }) => ({
    meta: [
      { title: titleFromMatches(matches, "Admin") },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <AdminGate>
      <AdminPage />
    </AdminGate>
  ),
});

interface Status {
  storage: "pocketbase" | "file";
  healthy: boolean;
  counts: { catalog: number; overrides: number };
  checkedAt: string;
}

const auth = (token: string): HeadersInit =>
  token ? { authorization: `Bearer ${token}` } : {};

function AdminPage() {
  const t = useT();
  const lang = useLang();
  const token = "";
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const load = useCallback(async (tk: string) => {
    try {
      const res = await fetch("/api/admin/status", {
        headers: auth(tk),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(String(res.status));
      setStatus((await res.json()) as Status);
      setError(false);
    } catch {
      setStatus(null);
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load(token);
  }, [load]);

  const exportBackup = async () => {
    const res = await fetch("/api/admin/export", { headers: auth(token) });
    if (!res.ok) return setNote({ ok: false, text: t("admin.err.load") });
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `teknodoz-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const importBackup = async (f: File) => {
    if (!confirm(t("admin.import.confirm"))) return;
    try {
      const res = await fetch("/api/admin/import", {
        method: "POST",
        headers: { ...auth(token), "content-type": "application/json" },
        body: await f.text(),
      });
      const data = (await res.json()) as { catalog?: number; i18n?: number };
      if (!res.ok) throw new Error("bad");
      setNote({
        ok: true,
        text: t("admin.import.ok", { c: data.catalog ?? 0, t: data.i18n ?? 0 }),
      });
      await load(token);
    } catch {
      setNote({ ok: false, text: t("admin.import.err") });
    }
  };

  const when = status
    ? new Intl.DateTimeFormat(lang, {
        dateStyle: "medium",
        timeStyle: "medium",
      }).format(new Date(status.checkedAt))
    : "";

  return (
    <div className="min-h-screen p-3 md:p-6">
      <header className="mx-auto mb-4 max-w-4xl">
        <h1 className="text-3xl font-bold">{t("admin.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("admin.intro")}</p>
      </header>

      <div className="mx-auto max-w-4xl space-y-4">
        {!status ? (
          <section className={PANEL}>
            <p
              className={`text-sm ${error ? "text-destructive" : "text-muted-foreground"}`}
              role={error ? "alert" : undefined}
            >
              {error ? t("admin.err.load") : t("watch.loading")}
            </p>
          </section>
        ) : (
          status && (
            <>
              <section className={PANEL} aria-label={t("admin.status")}>
                <PanelTitle>{t("admin.status")}</PanelTitle>
                <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {t("admin.storage")}
                    </dt>
                    <dd className="font-semibold">
                      {status.storage === "pocketbase"
                        ? t("admin.storage.pocketbase")
                        : t("admin.storage.file")}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {t("admin.status")}
                    </dt>
                    <dd
                      className={`font-semibold ${status.healthy ? "" : "text-destructive"}`}
                    >
                      {status.healthy ? "● " : "○ "}
                      {status.healthy
                        ? t("admin.healthy")
                        : t("admin.unhealthy")}
                    </dd>
                  </div>
                  <div>
                    {t("admin.count.catalog", { n: status.counts.catalog })}
                  </div>
                  <div>
                    {t("admin.count.i18n", { n: status.counts.overrides })}
                  </div>
                </dl>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button className={BTN} onClick={() => void load(token)}>
                    ↻ {t("admin.refresh")}
                  </button>
                  <button className={BTN} onClick={() => void logoutAdmin()}>
                    {t("admin.logout")}
                  </button>
                  <span className="text-xs text-muted-foreground">
                    {t("admin.checked", { time: when })}
                  </span>
                </div>
              </section>

              <section className={`${PANEL} flex flex-wrap gap-2`}>
                <Link to="/catalog" className={BTN_ACCENT}>
                  🗂️ {t("admin.go.catalog")}
                </Link>
                <Link to="/translations" className={BTN_ACCENT}>
                  🌐 {t("admin.go.translations")}
                </Link>
                <Link to="/library" className={BTN_ACCENT}>
                  🎬 {t("admin.go.library")}
                </Link>
                <Link to="/watch" className={BTN}>
                  📺 {t("admin.go.watch")}
                </Link>
              </section>

              <section className={PANEL} aria-label={t("admin.backup")}>
                <PanelTitle>{t("admin.backup")}</PanelTitle>
                <p className="mb-3 text-xs text-muted-foreground">
                  {t("admin.backup.body")}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    className={BTN_ACCENT}
                    onClick={() => void exportBackup()}
                  >
                    ⬇ {t("admin.export")}
                  </button>
                  <button className={BTN} onClick={() => file.current?.click()}>
                    ⬆ {t("admin.import")}
                  </button>
                  <input
                    ref={file}
                    type="file"
                    accept="application/json,.json"
                    className="sr-only"
                    aria-label={t("admin.import")}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void importBackup(f);
                    }}
                  />
                  {note && (
                    <span
                      role={note.ok ? "status" : "alert"}
                      className={`text-sm ${note.ok ? "text-muted-foreground" : "text-destructive"}`}
                    >
                      {note.text}
                    </span>
                  )}
                </div>
              </section>

              {status.storage === "pocketbase" && (
                <section className={PANEL} aria-label={t("admin.pb")}>
                  <PanelTitle>{t("admin.pb")}</PanelTitle>
                  <p className="text-xs text-muted-foreground">
                    {t("admin.pb.body")}
                  </p>
                </section>
              )}
            </>
          )
        )}
      </div>
    </div>
  );
}
