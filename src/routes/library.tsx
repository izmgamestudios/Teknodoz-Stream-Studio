// src/routes/library.tsx
// Media library (admin): recordings from the studio and uploaded files. Preview, rename, delete
// and publish to the watch page. Needs the admin token (sessionStorage, this tab only).
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { titleFromMatches } from "@/studio/branding/head";
import { useLang, useT } from "@/studio/i18n/use-t";
import {
  BTN,
  BTN_ACCENT,
  Check,
  formatMs,
  INPUT,
  INPUT_AUTO,
  PANEL,
  PanelTitle,
} from "@/studio/ui/fields";
import { EditPanel, SubtitlesPanel } from "@/studio/ui/watch/editor";
import { AdminGate } from "@/studio/ui/admin-gate";
import {
  adminDelete,
  adminList,
  adminSave,
  type AdminItem,
} from "@/studio/watch/catalog-client";
import {
  deleteMedia,
  listMedia,
  mediaUrl,
  renameMedia,
  uploadMedia,
  type MediaRecord,
} from "@/studio/watch/media-client";

export const Route = createFileRoute("/library")({
  head: ({ matches }) => ({
    meta: [
      { title: titleFromMatches(matches, "Library") },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <AdminGate>
      <LibraryPage />
    </AdminGate>
  ),
});

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

function LibraryPage() {
  const t = useT();
  const lang = useLang();
  const token = "";
  const [media, setMedia] = useState<MediaRecord[] | null>(null);
  const [catalog, setCatalog] = useState<AdminItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const load = useCallback(async (tk: string) => {
    const [m, c] = await Promise.all([listMedia(tk), adminList(tk)]);
    setMedia(m);
    setCatalog(c ?? []);
    return m !== null;
  }, []);

  useEffect(() => {
    void load(token);
  }, [load]);

  const current = useMemo(
    () => media?.find((m) => m.id === selected) ?? null,
    [media, selected],
  );
  const published = useMemo(
    () =>
      new Map(
        catalog
          .filter((c) => (c.source as { kind?: string }).kind === "upload")
          .map((c) => [(c.source as { id: string }).id, c] as const),
      ),
    [catalog],
  );

  const onFile = async (f: File) => {
    setProgress(0);
    setNote(null);
    const r = await uploadMedia(
      token,
      f,
      {
        title: f.name.replace(/\.[^.]+$/, ""),
        filename: f.name,
        origin: "upload",
      },
      setProgress,
    );
    setProgress(null);
    if (r.ok) {
      setSelected(r.media.id);
      await load(token);
    } else
      setNote({
        ok: false,
        text: t(
          r.reason === "too-large"
            ? "rec.up.err.big"
            : r.reason === "unsupported"
              ? "rec.up.err.type"
              : r.reason === "unauthorized"
                ? "rec.up.err.auth"
                : "rec.up.err.net",
        ),
      });
  };

  return (
    <div className="min-h-screen p-3 md:p-6">
      <header className="mx-auto mb-4 max-w-6xl">
        <h1 className="text-3xl font-bold">{t("lib.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("lib.intro")}</p>
        <Link to="/admin" className="mt-2 inline-block text-sm underline">
          ← {t("admin.title")}
        </Link>
      </header>

      <div className="mx-auto max-w-6xl space-y-4">
        {media === null ? (
          <section className={PANEL}>
            <p className="text-sm text-muted-foreground">
              {t("watch.loading")}
            </p>
          </section>
        ) : (
          <>
            <section className={`${PANEL} flex flex-wrap items-center gap-3`}>
              <button
                className={BTN_ACCENT}
                onClick={() => file.current?.click()}
                disabled={progress !== null}
              >
                ⬆ {t("lib.upload")}
              </button>
              <input
                ref={file}
                type="file"
                accept="video/*,audio/*"
                className="sr-only"
                aria-label={t("lib.upload")}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void onFile(f);
                }}
              />
              {progress !== null && (
                <span className="flex items-center gap-2 text-xs" role="status">
                  <progress value={progress} max={1} />{" "}
                  {Math.round(progress * 100)} %
                </span>
              )}
              {note && (
                <span
                  role={note.ok ? "status" : "alert"}
                  className={`text-sm ${note.ok ? "" : "text-destructive"}`}
                >
                  {note.text}
                </span>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                {t("lib.count", { n: media.length })}
              </span>
            </section>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
              <section className={PANEL} aria-label={t("lib.title")}>
                {media.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    {t("lib.empty")}
                  </p>
                )}
                <ul className="divide-y">
                  {media.map((m) => (
                    <li key={m.id}>
                      <button
                        className={`flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-accent ${m.id === selected ? "bg-secondary" : ""}`}
                        aria-current={m.id === selected ? "true" : undefined}
                        onClick={() => setSelected(m.id)}
                      >
                        <span aria-hidden="true" className="text-2xl">
                          {m.kind === "audio" ? "🎧" : "🎬"}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">
                            {m.title}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {[
                              t(`lib.origin.${m.origin}` as const),
                              m.durationMs ? formatMs(m.durationMs) : "",
                              mb(m.size),
                              new Intl.DateTimeFormat(lang, {
                                dateStyle: "short",
                                timeStyle: "short",
                              }).format(new Date(m.createdAt)),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                        {published.has(m.id) && (
                          <span className="rounded bg-speaker-b px-1.5 py-0.5 text-[10px] font-bold text-background">
                            {t("lib.published")}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>

              {current ? (
                <MediaDetail
                  key={current.id}
                  media={current}
                  token={token}
                  catalogItem={published.get(current.id) ?? null}
                  library={media}
                  onSelect={setSelected}
                  onChanged={async () => {
                    await load(token);
                  }}
                  onDeleted={async () => {
                    setSelected(null);
                    await load(token);
                  }}
                />
              ) : (
                <section
                  className={`${PANEL} flex items-center justify-center text-sm text-muted-foreground`}
                >
                  {t("lib.pick")}
                </section>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MediaDetail({
  media,
  token,
  catalogItem,
  library,
  onSelect,
  onChanged,
  onDeleted,
}: {
  media: MediaRecord;
  token: string;
  catalogItem: AdminItem | null;
  library: readonly MediaRecord[];
  onSelect: (id: string) => void;
  onChanged: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [tab, setTab] = useState<"publish" | "edit" | "subtitles">("publish");
  const [title, setTitle] = useState(media.title);
  const [msg, setMsg] = useState<string | null>(null);
  const [pub, setPub] = useState({
    category: catalogItem?.category ?? "",
    playlist: catalogItem?.playlist ?? "",
    episode:
      catalogItem?.episode === null || catalogItem?.episode === undefined
        ? ""
        : String(catalogItem.episode),
    description: catalogItem?.description ?? "",
    story: catalogItem?.story ?? false,
    visibility: (catalogItem?.visibility ?? "public") as "public" | "private",
    password: "",
  });
  const src = mediaUrl(media.id);

  const publish = async () => {
    const saved = await adminSave(token, {
      ...(catalogItem ? { id: catalogItem.id } : {}),
      title: title.trim() || media.title,
      description: pub.description.trim(),
      category: pub.category.trim(),
      tags: catalogItem?.tags ?? [],
      source: { kind: "upload", id: media.id, media: media.kind },
      visibility: pub.visibility,
      ...(pub.visibility === "private" && pub.password
        ? { password: pub.password }
        : {}),
      startsAt: catalogItem?.startsAt ?? null,
      live: false,
      story: pub.story,
      playlist: pub.playlist.trim(),
      episode: /^\d{1,6}$/.test(pub.episode.trim())
        ? Number(pub.episode.trim())
        : null,
      poster: media.hasPoster
        ? `/media/${media.id}/poster.jpg`
        : (catalogItem?.poster ?? ""),
      captions: media.captions.map((c) => ({
        lang: c.lang,
        label: c.label,
        url: `/media/${media.id}/captions/${c.lang}.vtt`,
      })),
    });
    setMsg(saved ? t("lib.published.ok") : t("catalog.err.save"));
    await onChanged();
  };

  return (
    <section className={`${PANEL} space-y-3`} aria-label={media.title}>
      <PanelTitle>{t("lib.preview")}</PanelTitle>
      {media.kind === "video" ? (
        <video
          ref={videoRef}
          src={src}
          controls
          playsInline
          preload="metadata"
          className="aspect-video w-full rounded-lg bg-black"
        >
          {media.captions.map((c) => (
            <track
              key={c.lang}
              kind="subtitles"
              srcLang={c.lang}
              label={c.label}
              src={`/media/${media.id}/captions/${c.lang}.vtt`}
            />
          ))}
        </video>
      ) : (
        <audio src={src} controls preload="metadata" className="w-full" />
      )}

      <div
        role="tablist"
        aria-label={media.title}
        className="flex flex-wrap gap-1 border-b pb-2"
      >
        {(["publish", "edit", "subtitles"] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            className={`${BTN} ${tab === k ? "!bg-primary-solid !text-primary-foreground" : ""}`}
            onClick={() => setTab(k)}
          >
            {t(`lib.tab.${k}` as const)}
          </button>
        ))}
      </div>

      {tab === "edit" && (
        <EditPanel
          media={media}
          token={token}
          library={library}
          videoRef={videoRef}
          onResult={async (id) => {
            await onChanged();
            onSelect(id);
            setTab("publish");
          }}
        />
      )}
      {tab === "subtitles" && (
        <SubtitlesPanel media={media} token={token} onChanged={onChanged} />
      )}

      {tab === "publish" && (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 basis-48 text-xs">
              {t("catalog.f.title")}
              <input
                className={`${INPUT} mt-1`}
                maxLength={120}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <button
              className={BTN}
              disabled={title.trim() === "" || title.trim() === media.title}
              onClick={async () => {
                await renameMedia(token, media.id, title.trim());
                await onChanged();
              }}
            >
              {t("lib.rename")}
            </button>
            <button
              className={BTN}
              onClick={async () => {
                if (!confirm(t("lib.delete.confirm"))) return;
                if (catalogItem) await adminDelete(token, catalogItem.id);
                await deleteMedia(token, media.id);
                await onDeleted();
              }}
            >
              {t("catalog.delete")}
            </button>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <div>{mb(media.size)}</div>
            <div>{media.durationMs ? formatMs(media.durationMs) : "—"}</div>
            <div>
              {media.width && media.height
                ? `${media.width}×${media.height}`
                : "—"}
            </div>
            <div>{media.mime}</div>
          </dl>
          {media.chapters.length > 0 && (
            <ol
              className="flex flex-wrap gap-1.5 text-xs"
              aria-label={t("lib.chapters")}
            >
              {media.chapters.map((c, i) => (
                <li
                  key={`${c.t}-${i}`}
                  className="rounded bg-secondary px-1.5 py-0.5 font-mono"
                >
                  {formatMs(c.t)} · {c.label}
                </li>
              ))}
            </ol>
          )}

          <div className="rounded-lg border p-3">
            <h3 className="mb-2 text-sm font-bold">
              {catalogItem ? `✓ ${t("lib.published")}` : t("lib.publish.title")}
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs">
                {t("catalog.f.category")}
                <input
                  className={`${INPUT} mt-1`}
                  maxLength={30}
                  value={pub.category}
                  onChange={(e) => setPub({ ...pub, category: e.target.value })}
                />
              </label>
              <label className="text-xs">
                {t("catalog.f.playlist")}
                <input
                  className={`${INPUT} mt-1`}
                  maxLength={60}
                  value={pub.playlist}
                  onChange={(e) => setPub({ ...pub, playlist: e.target.value })}
                />
              </label>
              <label className="text-xs">
                {t("catalog.f.episode")}
                <input
                  className={`${INPUT} mt-1`}
                  inputMode="numeric"
                  maxLength={6}
                  value={pub.episode}
                  onChange={(e) => setPub({ ...pub, episode: e.target.value })}
                />
              </label>
              <label className="text-xs">
                {t("catalog.f.visibility")}
                <select
                  className={`${INPUT} mt-1`}
                  value={pub.visibility}
                  onChange={(e) =>
                    setPub({
                      ...pub,
                      visibility: e.target.value as "public" | "private",
                    })
                  }
                >
                  <option value="public">{t("catalog.f.public")}</option>
                  <option value="private">{t("catalog.f.private")}</option>
                </select>
              </label>
              {pub.visibility === "private" && (
                <label className="text-xs sm:col-span-2">
                  {t("catalog.f.password")}
                  <input
                    type="password"
                    autoComplete="new-password"
                    className={`${INPUT} mt-1`}
                    minLength={4}
                    maxLength={100}
                    value={pub.password}
                    onChange={(e) =>
                      setPub({ ...pub, password: e.target.value })
                    }
                  />
                </label>
              )}
              <label className="text-xs sm:col-span-2">
                {t("catalog.f.description")}
                <textarea
                  className={`${INPUT} mt-1`}
                  rows={2}
                  maxLength={1000}
                  value={pub.description}
                  onChange={(e) =>
                    setPub({ ...pub, description: e.target.value })
                  }
                />
              </label>
              {media.kind === "video" && (
                <div className="sm:col-span-2">
                  <Check
                    checked={pub.story}
                    onChange={(story) => setPub({ ...pub, story })}
                  >
                    {t("catalog.f.story")}
                  </Check>
                </div>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                className={BTN_ACCENT}
                onClick={() => void publish()}
                disabled={
                  pub.visibility === "private" &&
                  !catalogItem &&
                  pub.password.length < 4
                }
              >
                {catalogItem ? t("catalog.save") : t("lib.publish")}
              </button>
              {catalogItem && (
                <>
                  <Link
                    to="/watch"
                    search={{ item: catalogItem.id }}
                    className={BTN}
                  >
                    📺 {t("admin.go.watch")}
                  </Link>
                  <button
                    className={BTN}
                    onClick={async () => {
                      await adminDelete(token, catalogItem.id);
                      await onChanged();
                    }}
                  >
                    {t("lib.unpublish")}
                  </button>
                </>
              )}
              {msg && (
                <span role="status" className="text-xs text-muted-foreground">
                  {msg}
                </span>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
