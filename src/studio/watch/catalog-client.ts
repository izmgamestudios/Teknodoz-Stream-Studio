// src/studio/watch/catalog-client.ts
// Browser client for /api/catalog and /api/room/public.
import type { WatchItem } from "./filter";
import { isMediaSource } from "./media-url";

interface ServerItem {
  id: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  source: unknown;
  locked: boolean;
  needsPassword: boolean;
  live: boolean;
  startsAt: string | null;
  createdAt: string;
  story?: boolean;
  playlist?: string;
  episode?: number | null;
  poster?: string;
  captions?: { lang: string; label: string; url: string }[];
}

interface ServerRoom {
  code: string;
  title: string;
  category: string;
  startedAt: number;
  viewers: number;
}

export function toWatchItem(i: ServerItem): WatchItem {
  return {
    id: i.id,
    origin: "catalog",
    title: i.title,
    description: i.description,
    category: i.category,
    tags: i.tags,
    source: isMediaSource(i.source) ? i.source : null,
    locked: i.locked || !isMediaSource(i.source),
    needsPassword: i.needsPassword,
    live: i.live,
    startsAt: i.startsAt,
    createdAt: i.createdAt,
    story: i.story ?? false,
    playlist: i.playlist ?? "",
    episode: i.episode ?? null,
    poster: i.poster ?? "",
    captions: i.captions ?? [],
  };
}

export function roomToWatchItem(r: ServerRoom): WatchItem {
  return {
    id: `room-${r.code}`,
    origin: "room",
    title: r.title,
    description: "",
    category: r.category,
    tags: [],
    source: { kind: "room", code: r.code },
    locked: false,
    needsPassword: false,
    live: true,
    startsAt: null,
    createdAt: new Date(r.startedAt).toISOString(),
    viewers: r.viewers,
    story: false,
    playlist: "",
    episode: null,
    poster: "",
    captions: [],
  };
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export interface CatalogSnapshot {
  items: WatchItem[];
  adminEnabled: boolean;
  /** false when the server has no catalog API (static hosting) */
  available: boolean;
}

export async function loadCatalog(): Promise<CatalogSnapshot> {
  const [cat, rooms] = await Promise.all([
    getJson<{ items: ServerItem[]; admin: boolean }>("/api/catalog"),
    getJson<{ rooms: ServerRoom[] }>("/api/room/public"),
  ]);
  return {
    items: [
      ...(rooms?.rooms ?? []).map(roomToWatchItem),
      ...(cat?.items ?? []).map(toWatchItem),
    ],
    adminEnabled: cat?.admin ?? false,
    available: cat !== null,
  };
}

export type UnlockResult =
  | { ok: true; item: WatchItem }
  | { ok: false; reason: "forbidden" | "rate-limited" | "network" };

export async function unlockItem(
  id: string,
  secret: { password?: string; key?: string },
): Promise<UnlockResult> {
  try {
    const res = await fetch("/api/catalog/unlock", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, ...secret }),
    });
    if (res.status === 429) return { ok: false, reason: "rate-limited" };
    if (!res.ok) return { ok: false, reason: "forbidden" };
    const data = (await res.json()) as { item: ServerItem };
    return { ok: true, item: toWatchItem(data.item) };
  } catch {
    return { ok: false, reason: "network" };
  }
}

/* ------------------------------- admin ------------------------------- */

export interface AdminItem {
  id: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  source: unknown;
  visibility: "public" | "private";
  hasPassword: boolean;
  linkKey: string | null;
  startsAt: string | null;
  live: boolean;
  story: boolean;
  playlist: string;
  episode: number | null;
  poster: string;
  captions: { lang: string; label: string; url: string }[];
  createdAt: string;
}

export interface AdminInput {
  id?: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  source: unknown;
  visibility: "public" | "private";
  password?: string | null;
  linkKey?: boolean;
  startsAt: string | null;
  live: boolean;
  story: boolean;
  playlist: string;
  episode: number | null;
  poster: string;
  captions: { lang: string; label: string; url: string }[];
}

/** Empty token = rely on the HttpOnly admin session cookie (the normal web UI case). */
const auth = (token: string): HeadersInit =>
  token ? { authorization: `Bearer ${token}` } : {};

export async function adminList(token: string): Promise<AdminItem[] | null> {
  const d = await getJson<{ items: AdminItem[] }>("/api/catalog/admin", {
    headers: auth(token),
  });
  return d?.items ?? null;
}

export async function adminSave(
  token: string,
  input: AdminInput,
): Promise<AdminItem | null> {
  const d = await getJson<{ item: AdminItem }>("/api/catalog/item", {
    method: "PUT",
    headers: { ...auth(token), "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return d?.item ?? null;
}

export async function adminDelete(token: string, id: string): Promise<boolean> {
  const d = await getJson<{ ok: boolean }>(`/api/catalog/item/${id}`, {
    method: "DELETE",
    headers: auth(token),
  });
  return d?.ok === true;
}
