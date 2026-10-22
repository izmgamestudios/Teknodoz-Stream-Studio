// src/routes/catalog.tsx
// Watch-page management (administrator): create, edit, duplicate, archive and delete catalog
// items, story expiry, featuring, search / filter / sort and bulk actions.
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { titleFromMatches } from "@/studio/branding/head";
import { useLang, useT } from "@/studio/i18n/use-t";
import { AdminGate } from "@/studio/ui/admin-gate";
import {
  BTN,
  BTN_ACCENT,
  Check,
  INPUT,
  INPUT_AUTO,
  PANEL,
  PanelTitle,
} from "@/studio/ui/fields";
import {
  countAdmin,
  DEFAULT_ADMIN_QUERY,
  filterAdminItems,
  relativeTime,
  STORY_PRESETS,
  storyRemainingMs,
  storyState,
  untilFromPreset,
  type AdminQuery,
  type AdminSort,
  type AdminStatus,
} from "@/studio/watch/admin-filter";
import {
  adminBulk,
  adminDelete,
  adminList,
  adminSave,
  type AdminInput,
  type AdminItem,
  type BulkAction,
} from "@/studio/watch/catalog-client";
import {
  parseMediaInput,
  sourceLink,
  type MediaSource,
} from "@/studio/watch/media-url";

export const Route = createFileRoute("/catalog")({
  head: ({ matches }) => ({
    meta: [
      { title: titleFromMatches(matches, "Watch") },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <AdminGate>
      <CatalogPage />
    </AdminGate>
  ),
});

const STATUSES: readonly AdminStatus[] = [
  "",
  "published",
  "archived",
  "story",
  "story-expired",
  "featured",
  "private",
  "live",
  "upcoming",
];
const SORTS: readonly AdminSort[] = ["newest", "oldest", "title", "story"];

const STATUS_KEY = {
  "": "wm.status.all",
  published: "wm.status.published",
  archived: "wm.status.archived",
  story: "wm.status.story",
  "story-expired": "wm.status.storyExpired",
  featured: "wm.status.featured",
  private: "wm.status.private",
  live: "wm.status.live",
  upcoming: "wm.status.upcoming",
} as const;

/** Suggestions for the category box (free text is still allowed). */
const CATEGORY_SUGGESTIONS = [
  "Haber",
  "Dizi",
  "Film",
  "Belgesel",
  "Podcast",
  "Müzik",
  "Canlı TV",
  "Eğitim",
  "Etkinlik",
  "Röportaj",
];

interface Draft {
  id?: string;
  url: string;
  title: string;
  description: string;
  category: string;
  tags: string;
  startsAt: string;
  live: boolean;
  story: boolean;
  storyPreset: string;
  storyUntil: string;
  featured: boolean;
  archived: boolean;
  playlist: string;
  episode: string;
  poster: string;
  durationMs: number | null;
  captions: AdminItem["captions"];
  visibility: "public" | "private";
  password: string;
  removePassword: boolean;
  linkKey: "keep" | "renew" | "remove";
}

const EMPTY: Draft = {
  url: "",
  title: "",
  description: "",
  category: "",
  tags: "",
  startsAt: "",
  live: false,
  story: false,
  storyPreset: "24h",
  storyUntil: "",
  featured: false,
  archived: false,
  playlist: "",
  episode: "",
  poster: "",
  durationMs: null,
  captions: [],
  visibility: "public",
  password: "",
  removePassword: false,
  linkKey: "keep",
};

/** ISO (with offset) -> value for <input type="datetime-local"> in local time. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function itemUrl(i: AdminItem): string {
  const link = sourceLink(i.source as MediaSource);
  return link.startsWith("/")
    ? `${location.origin}${link}`.replace("?as=viewer", "")
    : link;
}

function CatalogPage() {
  const t = useT();
  const lang = useLang();
  // the HttpOnly session cookie authenticates; an empty token means "no Authorization header"
  const token = "";
  const [items, setItems] = useState<AdminItem[] | null>(null);
  const [query, setQuery] = useState<AdminQuery>(DEFAULT_ADMIN_QUERY);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [storyPreset, setStoryPreset] = useState("24h");
  const formRef = useRef<HTMLElement>(null);

  const load = useCallback(async () => {
    const list = await adminList(token);
    if (list === null) setMsg({ ok: false, text: t("admin.err.load") });
    setItems(list);
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);
  // keep "in 3 hours" labels fresh
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const shown = useMemo(
    () => filterAdminItems(items ?? [], query, now),
    [items, query, now],
  );
  const counts = useMemo(() => countAdmin(items ?? [], now), [items, now]);
  const categories = useMemo(
    () =>
      [...new Set((items ?? []).map((i) => i.category).filter(Boolean))].sort(
        (a, b) => a.localeCompare(b),
      ),
    [items],
  );
  const setQ = (patch: Partial<AdminQuery>) =>
    setQuery((q) => ({ ...q, ...patch }));
  const flash = (ok: boolean, text: string) => setMsg({ ok, text });

  const source: MediaSource | null = draft
    ? parseMediaInput(
        draft.url,
        typeof location === "undefined" ? undefined : location.hostname,
      )
    : null;

  /* ------------------------------ item actions ------------------------------ */

  const openDraft = (d: Draft) => {
    setDraft(d);
    setMsg(null);
    requestAnimationFrame(() =>
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };

  const edit = (i: AdminItem) =>
    openDraft({
      id: i.id,
      url: itemUrl(i),
      title: i.title,
      description: i.description,
      category: i.category,
      tags: i.tags.join(", "),
      startsAt: toLocalInput(i.startsAt),
      live: i.live,
      story: i.story,
      storyPreset: i.storyUntil ? "custom" : "none",
      storyUntil: toLocalInput(i.storyUntil),
      featured: i.featured,
      archived: i.archived,
      playlist: i.playlist,
      episode: i.episode === null ? "" : String(i.episode),
      poster: i.poster,
      durationMs: i.durationMs,
      captions: i.captions,
      visibility: i.visibility,
      password: "",
      removePassword: false,
      linkKey: "keep",
    });

  const save = async () => {
    if (!draft) return;
    if (!source) return flash(false, t("catalog.err.url"));
    let until: string | null = null;
    if (draft.story && draft.storyPreset !== "none") {
      until =
        draft.storyPreset === "custom"
          ? draft.storyUntil
            ? new Date(draft.storyUntil).toISOString()
            : null
          : untilFromPreset(
              STORY_PRESETS.find((p) => p.id === draft.storyPreset)?.hours ??
                null,
              Date.now(),
            );
    }
    const input: AdminInput = {
      ...(draft.id ? { id: draft.id } : {}),
      title: draft.title.trim(),
      description: draft.description.trim(),
      category: draft.category.trim(),
      tags: draft.tags
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 8),
      source,
      visibility: draft.visibility,
      ...(draft.removePassword
        ? { password: null }
        : draft.password
          ? { password: draft.password }
          : {}),
      ...(draft.linkKey === "renew"
        ? { linkKey: true }
        : draft.linkKey === "remove"
          ? { linkKey: false }
          : {}),
      startsAt: draft.startsAt ? new Date(draft.startsAt).toISOString() : null,
      live: draft.live || source.kind === "youtube-live",
      story: draft.story,
      playlist: draft.playlist.trim(),
      episode: /^\d{1,6}$/.test(draft.episode.trim())
        ? Number(draft.episode.trim())
        : null,
      poster: draft.poster.trim(),
      captions: draft.captions,
      archived: draft.archived,
      storyUntil: until,
      featured: draft.featured && !draft.archived,
      durationMs: draft.durationMs,
    };
    const saved = await adminSave(token, input);
    if (!saved) return flash(false, t("catalog.err.save"));
    flash(true, t("catalog.saved"));
    setDraft(null);
    await load();
  };

  const duplicate = (i: AdminItem) =>
    openDraft({
      ...EMPTY,
      url: itemUrl(i),
      title: `${i.title} (${t("wm.copy")})`,
      description: i.description,
      category: i.category,
      tags: i.tags.join(", "),
      story: i.story,
      storyPreset: "24h",
      playlist: i.playlist,
      poster: i.poster,
      durationMs: i.durationMs,
      captions: i.captions,
    });

  const bulk = async (ids: readonly string[], op: BulkAction) => {
    const n = await adminBulk(token, ids, op);
    if (n === null) return flash(false, t("catalog.err.save"));
    flash(true, t("wm.bulk.done", { n }));
    setSelected(new Set());
    await load();
  };

  const remove = async (i: AdminItem) => {
    if (!confirm(t("catalog.delete.confirm"))) return;
    await adminDelete(token, i.id);
    await load();
  };

  /* ------------------------------ selection ------------------------------ */

  const allSelected =
    shown.length > 0 && shown.every((i) => selected.has(i.id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const ids = [...selected];

  const storyLabel = (i: AdminItem): string | null => {
    const st = storyState(i, now);
    if (st === "off") return null;
    if (st === "expired") return t("wm.badge.storyExpired");
    const left = storyRemainingMs(i, now);
    return left === null
      ? t("wm.badge.story")
      : `${t("wm.badge.story")} · ${relativeTime(left, lang)}`;
  };

  return (
    <div className="min-h-screen p-3 md:p-6">
      <header className="mx-auto mb-4 max-w-6xl">
        <h1 className="text-3xl font-bold">{t("wm.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("wm.intro")}</p>
        <div className="mt-2 flex flex-wrap gap-3 text-sm">
          <Link to="/admin" className="underline">
            ← {t("admin.title")}
          </Link>
          <Link to="/watch" className="underline">
            📺 {t("catalog.preview")}
          </Link>
          <Link to="/library" className="underline">
            🎬 {t("admin.go.library")}
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-4">
        {items === null ? (
          <section className={PANEL}>
            <p className="text-sm text-muted-foreground">
              {msg?.text ?? t("watch.loading")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("catalog.disabled")}
            </p>
          </section>
        ) : (
          <>
            {draft && (
              <section
                ref={formRef}
                className={PANEL}
                aria-label={
                  draft.id ? t("catalog.form.edit") : t("catalog.form.new")
                }
              >
                <PanelTitle>
                  {draft.id ? t("catalog.form.edit") : t("catalog.form.new")}
                </PanelTitle>
                <ItemForm draft={draft} setDraft={setDraft} source={source} />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    className={BTN_ACCENT}
                    onClick={() => void save()}
                    disabled={
                      !source ||
                      draft.title.trim() === "" ||
                      (draft.visibility === "private" &&
                        draft.password !== "" &&
                        draft.password.length < 4)
                    }
                  >
                    {t("catalog.save")}
                  </button>
                  <button className={BTN} onClick={() => setDraft(null)}>
                    {t("common.cancel")}
                  </button>
                  {msg && (
                    <span
                      role={msg.ok ? "status" : "alert"}
                      className={`text-sm ${msg.ok ? "text-muted-foreground" : "text-destructive"}`}
                    >
                      {msg.text}
                    </span>
                  )}
                </div>
              </section>
            )}

            <section className={PANEL} aria-label={t("watch.search")}>
              <div className="flex flex-wrap items-center gap-2">
                <button className={BTN_ACCENT} onClick={() => openDraft(EMPTY)}>
                  ＋ {t("wm.new")}
                </button>
                <input
                  type="search"
                  className={`${INPUT_AUTO} min-w-0 flex-1 basis-56`}
                  placeholder={t("watch.search")}
                  aria-label={t("watch.search")}
                  value={query.text}
                  onChange={(e) => setQ({ text: e.target.value })}
                />
                <select
                  className={INPUT_AUTO}
                  aria-label={t("lib.f.state")}
                  value={query.status}
                  onChange={(e) =>
                    setQ({ status: e.target.value as AdminStatus })
                  }
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(STATUS_KEY[s])}
                    </option>
                  ))}
                </select>
                <select
                  className={INPUT_AUTO}
                  aria-label={t("watch.category")}
                  value={query.category}
                  onChange={(e) => setQ({ category: e.target.value })}
                >
                  <option value="">{t("watch.category.all")}</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <select
                  className={INPUT_AUTO}
                  aria-label={t("watch.sort")}
                  value={query.sort}
                  onChange={(e) => setQ({ sort: e.target.value as AdminSort })}
                >
                  {SORTS.map((s) => (
                    <option key={s} value={s}>
                      {t(`wm.sort.${s}` as const)}
                    </option>
                  ))}
                </select>
              </div>
              <p
                className="mt-2 text-xs text-muted-foreground"
                aria-live="polite"
              >
                {t("wm.count", { n: shown.length, total: counts.total })} ·{" "}
                {t("wm.counts", {
                  p: counts.published,
                  a: counts.archived,
                  s: counts.storyActive,
                  e: counts.storyExpired,
                })}
              </p>
            </section>

            {selected.size > 0 && (
              <section
                className={`${PANEL} sticky top-2 z-10 flex flex-wrap items-center gap-2 shadow`}
                aria-label={t("wm.selected", { n: selected.size })}
              >
                <b className="text-sm">
                  {t("wm.selected", { n: selected.size })}
                </b>
                <button
                  className={BTN}
                  onClick={() => void bulk(ids, { action: "archive" })}
                >
                  🗄 {t("wm.row.archive")}
                </button>
                <button
                  className={BTN}
                  onClick={() => void bulk(ids, { action: "unarchive" })}
                >
                  ↩ {t("wm.row.unarchive")}
                </button>
                <span className="flex items-center gap-1">
                  <select
                    className={INPUT_AUTO}
                    aria-label={t("wm.story.until")}
                    value={storyPreset}
                    onChange={(e) => setStoryPreset(e.target.value)}
                  >
                    {STORY_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {t(`wm.story.preset.${p.id}` as const)}
                      </option>
                    ))}
                  </select>
                  <button
                    className={BTN}
                    onClick={() =>
                      void bulk(ids, {
                        action: "story",
                        on: true,
                        until: untilFromPreset(
                          STORY_PRESETS.find((p) => p.id === storyPreset)
                            ?.hours ?? null,
                          Date.now(),
                        ),
                      })
                    }
                  >
                    ◉ {t("wm.bulk.storyOn")}
                  </button>
                </span>
                <button
                  className={BTN}
                  onClick={() =>
                    void bulk(ids, { action: "story", on: false, until: null })
                  }
                >
                  {t("wm.bulk.storyOff")}
                </button>
                <button
                  className={BTN}
                  onClick={() =>
                    void bulk(ids, { action: "feature", on: true })
                  }
                >
                  ★ {t("wm.bulk.feature")}
                </button>
                <button
                  className={BTN}
                  onClick={() =>
                    void bulk(ids, { action: "feature", on: false })
                  }
                >
                  ☆ {t("wm.bulk.unfeature")}
                </button>
                <button
                  className={BTN}
                  onClick={() => {
                    if (
                      confirm(t("wm.bulk.delete.confirm", { n: selected.size }))
                    )
                      void bulk(ids, { action: "delete" });
                  }}
                >
                  🗑 {t("catalog.delete")}
                </button>
                <button
                  className="ml-auto text-xs underline"
                  onClick={() => setSelected(new Set())}
                >
                  {t("wm.clearSelection")}
                </button>
              </section>
            )}

            {msg && !draft && (
              <p
                role={msg.ok ? "status" : "alert"}
                className={`text-sm ${msg.ok ? "text-muted-foreground" : "text-destructive"}`}
              >
                {msg.text}
              </p>
            )}

            <section
              className={PANEL}
              aria-label={t("catalog.list", { n: shown.length })}
            >
              <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Check
                  checked={allSelected}
                  onChange={(v) =>
                    setSelected(v ? new Set(shown.map((i) => i.id)) : new Set())
                  }
                >
                  {t("wm.selectAll")}
                </Check>
              </div>
              {shown.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {items.length === 0 ? t("catalog.empty") : t("watch.empty")}
                </p>
              )}
              <ul className="divide-y">
                {shown.map((i) => {
                  const story = storyLabel(i);
                  return (
                    <li
                      key={i.id}
                      className={`flex flex-wrap items-center gap-2 py-2 ${i.archived ? "opacity-60" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(i.id)}
                        onChange={() => toggle(i.id)}
                        aria-label={i.title}
                      />
                      <span className="min-w-0 flex-1 basis-60">
                        <span className="block truncate text-sm font-semibold">
                          {i.title}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[
                            i.category,
                            i.playlist
                              ? `${i.playlist}${i.episode !== null ? ` #${i.episode}` : ""}`
                              : "",
                            (i.source as MediaSource).kind,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        <span className="mt-1 flex flex-wrap gap-1 text-[10px] font-bold uppercase">
                          {i.archived && (
                            <Badge tone="muted">{t("wm.badge.archived")}</Badge>
                          )}
                          {story && (
                            <Badge
                              tone={
                                storyState(i, now) === "expired"
                                  ? "danger"
                                  : "accent"
                              }
                            >
                              {story}
                            </Badge>
                          )}
                          {i.featured && !i.archived && (
                            <Badge tone="accent">
                              ★ {t("wm.badge.featured")}
                            </Badge>
                          )}
                          {i.visibility === "private" && (
                            <Badge tone="muted">🔒 {t("watch.private")}</Badge>
                          )}
                          {i.live && (
                            <Badge tone="danger">● {t("watch.live")}</Badge>
                          )}
                        </span>
                      </span>
                      <span className="flex flex-wrap gap-1">
                        <button className={BTN} onClick={() => edit(i)}>
                          {t("catalog.edit")}
                        </button>
                        <button
                          className={BTN}
                          onClick={() =>
                            void bulk([i.id], {
                              action: i.archived ? "unarchive" : "archive",
                            })
                          }
                        >
                          {i.archived
                            ? `↩ ${t("wm.row.unarchive")}`
                            : `🗄 ${t("wm.row.archive")}`}
                        </button>
                        <button
                          className={BTN}
                          onClick={() => duplicate(i)}
                          disabled={i.visibility === "private"}
                          title={
                            i.visibility === "private"
                              ? t("wm.row.duplicate.private")
                              : undefined
                          }
                        >
                          ⧉ {t("wm.row.duplicate")}
                        </button>
                        {i.linkKey && (
                          <button
                            className={BTN}
                            onClick={() =>
                              void navigator.clipboard
                                ?.writeText(
                                  `${location.origin}/watch?item=${i.id}&k=${i.linkKey}`,
                                )
                                .then(() => flash(true, t("wm.copied")))
                            }
                          >
                            {t("catalog.copyLink")}
                          </button>
                        )}
                        {!i.archived && (
                          <Link
                            to="/watch"
                            search={{ item: i.id }}
                            className={BTN}
                          >
                            ▶ {t("wm.row.preview")}
                          </Link>
                        )}
                        <button className={BTN} onClick={() => void remove(i)}>
                          🗑
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: "accent" | "danger" | "muted";
  children: ReactNode;
}) {
  const cls =
    tone === "accent"
      ? "bg-speaker-b text-background"
      : tone === "danger"
        ? "bg-destructive text-primary-foreground"
        : "bg-secondary text-foreground";
  return <span className={`rounded px-1.5 py-0.5 ${cls}`}>{children}</span>;
}

function ItemForm({
  draft,
  setDraft,
  source,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  source: MediaSource | null;
}) {
  const t = useT();
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const field = `${INPUT} mt-1 w-full`;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm sm:col-span-2">
        {t("catalog.f.url")}
        <input
          className={field}
          value={draft.url}
          onChange={(e) => set({ url: e.target.value })}
          inputMode="url"
        />
        <span className="text-xs text-muted-foreground">
          {t("catalog.f.url.hint")}
        </span>
        {draft.url && !source && (
          <span role="alert" className="block text-xs text-destructive">
            {t("catalog.err.url")}
          </span>
        )}
      </label>
      <label className="block text-sm sm:col-span-2">
        {t("catalog.f.title")}
        <input
          className={field}
          maxLength={120}
          value={draft.title}
          onChange={(e) => set({ title: e.target.value })}
        />
      </label>
      <label className="block text-sm sm:col-span-2">
        {t("catalog.f.description")}
        <textarea
          className={field}
          rows={2}
          maxLength={1000}
          value={draft.description}
          onChange={(e) => set({ description: e.target.value })}
        />
      </label>
      <label className="block text-sm">
        {t("catalog.f.category")}
        <input
          className={field}
          maxLength={30}
          list="catalog-categories"
          value={draft.category}
          onChange={(e) => set({ category: e.target.value })}
        />
        <datalist id="catalog-categories">
          {CATEGORY_SUGGESTIONS.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      <label className="block text-sm">
        {t("catalog.f.tags")}
        <input
          className={field}
          value={draft.tags}
          onChange={(e) => set({ tags: e.target.value })}
        />
      </label>
      <label className="block text-sm">
        {t("catalog.f.playlist")}
        <input
          className={field}
          maxLength={60}
          value={draft.playlist}
          onChange={(e) => set({ playlist: e.target.value })}
        />
        <span className="text-xs text-muted-foreground">
          {t("catalog.f.playlist.hint")}
        </span>
      </label>
      <label className="block text-sm">
        {t("catalog.f.episode")}
        <input
          className={field}
          inputMode="numeric"
          maxLength={6}
          value={draft.episode}
          onChange={(e) => set({ episode: e.target.value })}
        />
      </label>
      <label className="block text-sm sm:col-span-2">
        {t("catalog.f.poster")}
        <input
          className={field}
          inputMode="url"
          maxLength={500}
          value={draft.poster}
          onChange={(e) => set({ poster: e.target.value })}
        />
      </label>
      <label className="block text-sm">
        {t("catalog.f.startsAt")}
        <input
          type="datetime-local"
          className={field}
          value={draft.startsAt}
          onChange={(e) => set({ startsAt: e.target.value })}
        />
      </label>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
        <Check checked={draft.live} onChange={(live) => set({ live })}>
          {t("catalog.f.live")}
        </Check>
        <Check
          checked={draft.featured}
          onChange={(featured) => set({ featured })}
        >
          ★ {t("wm.featured")}
        </Check>
        <Check
          checked={draft.archived}
          onChange={(archived) => set({ archived })}
        >
          🗄 {t("wm.archived")}
        </Check>
      </div>

      <fieldset className="space-y-2 rounded-lg border p-3 sm:col-span-2">
        <legend className="px-1 text-sm font-semibold">
          {t("wm.story.title")}
        </legend>
        <Check checked={draft.story} onChange={(story) => set({ story })}>
          {t("catalog.f.story")}
        </Check>
        {draft.story && (
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <label className="flex flex-col gap-1">
              {t("wm.story.until")}
              <select
                className={INPUT_AUTO}
                value={draft.storyPreset}
                onChange={(e) => set({ storyPreset: e.target.value })}
              >
                {STORY_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {t(`wm.story.preset.${p.id}` as const)}
                  </option>
                ))}
                <option value="custom">{t("wm.story.preset.custom")}</option>
              </select>
            </label>
            {draft.storyPreset === "custom" && (
              <label className="flex flex-col gap-1">
                {t("wm.story.custom")}
                <input
                  type="datetime-local"
                  className={INPUT_AUTO}
                  value={draft.storyUntil}
                  onChange={(e) => set({ storyUntil: e.target.value })}
                />
              </label>
            )}
            <p className="text-xs text-muted-foreground">
              {t("wm.story.note")}
            </p>
          </div>
        )}
      </fieldset>

      <label className="block text-sm">
        {t("catalog.f.visibility")}
        <select
          className={field}
          value={draft.visibility}
          onChange={(e) =>
            set({ visibility: e.target.value as Draft["visibility"] })
          }
        >
          <option value="public">{t("catalog.f.public")}</option>
          <option value="private">{t("catalog.f.private")}</option>
        </select>
      </label>
      {draft.visibility === "private" && (
        <div className="space-y-2 sm:col-span-2">
          <label className="block text-sm">
            {t("catalog.f.password")}
            <input
              type="password"
              autoComplete="new-password"
              className={field}
              minLength={4}
              maxLength={100}
              value={draft.password}
              onChange={(e) => set({ password: e.target.value })}
            />
            {draft.id && (
              <span className="text-xs text-muted-foreground">
                {t("catalog.f.password.keep")}
              </span>
            )}
          </label>
          <Check
            checked={draft.removePassword}
            onChange={(removePassword) => set({ removePassword })}
          >
            {t("catalog.f.password.remove")}
          </Check>
          <label className="block text-sm">
            {t("catalog.f.linkKey")}
            <select
              className={field}
              value={draft.linkKey}
              onChange={(e) =>
                set({ linkKey: e.target.value as Draft["linkKey"] })
              }
            >
              <option value="keep">—</option>
              <option value="renew">{t("catalog.f.linkKey")}</option>
              <option value="remove">{t("catalog.f.linkKey.remove")}</option>
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
