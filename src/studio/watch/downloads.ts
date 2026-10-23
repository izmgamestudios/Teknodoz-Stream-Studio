// src/studio/watch/downloads.ts
// Which file is which when someone downloads a library video: the RAW recording (the first
// file of the chain, before any edit), the CLEAN version (no burned-in captions) and the
// SUBTITLED version (captions burned into the picture). Pure helpers over the media list.
import type { MediaRecord } from "./media-client";

/** The record and its ancestors, nearest first (cycle-safe). */
export function lineage(
  rec: MediaRecord,
  all: readonly MediaRecord[],
): MediaRecord[] {
  const byId = new Map(all.map((r) => [r.id, r]));
  const out: MediaRecord[] = [];
  const seen = new Set<string>();
  let cur: MediaRecord | undefined = rec;
  while (cur && !seen.has(cur.id)) {
    out.push(cur);
    seen.add(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return out;
}

/** The original recording / upload this item descends from (itself when it is one). */
export function rawOf(
  rec: MediaRecord,
  all: readonly MediaRecord[],
): MediaRecord {
  const chain = lineage(rec, all);
  return chain[chain.length - 1] as MediaRecord;
}

/** This item without burned-in captions: itself, or the nearest ancestor that has none. */
export function cleanOf(
  rec: MediaRecord,
  all: readonly MediaRecord[],
): MediaRecord {
  return lineage(rec, all).find((r) => !r.burnedLang) ?? rawOf(rec, all);
}

/** The copy with `lang` burned in: this item, or its newest child that has it; else null. */
export function subtitledOf(
  rec: MediaRecord,
  all: readonly MediaRecord[],
  lang: string,
): MediaRecord | null {
  if (rec.burnedLang === lang) return rec;
  return (
    all
      .filter((r) => r.parentId === rec.id && r.burnedLang === lang)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  );
}

const SUFFIX = {
  raw: "-ham",
  clean: "-altyazisiz",
  subtitled: "-altyazili",
} as const;
export type Flavor = keyof typeof SUFFIX;

/** "Çağrı Merkezi" + clean -> "Çağrı Merkezi-altyazisiz" (extension is added by the server). */
export function downloadName(
  title: string,
  flavor?: Flavor,
  lang?: string,
): string {
  const base =
    title.replace(/\s*\((düzenlendi|altyazılı)\)\s*$/i, "").trim() || "kayit";
  return `${base}${flavor ? SUFFIX[flavor] : ""}${lang ? `-${lang}` : ""}`;
}

export const fileDownloadUrl = (id: string, name: string): string =>
  `/media/${id}?dl=${encodeURIComponent(name)}`;

export const captionDownloadUrl = (
  id: string,
  lang: string,
  format: "srt" | "vtt",
  name: string,
): string =>
  `/media/${id}/captions/${lang}.${format}?dl=${encodeURIComponent(name)}`;

export const wavUrl = (id: string): string => `/api/media/${id}/export.wav`;
