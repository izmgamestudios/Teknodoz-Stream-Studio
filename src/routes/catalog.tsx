// src/routes/catalog.tsx
// Creator-side management of the watch-page catalog. Needs CATALOG_ADMIN_TOKEN (kept in
// sessionStorage for this tab only).
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { titleFromMatches } from "@/studio/branding/head";
import { useT } from "@/studio/i18n/use-t";
import { AdminGate } from "@/studio/ui/admin-gate";
import {
  BTN,
  BTN_ACCENT,
  Check,
  INPUT,
  PANEL,
  PanelTitle,
} from "@/studio/ui/fields";
import {
  adminDelete,
  adminList,
  adminSave,
  type AdminInput,
  type AdminItem,
} from "@/studio/watch/catalog-client";
import {
  parseMediaInput,
  sourceLink,
  type MediaSource,
} from "@/studio/watch/media-url";

export const Route = createFileRoute("/catalog")({
  head: ({ matches }) => ({
    meta: [
      { title: titleFromMatches(matches, "Catalog") },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <AdminGate>
      <CatalogPage />
    </AdminGate>
  ),
});

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
  playlist: string;
  episode: string;
  poster: string;
  captions: AdminItem["captions"];
  visibility: "public" | "private";
  password: string;
  removePassword: boolean;
  linkKey: "keep" | "renew" | "remove";
}

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

const EMPTY: Draft = {
  url: "",
  title: "",
  description: "",
  category: "",
  tags: "",
  startsAt: "",
  live: false,
  story: false,
  playlist: "",
  episode: "",
  poster: "",
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

function CatalogPage() {
  const t = useT();
  // the HttpOnly session cookie authenticates; an empty token means "no Authorization header"
  const token = "";
  const [items, setItems] = useState<AdminItem[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);

  const load = useCallback(async (tk: string) => {
    const list = await adminList(tk);
    if (list === null) {
      setItems(null);
      setMsg({ ok: false, text: "admin.err.load" });
      return;
    }
    setItems(list);
    setMsg(null);
  }, []);

  useEffect(() => {
    void load(token);
  }, [load]);

  const source: MediaSource | null = parseMediaInput(
    draft.url,
    typeof location === "undefined" ? undefined : location.hostname,
  );
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const save = async () => {
    if (!source) return setMsg({ ok: false, text: "catalog.err.url" });
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
    };
    const saved = await adminSave(token, input);
    if (!saved) return setMsg({ ok: false, text: "catalog.err.save" });
    setMsg({ ok: true, text: "catalog.saved" });
    setDraft(EMPTY);
    await load(token);
  };

  const edit = (i: AdminItem) => {
    const src = i.source as MediaSource;
    setDraft({
      id: i.id,
      url: sourceLink(src).startsWith("/")
        ? `${location.origin}${sourceLink(src)}`.replace("?as=viewer", "")
        : sourceLink(src),
      title: i.title,
      description: i.description,
      category: i.category,
      tags: i.tags.join(", "),
      startsAt: toLocalInput(i.startsAt),
      live: i.live,
      story: i.story,
      playlist: i.playlist,
      episode: i.episode === null ? "" : String(i.episode),
      poster: i.poster,
      captions: i.captions,
      visibility: i.visibility,
      password: "",
      removePassword: false,
      linkKey: "keep",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const msgText = msg?.text ? t(msg.text as Parameters<typeof t>[0]) : "";

  return (
    <div className="min-h-screen p-3 md:p-6">
      <header className="mx-auto mb-4 max-w-4xl">
        <h1 className="text-3xl font-bold">{t("catalog.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("catalog.intro")}
        </p>
        <Link to="/watch" className="mt-2 inline-block text-sm underline">
          {t("catalog.preview")}
        </Link>
      </header>

      <div className="mx-auto max-w-4xl space-y-4">
        {items === null ? (
          <section className={PANEL}>
            <p className="text-sm text-muted-foreground">
              {msgText || t("watch.loading")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("catalog.disabled")}
            </p>
          </section>
        ) : (
          <>
            <section
              className={PANEL}
              aria-label={
                draft.id ? t("catalog.form.edit") : t("catalog.form.new")
              }
            >
              <PanelTitle>
                {draft.id ? t("catalog.form.edit") : t("catalog.form.new")}
              </PanelTitle>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm sm:col-span-2">
                  {t("catalog.f.url")}
                  <input
                    className={`${INPUT} mt-1 w-full`}
                    value={draft.url}
                    onChange={(e) => set({ url: e.target.value })}
                    inputMode="url"
                  />
                  <span className="text-xs text-muted-foreground">
                    {t("catalog.f.url.hint")}
                  </span>
                  {draft.url && !source && (
                    <span
                      role="alert"
                      className="block text-xs text-destructive"
                    >
                      {t("catalog.err.url")}
                    </span>
                  )}
                </label>
                <label className="block text-sm sm:col-span-2">
                  {t("catalog.f.title")}
                  <input
                    className={`${INPUT} mt-1 w-full`}
                    maxLength={120}
                    value={draft.title}
                    onChange={(e) => set({ title: e.target.value })}
                  />
                </label>
                <label className="block text-sm sm:col-span-2">
                  {t("catalog.f.description")}
                  <textarea
                    className={`${INPUT} mt-1 w-full`}
                    rows={2}
                    maxLength={1000}
                    value={draft.description}
                    onChange={(e) => set({ description: e.target.value })}
                  />
                </label>
                <label className="block text-sm">
                  {t("catalog.f.category")}
                  <input
                    className={`${INPUT} mt-1 w-full`}
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
                    className={`${INPUT} mt-1 w-full`}
                    value={draft.tags}
                    onChange={(e) => set({ tags: e.target.value })}
                  />
                </label>
                <label className="block text-sm">
                  {t("catalog.f.startsAt")}
                  <input
                    type="datetime-local"
                    className={`${INPUT} mt-1 w-full`}
                    value={draft.startsAt}
                    onChange={(e) => set({ startsAt: e.target.value })}
                  />
                </label>
                <div className="flex items-end">
                  <Check
                    checked={draft.live}
                    onChange={(live) => set({ live })}
                  >
                    {t("catalog.f.live")}
                  </Check>
                </div>
                <label className="block text-sm">
                  {t("catalog.f.playlist")}
                  <input
                    className={`${INPUT} mt-1 w-full`}
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
                    className={`${INPUT} mt-1 w-full`}
                    inputMode="numeric"
                    maxLength={6}
                    value={draft.episode}
                    onChange={(e) => set({ episode: e.target.value })}
                  />
                </label>
                <label className="block text-sm sm:col-span-2">
                  {t("catalog.f.poster")}
                  <input
                    className={`${INPUT} mt-1 w-full`}
                    inputMode="url"
                    maxLength={500}
                    value={draft.poster}
                    onChange={(e) => set({ poster: e.target.value })}
                  />
                </label>
                <div className="flex items-end sm:col-span-2">
                  <Check
                    checked={draft.story}
                    onChange={(story) => set({ story })}
                  >
                    {t("catalog.f.story")}
                  </Check>
                </div>
                <label className="block text-sm">
                  {t("catalog.f.visibility")}
                  <select
                    className={`${INPUT} mt-1 w-full`}
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
                        className={`${INPUT} mt-1 w-full`}
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
                        className={`${INPUT} mt-1 w-full`}
                        value={draft.linkKey}
                        onChange={(e) =>
                          set({ linkKey: e.target.value as Draft["linkKey"] })
                        }
                      >
                        <option value="keep">—</option>
                        <option value="renew">{t("catalog.f.linkKey")}</option>
                        <option value="remove">
                          {t("catalog.f.linkKey.remove")}
                        </option>
                      </select>
                    </label>
                  </div>
                )}
              </div>
              <div className="mt-3 flex items-center gap-2">
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
                {draft.id && (
                  <button className={BTN} onClick={() => setDraft(EMPTY)}>
                    {t("common.cancel")}
                  </button>
                )}
                {msgText && (
                  <span
                    role={msg?.ok ? "status" : "alert"}
                    className={`text-sm ${msg?.ok ? "text-muted-foreground" : "text-destructive"}`}
                  >
                    {msgText}
                  </span>
                )}
              </div>
            </section>

            <section
              className={PANEL}
              aria-label={t("catalog.list", { n: items.length })}
            >
              <PanelTitle>{t("catalog.list", { n: items.length })}</PanelTitle>
              {items.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t("catalog.empty")}
                </p>
              )}
              <ul className="divide-y">
                {items.map((i) => (
                  <li
                    key={i.id}
                    className="flex flex-wrap items-center gap-2 py-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {i.visibility === "private" ? "🔒 " : ""}
                        {i.live ? "● " : ""}
                        {i.title}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[i.category, (i.source as MediaSource).kind]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    {i.linkKey && (
                      <button
                        className={BTN}
                        onClick={() =>
                          void navigator.clipboard?.writeText(
                            `${location.origin}/watch?item=${i.id}&k=${i.linkKey}`,
                          )
                        }
                      >
                        {t("catalog.copyLink")}
                      </button>
                    )}
                    <button className={BTN} onClick={() => edit(i)}>
                      {t("catalog.edit")}
                    </button>
                    <button
                      className={BTN}
                      onClick={async () => {
                        if (!confirm(t("catalog.delete.confirm"))) return;
                        await adminDelete(token, i.id);
                        await load(token);
                      }}
                    >
                      {t("catalog.delete")}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
