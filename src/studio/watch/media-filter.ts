// src/studio/watch/media-filter.ts
// Search, filter and sort for the media library (all client side: a library has hundreds of
// files at most).
import { fold } from "./filter";
import type { MediaRecord } from "./media-client";

export type MediaSort =
  "newest" | "oldest" | "name" | "size" | "duration" | "kind";

export interface MediaQuery {
  text: string;
  kind: "" | "video" | "audio";
  origin: "" | MediaRecord["origin"];
  /** "" any, published = in the catalog, draft = not published */
  state: "" | "published" | "draft";
  captions: "" | "with" | "without";
  /** ISO dates (yyyy-mm-dd), inclusive, local time */
  from: string;
  to: string;
  minMb: string;
  maxMb: string;
  minMin: string;
  maxMin: string;
  sort: MediaSort;
}

export const DEFAULT_MEDIA_QUERY: MediaQuery = {
  text: "",
  kind: "",
  origin: "",
  state: "",
  captions: "",
  from: "",
  to: "",
  minMb: "",
  maxMb: "",
  minMin: "",
  maxMin: "",
  sort: "newest",
};

const num = (s: string): number | null => {
  const n = Number(s.replace(",", "."));
  return s.trim() !== "" && Number.isFinite(n) ? n : null;
};

function dayStart(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
    : null;
}

export function isFiltered(q: MediaQuery): boolean {
  return (Object.keys(DEFAULT_MEDIA_QUERY) as (keyof MediaQuery)[]).some(
    (k) => k !== "sort" && q[k] !== DEFAULT_MEDIA_QUERY[k],
  );
}

export function filterMedia(
  list: readonly MediaRecord[],
  q: MediaQuery,
  publishedIds: ReadonlySet<string>,
): MediaRecord[] {
  const terms = fold(q.text).split(/\s+/).filter(Boolean);
  const from = dayStart(q.from);
  const to = dayStart(q.to);
  const minB = num(q.minMb);
  const maxB = num(q.maxMb);
  const minMs = num(q.minMin);
  const maxMs = num(q.maxMin);

  const out = list.filter((m) => {
    if (q.kind && m.kind !== q.kind) return false;
    if (q.origin && m.origin !== q.origin) return false;
    const pub = publishedIds.has(m.id);
    if (q.state === "published" && !pub) return false;
    if (q.state === "draft" && pub) return false;
    if (q.captions === "with" && m.captions.length === 0) return false;
    if (q.captions === "without" && m.captions.length > 0) return false;
    const t = Date.parse(m.createdAt);
    if (from !== null && t < from) return false;
    if (to !== null && t >= to + 86_400_000) return false;
    if (minB !== null && m.size < minB * 1024 * 1024) return false;
    if (maxB !== null && m.size > maxB * 1024 * 1024) return false;
    if (minMs !== null && (m.durationMs ?? 0) < minMs * 60_000) return false;
    if (maxMs !== null && (m.durationMs ?? 0) > maxMs * 60_000) return false;
    if (terms.length === 0) return true;
    const hay = fold(
      `${m.title} ${m.filename} ${m.mime} ${m.origin} ${m.chapters.map((c) => c.label).join(" ")} ${m.captions.map((c) => `${c.lang} ${c.label}`).join(" ")}`,
    );
    return terms.every((x) => hay.includes(x));
  });

  const cmp: Record<MediaSort, (a: MediaRecord, b: MediaRecord) => number> = {
    newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
    oldest: (a, b) => a.createdAt.localeCompare(b.createdAt),
    name: (a, b) => a.title.localeCompare(b.title),
    size: (a, b) => b.size - a.size,
    duration: (a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0),
    kind: (a, b) =>
      a.kind.localeCompare(b.kind) || b.createdAt.localeCompare(a.createdAt),
  };
  return out.sort(cmp[q.sort]);
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(0, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
