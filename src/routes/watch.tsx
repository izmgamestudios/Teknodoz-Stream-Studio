// src/routes/watch.tsx
// Viewer home, a streaming-site style hub: stories, live TV, series / playlists, podcasts and
// category rails; search + category + playlist + time filters (kept in the URL) switch it to a
// grid. A playlist sidebar and an "up next" queue in the player keep viewers watching.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import { titleFromMatches } from "@/studio/branding/head";
import { useT } from "@/studio/i18n/use-t";
import { BTN, BTN_ACCENT, INPUT, INPUT_AUTO, PANEL } from "@/studio/ui/fields";
import { WatchCard } from "@/studio/ui/watch/card";
import { WatchPlayer } from "@/studio/ui/watch/player";
import { Hero } from "@/studio/ui/watch/hero";
import { Rail, RailItem } from "@/studio/ui/watch/rail";
import { coverOf, StoryBar, StoryViewer } from "@/studio/ui/watch/stories";
import {
  loadCatalog,
  unlockItem,
  type CatalogSnapshot,
} from "@/studio/watch/catalog-client";
import {
  categoriesOf,
  DEFAULT_QUERY,
  filterItems,
  type SortKey,
  type TimeFilter,
  type WatchItem,
} from "@/studio/watch/filter";
import { fractionOf } from "@/studio/watch/progress";
import { useProgress } from "@/studio/watch/use-progress";
import {
  playlistsOf,
  queueFor,
  sectionsOf,
  storiesOf,
  type Playlist,
} from "@/studio/watch/sections";

const TIMES: readonly TimeFilter[] = [
  "all",
  "live",
  "upcoming",
  "today",
  "week",
  "month",
];
const SORTS: readonly SortKey[] = ["smart", "newest", "oldest", "title"];

interface Search {
  q?: string | undefined;
  cat?: string | undefined;
  pl?: string | undefined;
  time?: TimeFilter | undefined;
  sort?: SortKey | undefined;
  item?: string | undefined;
  k?: string | undefined;
}

export const Route = createFileRoute("/watch")({
  validateSearch: (s: Record<string, unknown>): Search => {
    const str = (v: unknown, max: number) =>
      typeof v === "string" && v !== "" ? v.slice(0, max) : undefined;
    const q = str(s["q"], 100);
    const cat = str(s["cat"], 30);
    const pl = str(s["pl"], 60);
    const item = str(s["item"], 40);
    const k = str(s["k"], 100);
    return {
      ...(q ? { q } : {}),
      ...(cat ? { cat } : {}),
      ...(pl ? { pl } : {}),
      ...(TIMES.includes(s["time"] as TimeFilter) && s["time"] !== "all"
        ? { time: s["time"] as TimeFilter }
        : {}),
      ...(SORTS.includes(s["sort"] as SortKey) && s["sort"] !== "smart"
        ? { sort: s["sort"] as SortKey }
        : {}),
      ...(item ? { item } : {}),
      ...(k ? { k } : {}),
    };
  },
  head: ({ matches }) => ({
    meta: [
      { title: titleFromMatches(matches, "Watch") },
      {
        name: "description",
        content:
          "Live TV, series, films, news, podcasts and stories: watch right here, filter by category, playlist and time.",
      },
    ],
  }),
  component: WatchPage,
});

function WatchPage() {
  const t = useT();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [snap, setSnap] = useState<CatalogSnapshot | null>(null);
  const [unlocked, setUnlocked] = useState<Record<string, WatchItem>>({});
  const [open, setOpen] = useState<WatchItem | null>(null);
  const [asking, setAsking] = useState<WatchItem | null>(null);
  const [story, setStory] = useState<number | null>(null);
  const [roomCode, setRoomCode] = useState("");

  const refresh = useCallback(() => {
    void loadCatalog().then(setSnap);
  }, []);
  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  // deep link: /watch?item=ID&k=KEY unlocks (or plays) one item
  useEffect(() => {
    const { item, k } = search;
    if (!item || !snap) return;
    const found = snap.items.find((i) => i.id === item);
    if (!found) return;
    if (!found.locked) {
      setOpen(found);
      return;
    }
    if (k)
      void unlockItem(item, { key: k }).then((r) => {
        if (r.ok) {
          setUnlocked((u) => ({ ...u, [item]: r.item }));
          setOpen(r.item);
        } else setAsking(found);
      });
    else setAsking(found);
    // only when the catalog arrives or the link changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, search.item, search.k]);

  const items = useMemo(
    () => (snap?.items ?? []).map((i) => unlocked[i.id] ?? i),
    [snap, unlocked],
  );
  const query = useMemo(
    () => ({
      ...DEFAULT_QUERY,
      text: search.q ?? "",
      category: search.cat ?? "",
      playlist: search.pl ?? "",
      time: search.time ?? "all",
      sort: search.sort ?? "smart",
    }),
    [search.q, search.cat, search.pl, search.time, search.sort],
  );
  const shown = useMemo(() => filterItems(items, query), [items, query]);
  const cats = useMemo(() => categoriesOf(items), [items]);
  const playlists = useMemo(() => playlistsOf(items), [items]);
  const stories = useMemo(() => storiesOf(items), [items]);
  const sections = useMemo(() => sectionsOf(items), [items]);
  const filtering = Boolean(
    query.text || query.category || query.playlist || query.time !== "all",
  );
  const dirty = filtering || query.sort !== "smart";

  const set = (patch: Search) =>
    void navigate({
      search: (prev: Search) => ({ ...prev, ...patch }),
      replace: true,
    });

  const openItem = useCallback((i: WatchItem) => {
    if (i.locked) setAsking(i);
    else setOpen(i);
  }, []);
  const progress = useProgress();
  const hero = useMemo(
    () => items.filter((i) => i.featured && !i.locked && i.source).slice(0, 5),
    [items],
  );
  const resume = useMemo(
    () =>
      items
        .filter((i) => !i.locked && progress[i.id] && i.origin === "catalog")
        .sort((a, b) => (progress[b.id]?.at ?? 0) - (progress[a.id]?.at ?? 0))
        .slice(0, 12),
    [items, progress],
  );
  const code = roomCode.trim().toUpperCase();
  const codeOk = /^[A-HJ-NP-Z2-9]{6}$/.test(code);
  const queue = useMemo(
    () => (open ? queueFor(items, open, shown) : []),
    [open, items, shown],
  );

  const card = (i: WatchItem, wide = false) => (
    <RailItem key={i.id} wide={wide}>
      <WatchCard
        item={i}
        onOpen={openItem}
        progress={fractionOf(progress[i.id])}
      />
    </RailItem>
  );

  return (
    <div className="min-h-screen p-3 md:p-6">
      <header className="mx-auto mb-4 max-w-7xl">
        <h1 className="text-3xl font-bold">{t("watch.title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          {t("watch.intro")}
        </p>
      </header>

      {!filtering && hero.length > 0 && <Hero items={hero} onPlay={openItem} />}

      <StoryBar items={stories} onOpen={setStory} />

      <section
        className="sticky top-0 z-20 -mx-3 mx-auto mb-4 max-w-7xl space-y-2 bg-background/95 px-3 py-2 backdrop-blur md:-mx-6 md:px-6 lg:mx-auto lg:rounded-xl lg:px-0"
        aria-label={t("watch.search")}
      >
        <div className="flex flex-wrap gap-2">
          <input
            type="search"
            className={`${INPUT_AUTO} min-w-0 flex-1 basis-60`}
            placeholder={t("watch.search")}
            aria-label={t("watch.search")}
            value={search.q ?? ""}
            onChange={(e) => set({ q: e.target.value || undefined })}
          />
          <select
            className={INPUT_AUTO}
            aria-label={t("watch.category")}
            value={query.category}
            onChange={(e) => set({ cat: e.target.value || undefined })}
          >
            <option value="">{t("watch.category.all")}</option>
            {cats.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            className={INPUT_AUTO}
            aria-label={t("watch.sort")}
            value={query.sort}
            onChange={(e) => set({ sort: e.target.value as SortKey })}
          >
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`watch.sort.${s}` as const)}
              </option>
            ))}
          </select>
        </div>
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label={t("watch.time")}
        >
          {TIMES.map((x) => (
            <button
              key={x}
              className={BTN}
              aria-pressed={query.time === x}
              onClick={() => set({ time: x })}
            >
              {t(`watch.time.${x}` as const)}
            </button>
          ))}
          {dirty && (
            <button
              className="text-xs underline"
              onClick={() => void navigate({ search: {}, replace: true })}
            >
              {t("watch.reset")}
            </button>
          )}
          <span
            className="ml-auto text-xs text-muted-foreground"
            aria-live="polite"
          >
            {t("watch.count", { n: shown.length })}
          </span>
        </div>
      </section>

      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <PlaylistSidebar
          playlists={playlists}
          active={query.playlist}
          onPick={(name) => set({ pl: name || undefined })}
        />

        <div className="min-w-0 space-y-8">
          {!snap && (
            <div
              className="grid gap-x-4 gap-y-6 sm:grid-cols-2 xl:grid-cols-3"
              role="status"
              aria-label={t("watch.loading")}
            >
              {Array.from({ length: 6 }, (_, i) => (
                <div
                  key={i}
                  className="animate-pulse space-y-2"
                  aria-hidden="true"
                >
                  <div className="aspect-video rounded-xl bg-secondary" />
                  <div className="h-3 w-3/4 rounded bg-secondary" />
                  <div className="h-3 w-1/2 rounded bg-secondary" />
                </div>
              ))}
            </div>
          )}

          {snap && filtering && (
            <div className="grid gap-x-4 gap-y-6 sm:grid-cols-2 xl:grid-cols-3">
              {shown.map((i) => (
                <WatchCard
                  key={i.id}
                  item={i}
                  onOpen={openItem}
                  progress={fractionOf(progress[i.id])}
                />
              ))}
            </div>
          )}

          {snap && !filtering && items.length > 0 && (
            <>
              {resume.length > 0 && (
                <Rail title={t("watch.rail.resume")} count={resume.length}>
                  {resume.map((i) => card(i))}
                </Rail>
              )}
              {sections.live.length > 0 && (
                <Rail title={t("watch.rail.live")} count={sections.live.length}>
                  {sections.live.map((i) => card(i, true))}
                </Rail>
              )}
              {sections.upcoming.length > 0 && (
                <Rail
                  title={t("watch.rail.upcoming")}
                  count={sections.upcoming.length}
                >
                  {sections.upcoming.map((i) => card(i))}
                </Rail>
              )}
              {sections.playlists.length > 0 && (
                <Rail
                  title={t("watch.rail.playlists")}
                  count={sections.playlists.length}
                >
                  {sections.playlists.map((p) => (
                    <RailItem key={p.name}>
                      <PlaylistCard
                        playlist={p}
                        onPlay={() => {
                          const first = p.items[0];
                          if (first) openItem(first);
                        }}
                        onBrowse={() => set({ pl: p.name })}
                      />
                    </RailItem>
                  ))}
                </Rail>
              )}
              {sections.audio.length > 0 && (
                <Rail
                  title={t("watch.rail.audio")}
                  count={sections.audio.length}
                >
                  {sections.audio.map((i) => card(i))}
                </Rail>
              )}
              {sections.categories.map((c) => (
                <Rail
                  key={c.name || "__none"}
                  title={c.name || t("watch.rail.other")}
                  count={c.items.length}
                  action={
                    c.name ? (
                      <button
                        className="text-xs underline"
                        onClick={() => set({ cat: c.name })}
                      >
                        {t("watch.category.all")} →
                      </button>
                    ) : null
                  }
                >
                  {c.items.map((i) => card(i))}
                </Rail>
              ))}
            </>
          )}

          {snap && shown.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {!snap.available
                ? t("watch.offline")
                : items.length === 0
                  ? t("watch.none")
                  : t("watch.empty")}
            </p>
          )}
        </div>
      </div>

      <section
        className={`${PANEL} mx-auto mt-8 flex max-w-7xl flex-wrap items-center gap-2`}
      >
        <label htmlFor="room-code" className="text-sm font-semibold">
          {t("watch.joinByCode")}
        </label>
        <input
          id="room-code"
          className={`${INPUT_AUTO} w-44 font-mono uppercase`}
          placeholder={t("watch.joinByCode.placeholder")}
          maxLength={6}
          autoComplete="off"
          value={roomCode}
          onChange={(e) => setRoomCode(e.target.value)}
        />
        <a
          className={`${BTN_ACCENT} ${codeOk ? "" : "pointer-events-none opacity-50"}`}
          aria-disabled={!codeOk}
          href={`/r/${code}?as=viewer`}
        >
          {t("watch.joinByCode.go")}
        </a>
      </section>

      {asking && (
        <UnlockDialog
          item={asking}
          onClose={() => setAsking(null)}
          onUnlocked={(it) => {
            setUnlocked((u) => ({ ...u, [it.id]: it }));
            setAsking(null);
            setOpen(it);
          }}
        />
      )}
      {open && (
        <WatchPlayer
          item={open}
          queue={queue}
          queueTitle={
            open.playlist
              ? t("player.queue.playlist", { name: open.playlist })
              : t("player.queue.browse")
          }
          onSelect={openItem}
          onClose={() => setOpen(null)}
        />
      )}
      {story !== null && stories.length > 0 && (
        <StoryViewer
          items={stories}
          start={story}
          onClose={() => setStory(null)}
        />
      )}
    </div>
  );
}

/** Side list of playlists / series: pick one to filter, or "All". */
function PlaylistSidebar({
  playlists,
  active,
  onPick,
}: {
  playlists: readonly Playlist[];
  active: string;
  onPick: (name: string) => void;
}) {
  const t = useT();
  const row = (current: boolean) =>
    `flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent ${current ? "bg-secondary font-semibold" : ""}`;
  return (
    <aside
      aria-label={t("watch.playlists")}
      className="lg:sticky lg:top-28 lg:self-start"
    >
      <details
        open
        className="rounded-xl border bg-card p-2 lg:[&>summary]:pointer-events-none"
      >
        <summary className="cursor-pointer px-3 py-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          {t("watch.playlists")}
        </summary>
        <ul className="mt-1 max-h-[60dvh] space-y-0.5 overflow-y-auto">
          <li>
            <button
              className={row(active === "")}
              aria-current={active === "" ? "true" : undefined}
              onClick={() => onPick("")}
            >
              {t("watch.playlists.all")}
            </button>
          </li>
          {playlists.map((p) => (
            <li key={p.name}>
              <button
                className={row(active === p.name)}
                aria-current={active === p.name ? "true" : undefined}
                onClick={() => onPick(p.name)}
              >
                <span className="min-w-0 truncate">{p.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {p.items.length}
                </span>
              </button>
            </li>
          ))}
          {playlists.length === 0 && (
            <li className="px-3 py-2 text-xs text-muted-foreground">
              {t("watch.playlists.empty")}
            </li>
          )}
        </ul>
      </details>
    </aside>
  );
}

/** A playlist as a card: cover of the first episode, count, play / browse. */
function PlaylistCard({
  playlist,
  onPlay,
  onBrowse,
}: {
  playlist: Playlist;
  onPlay: () => void;
  onBrowse: () => void;
}) {
  const t = useT();
  const first = playlist.items[0];
  const cover = first ? coverOf(first) : null;
  return (
    <article className="space-y-2">
      <button
        type="button"
        onClick={onPlay}
        className="group relative block aspect-video w-full overflow-hidden rounded-xl bg-secondary outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        aria-label={`${t("watch.playlist.play")}: ${playlist.name}`}
      >
        {cover ? (
          <img
            src={cover}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="size-full object-cover transition-transform group-hover:scale-105"
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex size-full items-center justify-center text-5xl"
          >
            ▶
          </span>
        )}
        <span className="absolute inset-y-0 right-0 flex w-1/3 flex-col items-center justify-center bg-black/70 text-xs font-bold text-white">
          <span className="text-lg">≡</span>
          {t("watch.episodes", { n: playlist.items.length })}
        </span>
      </button>
      <div className="flex items-start gap-2">
        <h3 className="line-clamp-2 min-w-0 flex-1 text-sm font-semibold leading-snug">
          {playlist.name}
        </h3>
        <button className="shrink-0 text-xs underline" onClick={onBrowse}>
          {t("watch.playlists.all")}
        </button>
      </div>
    </article>
  );
}

function UnlockDialog({
  item,
  onClose,
  onUnlocked,
}: {
  item: WatchItem;
  onClose: () => void;
  onUnlocked: (i: WatchItem) => void;
}) {
  const t = useT();
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4">
      <form
        role="dialog"
        aria-modal="true"
        aria-label={item.title}
        className="w-full max-w-sm space-y-3 rounded-xl border bg-card p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          const r = await unlockItem(item.id, { password: pw });
          setBusy(false);
          if (r.ok) onUnlocked(r.item);
          else
            setErr(
              r.reason === "rate-limited"
                ? t("watch.unlock.limited")
                : r.reason === "network"
                  ? t("watch.unlock.network")
                  : t("watch.unlock.fail"),
            );
        }}
      >
        <h2 className="text-lg font-bold">🔒 {item.title}</h2>
        {item.needsPassword ? (
          <>
            <label className="block text-sm" htmlFor="unlock-pw">
              {t("watch.unlock.password")}
            </label>
            <input
              id="unlock-pw"
              type="password"
              autoComplete="off"
              autoFocus
              className={`${INPUT} w-full`}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
            />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("watch.unlock.linkOnly")}
          </p>
        )}
        {err && (
          <p role="alert" className="text-sm text-destructive">
            {err}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN} onClick={onClose}>
            {t("player.close")}
          </button>
          {item.needsPassword && (
            <button className={BTN_ACCENT} disabled={busy || pw === ""}>
              {t("watch.unlock")}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
