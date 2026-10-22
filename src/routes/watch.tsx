// src/routes/watch.tsx
// Viewer home: live public rooms + the admin-curated catalog (YouTube / Vimeo / files), with
// search, category, time and sort filters. Filters live in the URL so a view can be shared.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import { titleFromMatches } from "@/studio/branding/head";
import { useT } from "@/studio/i18n/use-t";
import { BTN, BTN_ACCENT, INPUT, INPUT_AUTO, PANEL } from "@/studio/ui/fields";
import { WatchCard } from "@/studio/ui/watch/card";
import { WatchPlayer } from "@/studio/ui/watch/player";
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
    const item = str(s["item"], 40);
    const k = str(s["k"], 100);
    return {
      ...(q ? { q } : {}),
      ...(cat ? { cat } : {}),
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
          "Live rooms and videos: watch right on the home page, filter by category and time.",
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
  const query = {
    ...DEFAULT_QUERY,
    text: search.q ?? "",
    category: search.cat ?? "",
    time: search.time ?? "all",
    sort: search.sort ?? "smart",
  };
  const shown = useMemo(
    () => filterItems(items, query),
    [items, query.text, query.category, query.time, query.sort],
  );
  const cats = useMemo(() => categoriesOf(items), [items]);
  const dirty =
    query.text ||
    query.category ||
    query.time !== "all" ||
    query.sort !== "smart";

  const set = (patch: Search) =>
    void navigate({
      search: (prev: Search) => ({ ...prev, ...patch }),
      replace: true,
    });

  const openItem = (i: WatchItem) => (i.locked ? setAsking(i) : setOpen(i));
  const code = roomCode.trim().toUpperCase();

  return (
    <div className="min-h-screen p-3 md:p-6">
      <header className="mx-auto mb-4 max-w-7xl">
        <h1 className="text-3xl font-bold">{t("watch.title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          {t("watch.intro")}
        </p>
      </header>

      <section
        className="mx-auto mb-4 max-w-7xl space-y-2"
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

      <div className="mx-auto grid max-w-7xl gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {shown.map((i) => (
          <WatchCard key={i.id} item={i} onOpen={openItem} />
        ))}
      </div>
      {snap && shown.length === 0 && (
        <p className="mx-auto mt-10 max-w-7xl text-center text-sm text-muted-foreground">
          {!snap.available
            ? t("watch.offline")
            : items.length === 0
              ? t("watch.none")
              : t("watch.empty")}
        </p>
      )}
      {!snap && (
        <p className="mx-auto mt-10 max-w-7xl text-center text-sm text-muted-foreground">
          {t("watch.loading")}
        </p>
      )}

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
          className={`${BTN_ACCENT} ${/^[A-HJ-NP-Z2-9]{6}$/.test(code) ? "" : "pointer-events-none opacity-50"}`}
          aria-disabled={!/^[A-HJ-NP-Z2-9]{6}$/.test(code)}
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
      {open && <WatchPlayer item={open} onClose={() => setOpen(null)} />}
    </div>
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
