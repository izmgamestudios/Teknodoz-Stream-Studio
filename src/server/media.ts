// src/server/media.ts
// Media library: recordings made in the studio and files uploaded by the admin, stored on disk
// (MEDIA_DIR, default ./data/media) with a record per file in the same store as the catalog
// (PocketBase collection `media_items`, or a JSON file).
//
//   POST   /api/media              admin  raw body = the file; headers x-title, x-filename, x-chapters
//   GET    /api/media              admin  list records
//   PATCH  /api/media/:id          admin  { title }
//   DELETE /api/media/:id          admin  removes the record and every file of it
//   GET    /media/:id              public streaming with Range support (unguessable 64-bit id)
//   GET    /media/:id/poster.jpg   public
//   GET    /media/:id/captions/:lang.vtt   public
//
// Uploads are streamed to disk (never buffered), capped by MEDIA_MAX_MB, restricted to audio /
// video MIME types and verified with ffprobe when it is available.
import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  statfs,
} from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { Readable } from "node:stream";

import { z } from "zod";

import type { MediaAnalysis } from "../shared/media-analysis";
import { vttToSrt } from "./vtt";

import { isAdminRequest } from "./auth";
import { StoreUnavailableError, type RecordStore } from "./catalog";

/**
 * Content-Disposition for a download: ASCII fallback + RFC 5987 UTF-8 name. The name is cut to a
 * safe set (no path separators, quotes or control characters) and always ends with `.ext`.
 */
export function downloadDisposition(name: string, ext: string): string {
  const base =
    name
      .normalize("NFC")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f"\\/:*?<>|;]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\.+$/, "")
      .slice(0, 120) || "download";
  const file = new RegExp(`\\.${ext}$`, "i").test(base)
    ? base
    : `${base}.${ext}`;
  const ascii = file.replace(/[^\x20-\x7e]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file)}`;
}

export const MEDIA_API_PREFIX = "/api/media";
export const MEDIA_FILE_PREFIX = "/media";

export interface Chapter {
  /** ms from the start */
  t: number;
  label: string;
}

export interface MediaRecord {
  id: string;
  kind: "video" | "audio" | "image";
  mime: string;
  /** file name inside MEDIA_DIR */
  file: string;
  size: number;
  title: string;
  filename: string;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  /** false = silent video (ffprobe saw no audio stream); older records: assume true */
  hasAudio?: boolean;
  /** frames per second of the video stream (frame-accurate editing) */
  fps?: number | null;
  chapters: Chapter[];
  /** languages that have a <id>.<lang>.vtt file */
  captions: { lang: string; label: string }[];
  hasPoster: boolean;
  /** short-lived preview render: hidden from the library, removed after an hour */
  temporary?: boolean;
  origin: "studio" | "upload" | "edit";
  parentId: string | null;
  /** this file has the captions of that language burned into the picture */
  burnedLang?: string;
  /** loudness / pause measurement (POST /api/media/:id/analyze) */
  analysis?: MediaAnalysis;
  createdAt: string;
}

export interface ProbeResult {
  durationMs: number | null;
  width: number | null;
  height: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
  fps?: number | null;
}

/** Injectable so tests need no ffprobe; `null` = ffprobe not available (trust the MIME type). */
export type Prober = (file: string) => Promise<ProbeResult | null>;

const MIME_EXT: Record<string, { ext: string; kind: "video" | "audio" }> = {
  "video/webm": { ext: "webm", kind: "video" },
  "video/mp4": { ext: "mp4", kind: "video" },
  "video/quicktime": { ext: "mov", kind: "video" },
  "video/x-matroska": { ext: "mkv", kind: "video" },
  "audio/mpeg": { ext: "mp3", kind: "audio" },
  "audio/mp3": { ext: "mp3", kind: "audio" },
  "audio/wav": { ext: "wav", kind: "audio" },
  "audio/x-wav": { ext: "wav", kind: "audio" },
  "audio/ogg": { ext: "ogg", kind: "audio" },
  "audio/opus": { ext: "opus", kind: "audio" },
  "audio/mp4": { ext: "m4a", kind: "audio" },
  "audio/x-m4a": { ext: "m4a", kind: "audio" },
  "audio/aac": { ext: "aac", kind: "audio" },
  "audio/flac": { ext: "flac", kind: "audio" },
  "audio/webm": { ext: "weba", kind: "audio" },
};

const SERVE_MIME: Record<string, string> = {
  webm: "video/webm",
  mp4: "video/mp4",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  weba: "audio/webm",
  png: "image/png",
  jpg: "image/jpeg",
};

const ID_RE = /^[a-f0-9]{16}$/;
const LANG_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

export function mediaIdOk(id: string): boolean {
  return ID_RE.test(id);
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });

const chaptersSchema = z
  .array(
    z.object({
      t: z.number().int().min(0).max(86_400_000),
      label: z.string().max(120),
    }),
  )
  .max(200);

export interface StorageInfo {
  /** bytes of every file in the library folder (media, posters, captions, cards) */
  usedBytes: number;
  files: number;
  videos: number;
  audios: number;
  quotaBytes: number | null;
  /** size / free space of the disk that holds the library; null when it cannot be read */
  diskTotalBytes: number | null;
  diskFreeBytes: number | null;
}

export interface MediaOptions {
  token: string | null;
  store: RecordStore<MediaRecord>;
  dir: string;
  /** upload cap in bytes (default 1 GiB) */
  maxBytes?: number;
  /** total library quota in bytes (default: none, only the disk limits it) */
  quotaBytes?: number;
  probe?: Prober;
  /** writes a JPEG poster for a video file; true when it did */
  poster?: (input: string, out: string) => Promise<boolean>;
  now?: () => number;
}

export function mediaTokenOk(req: Request, token: string | null): boolean {
  return isAdminRequest(req, token);
}

export function createMediaApi(opts: MediaOptions) {
  const maxBytes = opts.maxBytes ?? 1024 * 1024 * 1024;
  const now = opts.now ?? Date.now;
  let dirReady: Promise<unknown> | null = null;
  const ensureDir = () => (dirReady ??= mkdir(opts.dir, { recursive: true }));

  async function find(id: string): Promise<MediaRecord | undefined> {
    return (await opts.store.list()).find((r) => r.id === id);
  }

  /** Preview renders live for an hour; every library listing clears the expired ones. */
  const TEMP_TTL_MS = 60 * 60 * 1000;
  async function sweepTemporary(list: MediaRecord[]): Promise<MediaRecord[]> {
    const cutoff = now() - TEMP_TTL_MS;
    const old = list.filter(
      (r) => r.temporary && Date.parse(r.createdAt) < cutoff,
    );
    for (const r of old) {
      await opts.store.remove(r.id);
      await removeFiles(r.id);
    }
    return old.length ? list.filter((r) => !old.includes(r)) : list;
  }

  /* ------------------------------ storage ------------------------------ */

  async function dirUsage(): Promise<{ bytes: number; files: number }> {
    await ensureDir();
    let bytes = 0;
    let files = 0;
    for (const name of await readdir(opts.dir)) {
      try {
        const st = await stat(join(opts.dir, name));
        if (st.isFile()) {
          bytes += st.size;
          files++;
        }
      } catch {
        /* removed while counting */
      }
    }
    return { bytes, files };
  }

  async function storageInfo(): Promise<StorageInfo> {
    const [usage, records] = await Promise.all([dirUsage(), opts.store.list()]);
    let diskTotal: number | null = null;
    let diskFree: number | null = null;
    try {
      const fs = await statfs(opts.dir);
      diskTotal = fs.blocks * fs.bsize;
      diskFree = fs.bavail * fs.bsize;
    } catch {
      /* not supported on this platform / volume */
    }
    return {
      usedBytes: usage.bytes,
      files: usage.files,
      videos: records.filter((r) => r.kind === "video" && !r.temporary).length,
      audios: records.filter((r) => r.kind === "audio" && !r.temporary).length,
      quotaBytes: opts.quotaBytes ?? null,
      diskTotalBytes: diskTotal,
      diskFreeBytes: diskFree,
    };
  }

  /* ------------------------------ upload ------------------------------ */

  async function upload(req: Request): Promise<Response> {
    const mime = (req.headers.get("content-type") ?? "")
      .split(";")[0]!
      .trim()
      .toLowerCase();
    const type = MIME_EXT[mime];
    if (!type) return json({ error: "unsupported-type" }, 415);
    const declared = Number(req.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > maxBytes)
      return json({ error: "too-large" }, 413);
    if (!req.body) return json({ error: "empty" }, 400);

    // library quota: refuse early when the declared size does not fit
    let used = 0;
    if (opts.quotaBytes !== undefined) {
      used = (await dirUsage()).bytes;
      if (used + (Number.isFinite(declared) ? declared : 0) > opts.quotaBytes)
        return json({ error: "quota-exceeded" }, 507);
    }

    let chapters: Chapter[] = [];
    const rawChapters = req.headers.get("x-chapters");
    if (rawChapters) {
      try {
        const parsed = chaptersSchema.safeParse(
          JSON.parse(decodeURIComponent(rawChapters)),
        );
        if (parsed.success) chapters = parsed.data;
      } catch {
        /* chapters are optional metadata */
      }
    }
    const headerText = (name: string, max: number): string => {
      try {
        return decodeURIComponent(req.headers.get(name) ?? "")
          .trim()
          .slice(0, max);
      } catch {
        return "";
      }
    };
    const filename = headerText("x-filename", 120) || `recording.${type.ext}`;
    const title =
      headerText("x-title", 120) || filename.replace(/\.[^.]+$/, "");
    const origin =
      req.headers.get("x-origin") === "studio" ? "studio" : "upload";

    await ensureDir();
    const id = randomBytes(8).toString("hex");
    const file = `${id}.${type.ext}`;
    const path = join(opts.dir, file);
    const part = `${path}.part`;

    // stream to disk with a hard cap (Content-Length can lie or be missing)
    let size = 0;
    const out = createWriteStream(part, { mode: 0o640 });
    try {
      const reader = req.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) throw new RangeError("too-large");
        if (opts.quotaBytes !== undefined && used + size > opts.quotaBytes)
          throw new RangeError("quota-exceeded");
        if (!out.write(value))
          await new Promise<void>((r) => out.once("drain", () => r()));
      }
      await new Promise<void>((res, rej) => {
        out.once("error", rej);
        out.end(res);
      });
    } catch (e) {
      // wait for the descriptor to close: destroying a stream that is still opening can create
      // the file after we removed it, leaving a stray .part behind
      await new Promise<void>((resolve) => {
        out.once("close", () => resolve());
        out.destroy();
      });
      await rm(part, { force: true });
      if (e instanceof RangeError)
        return e.message === "quota-exceeded"
          ? json({ error: "quota-exceeded" }, 507)
          : json({ error: "too-large" }, 413);
      return json({ error: "upload-failed" }, 400);
    }
    if (size === 0) {
      await rm(part, { force: true });
      return json({ error: "empty" }, 400);
    }
    await rename(part, path);

    let info: ProbeResult | null = null;
    if (opts.probe) {
      info = await opts.probe(path);
      // ffprobe is there and the file is not media of the claimed kind: reject it
      if (info && !(type.kind === "video" ? info.hasVideo : info.hasAudio)) {
        await rm(path, { force: true });
        return json({ error: "not-media" }, 415);
      }
    }

    const record: MediaRecord = {
      id,
      kind: type.kind,
      mime,
      file,
      size,
      title,
      filename,
      durationMs: info?.durationMs ?? null,
      width: info?.width ?? null,
      height: info?.height ?? null,
      hasAudio: info?.hasAudio ?? true,
      fps: info?.fps ?? null,
      chapters,
      captions: [],
      hasPoster: false,
      origin,
      parentId: null,
      createdAt: new Date(now()).toISOString(),
    };
    if (type.kind === "video" && opts.poster)
      record.hasPoster = await opts.poster(path, join(opts.dir, `${id}.jpg`));
    await opts.store.upsert(record);
    return json({ media: record }, 201);
  }

  /* ------------------------------ serving ------------------------------ */

  /** `?dl=<name>` turns a view into a download with that (sanitised) file name. */
  function dispositionFor(req: Request, path: string): string {
    const raw = new URL(req.url).searchParams.get("dl");
    if (!raw) return "inline";
    const ext = path.split(".").pop() ?? "";
    return downloadDisposition(raw, ext);
  }

  async function serveFile(
    req: Request,
    path: string,
    contentType: string,
    cache: string,
  ): Promise<Response> {
    let st;
    try {
      st = await stat(path);
    } catch {
      return json({ error: "not-found" }, 404);
    }
    const headers: Record<string, string> = {
      "content-type": contentType,
      "accept-ranges": "bytes",
      "cache-control": cache,
      "x-content-type-options": "nosniff",
      "content-disposition": dispositionFor(req, path),
    };
    const range = req.headers.get("range");
    let start = 0;
    let end = st.size - 1;
    let status = 200;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (!m || (m[1] === "" && m[2] === ""))
        return new Response(null, {
          status: 416,
          headers: { "content-range": `bytes */${st.size}` },
        });
      if (m[1] === "") {
        const suffix = Number(m[2]);
        start = Math.max(0, st.size - suffix);
      } else {
        start = Number(m[1]);
        if (m[2] !== "") end = Math.min(end, Number(m[2]));
      }
      if (start > end || start >= st.size)
        return new Response(null, {
          status: 416,
          headers: { "content-range": `bytes */${st.size}` },
        });
      status = 206;
      headers["content-range"] = `bytes ${start}-${end}/${st.size}`;
    }
    headers["content-length"] = String(end - start + 1);
    if (req.method === "HEAD") return new Response(null, { status, headers });
    const stream = Readable.toWeb(
      createReadStream(path, { start, end }),
    ) as ReadableStream;
    return new Response(stream, { status, headers });
  }

  async function serve(req: Request, rest: string[]): Promise<Response> {
    const id = rest[0] ?? "";
    if (!ID_RE.test(id)) return json({ error: "not-found" }, 404);
    const rec = await find(id);
    if (!rec) return json({ error: "not-found" }, 404);
    if (rest.length === 1) {
      const ext = rec.file.split(".").pop() ?? "";
      return serveFile(
        req,
        join(opts.dir, rec.file),
        SERVE_MIME[ext] ?? "application/octet-stream",
        "public, max-age=3600",
      );
    }
    if (rest.length === 2 && rest[1] === "poster.jpg" && rec.hasPoster)
      return serveFile(
        req,
        join(opts.dir, `${id}.jpg`),
        "image/jpeg",
        "public, max-age=3600",
      );
    if (
      rest.length === 3 &&
      rest[1] === "captions" &&
      rest[2]!.endsWith(".srt")
    ) {
      const lang = rest[2]!.slice(0, -4);
      if (LANG_RE.test(lang) && rec.captions.some((c) => c.lang === lang)) {
        let vtt: string;
        try {
          vtt = await readFile(join(opts.dir, `${id}.${lang}.vtt`), "utf8");
        } catch {
          return json({ error: "not-found" }, 404);
        }
        const srt = vttToSrt(vtt);
        if (!srt) return json({ error: "not-found" }, 404);
        const dl = new URL(req.url).searchParams.get("dl");
        return new Response(req.method === "HEAD" ? null : srt, {
          headers: {
            "content-type": "application/x-subrip; charset=utf-8",
            "cache-control": "no-cache",
            "x-content-type-options": "nosniff",
            "content-disposition": dl
              ? downloadDisposition(dl, "srt")
              : "inline",
          },
        });
      }
    }
    if (
      rest.length === 3 &&
      rest[1] === "captions" &&
      rest[2]!.endsWith(".vtt")
    ) {
      const lang = rest[2]!.slice(0, -4);
      if (LANG_RE.test(lang) && rec.captions.some((c) => c.lang === lang))
        return serveFile(
          req,
          join(opts.dir, `${id}.${lang}.vtt`),
          "text/vtt; charset=utf-8",
          "no-cache",
        );
    }
    return json({ error: "not-found" }, 404);
  }

  /* ------------------------------ admin ------------------------------ */

  async function removeFiles(id: string): Promise<void> {
    await ensureDir();
    for (const name of await readdir(opts.dir)) {
      if (name === id || name.startsWith(`${id}.`))
        await rm(join(opts.dir, name), { force: true });
    }
  }

  async function handle(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    const method = req.method.toUpperCase();
    try {
      if (
        url.pathname === MEDIA_FILE_PREFIX ||
        url.pathname.startsWith(`${MEDIA_FILE_PREFIX}/`)
      ) {
        if (method !== "GET" && method !== "HEAD")
          return json({ error: "method-not-allowed" }, 405);
        return await serve(
          req,
          url.pathname
            .slice(MEDIA_FILE_PREFIX.length)
            .split("/")
            .filter(Boolean),
        );
      }
      if (
        url.pathname !== MEDIA_API_PREFIX &&
        !url.pathname.startsWith(`${MEDIA_API_PREFIX}/`)
      )
        return null;
      if (!opts.token) return json({ error: "admin-disabled" }, 503);
      if (!mediaTokenOk(req, opts.token))
        return json({ error: "unauthorized" }, 401);
      const rest = url.pathname
        .slice(MEDIA_API_PREFIX.length)
        .split("/")
        .filter(Boolean);

      if (rest.length === 1 && rest[0] === "storage" && method === "GET")
        return json({ storage: await storageInfo() });
      if (rest.length === 0 && method === "POST") return await upload(req);
      if (rest.length === 0 && method === "GET") {
        const list = await sweepTemporary(await opts.store.list());
        return json({
          media: list
            .filter((r) => !r.temporary)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        });
      }
      const id = rest[0] ?? "";
      if (rest.length === 1 && ID_RE.test(id)) {
        const rec = await find(id);
        if (!rec) return json({ error: "not-found" }, 404);
        if (method === "GET") return json({ media: rec });
        if (method === "PATCH") {
          const body = z
            .object({ title: z.string().trim().min(1).max(120) })
            .safeParse(JSON.parse(await req.text()));
          if (!body.success) return json({ error: "bad-request" }, 400);
          const next = { ...rec, title: body.data.title };
          await opts.store.upsert(next);
          return json({ media: next });
        }
        if (method === "DELETE") {
          await opts.store.remove(id);
          await removeFiles(id);
          return json({ ok: true });
        }
      }
      return json({ error: "not-found" }, 404);
    } catch (e) {
      if (e instanceof StoreUnavailableError)
        return json({ error: "store-unavailable" }, 503);
      if (e instanceof SyntaxError) return json({ error: "bad-request" }, 400);
      console.error("[media]", e);
      return json({ error: "internal" }, 500);
    }
  }

  return { handle, find, dir: opts.dir, store: opts.store, storageInfo };
}

export type MediaApi = ReturnType<typeof createMediaApi>;
