// src/studio/watch/media-client.ts
// Browser client for the media library (/api/media). All calls need the admin token.
import type { MediaAnalysis } from "../../shared/media-analysis";
import type { AudioSpecWire } from "./audio-state";

export interface Chapter {
  t: number;
  label: string;
}

export interface MediaRecord {
  id: string;
  kind: "video" | "audio" | "image";
  mime: string;
  file: string;
  size: number;
  title: string;
  filename: string;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  hasAudio?: boolean;
  fps?: number | null;
  chapters: Chapter[];
  captions: { lang: string; label: string }[];
  hasPoster: boolean;
  origin: "studio" | "upload" | "edit";
  parentId: string | null;
  /** captions of this language are burned into the picture */
  burnedLang?: string;
  analysis?: MediaAnalysis;
  createdAt: string;
}

export type UploadResult =
  | { ok: true; media: MediaRecord }
  | {
      ok: false;
      reason:
        | "unauthorized"
        | "too-large"
        | "unsupported"
        | "quota"
        | "network"
        | "server";
    };

export interface UploadMeta {
  title: string;
  filename: string;
  origin: "studio" | "upload";
  chapters?: readonly Chapter[];
}

export function mediaUrl(id: string): string {
  return `/media/${id}`;
}

/** Uploads a Blob with progress (XMLHttpRequest: fetch has no upload progress). */
export function uploadMedia(
  token: string,
  blob: Blob,
  meta: UploadMeta,
  onProgress?: (fraction: number) => void,
): Promise<UploadResult> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/media");
    if (token) xhr.setRequestHeader("authorization", `Bearer ${token}`);
    xhr.setRequestHeader("content-type", blob.type || "video/webm");
    xhr.setRequestHeader("x-title", encodeURIComponent(meta.title));
    xhr.setRequestHeader("x-filename", encodeURIComponent(meta.filename));
    xhr.setRequestHeader("x-origin", meta.origin);
    if (meta.chapters?.length)
      xhr.setRequestHeader(
        "x-chapters",
        encodeURIComponent(JSON.stringify(meta.chapters.slice(0, 200))),
      );
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onerror = () => resolve({ ok: false, reason: "network" });
    xhr.onload = () => {
      if (xhr.status === 201) {
        try {
          const data = JSON.parse(xhr.responseText) as { media: MediaRecord };
          return resolve({ ok: true, media: data.media });
        } catch {
          return resolve({ ok: false, reason: "server" });
        }
      }
      resolve({
        ok: false,
        reason:
          xhr.status === 401 || xhr.status === 503
            ? "unauthorized"
            : xhr.status === 507
              ? "quota"
              : xhr.status === 413
                ? "too-large"
                : xhr.status === 415
                  ? "unsupported"
                  : "server",
      });
    };
    xhr.send(blob);
  });
}

/** Empty token = rely on the HttpOnly admin session cookie (the normal web UI case). */
const auth = (token: string): HeadersInit =>
  token ? { authorization: `Bearer ${token}` } : {};

export async function listMedia(token: string): Promise<MediaRecord[] | null> {
  try {
    const res = await fetch("/api/media", {
      headers: auth(token),
      cache: "no-store",
    });
    if (!res.ok) return null;
    // images are title cards / posters used by the editor, not library items
    return ((await res.json()) as { media: MediaRecord[] }).media.filter(
      (m) => m.kind !== "image",
    );
  } catch {
    return null;
  }
}

export async function renameMedia(
  token: string,
  id: string,
  title: string,
): Promise<boolean> {
  try {
    const res = await fetch(`/api/media/${id}`, {
      method: "PATCH",
      headers: { ...auth(token), "content-type": "application/json" },
      body: JSON.stringify({ title }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function deleteMedia(token: string, id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/media/${id}`, {
      method: "DELETE",
      headers: auth(token),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/* ------------------------- editing + subtitles ------------------------- */

export interface Capabilities {
  ffmpeg: {
    available: boolean;
    subtitles: boolean;
    loudnorm: boolean;
    libx264: boolean;
  };
  whisper: { backend: string; model: string; available: boolean } | null;
}

export type Segment =
  | { kind: "card"; assetId: string; seconds: number }
  | { kind: "media"; mediaId: string };

export interface EditSpec {
  title?: string;
  trim?: { startMs: number; endMs: number };
  clips?: { mediaId?: string; startMs: number; endMs: number }[];
  audio?: AudioSpecWire;
  preview?: { startMs: number; lengthMs: number };
  intro?: Segment;
  outro?: Segment;
  fadeMs: number;
  normalize: boolean;
  burnLang?: string;
}

export interface Job {
  id: string;
  type: "edit" | "subtitles";
  mediaId: string;
  status: "queued" | "running" | "done" | "error";
  progress: number;
  resultId: string | null;
  error: string | null;
}

const jsonHeaders = (token: string): HeadersInit => ({
  ...auth(token),
  "content-type": "application/json",
});

export async function getCapabilities(
  token: string,
): Promise<Capabilities | null> {
  try {
    const res = await fetch("/api/media/capabilities", {
      headers: auth(token),
      cache: "no-store",
    });
    return res.ok ? ((await res.json()) as Capabilities) : null;
  } catch {
    return null;
  }
}

/** Uploads a PNG (title card); returns the hidden asset id. */
export async function uploadAsset(
  token: string,
  png: Blob,
): Promise<string | null> {
  try {
    const res = await fetch("/api/media/asset", {
      method: "POST",
      headers: { ...auth(token), "content-type": "image/png" },
      body: png,
    });
    if (!res.ok) return null;
    return ((await res.json()) as { media: MediaRecord }).media.id;
  } catch {
    return null;
  }
}

export type StartResult = { ok: true; job: Job } | { ok: false; error: string };

async function startJob(
  token: string,
  path: string,
  body: unknown,
): Promise<StartResult> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      job?: Job;
      error?: string;
    };
    return res.status === 202 && data.job
      ? { ok: true, job: data.job }
      : { ok: false, error: data.error ?? "failed" };
  } catch {
    return { ok: false, error: "network" };
  }
}

export const startEdit = (token: string, id: string, spec: EditSpec) =>
  startJob(token, `/api/media/${id}/edit`, { spec });

export const startSubtitles = (token: string, id: string, lang: string) =>
  startJob(token, `/api/media/${id}/subtitles`, { lang });

export async function getJob(token: string, id: string): Promise<Job | null> {
  try {
    const res = await fetch(`/api/media/jobs/${id}`, {
      headers: auth(token),
      cache: "no-store",
    });
    return res.ok ? ((await res.json()) as { job: Job }).job : null;
  } catch {
    return null;
  }
}

export async function cancelJob(token: string, id: string): Promise<void> {
  try {
    await fetch(`/api/media/jobs/${id}`, {
      method: "DELETE",
      headers: auth(token),
    });
  } catch {
    /* the job simply keeps running */
  }
}

export async function putCaptions(
  token: string,
  id: string,
  lang: string,
  text: string,
): Promise<MediaRecord | null> {
  try {
    const res = await fetch(`/api/media/${id}/captions/${lang}`, {
      method: "PUT",
      headers: { ...auth(token), "content-type": "text/plain" },
      body: text,
    });
    return res.ok ? ((await res.json()) as { media: MediaRecord }).media : null;
  } catch {
    return null;
  }
}

export async function deleteCaptions(
  token: string,
  id: string,
  lang: string,
): Promise<MediaRecord | null> {
  try {
    const res = await fetch(`/api/media/${id}/captions/${lang}`, {
      method: "DELETE",
      headers: auth(token),
    });
    return res.ok ? ((await res.json()) as { media: MediaRecord }).media : null;
  } catch {
    return null;
  }
}

export async function fetchCaptionsText(
  id: string,
  lang: string,
): Promise<string | null> {
  try {
    const res = await fetch(`/media/${id}/captions/${lang}.vtt`, {
      cache: "no-store",
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/* ------------------------------ storage ------------------------------ */

export interface StorageInfo {
  usedBytes: number;
  files: number;
  videos: number;
  audios: number;
  quotaBytes: number | null;
  diskTotalBytes: number | null;
  diskFreeBytes: number | null;
}

export async function getStorage(token: string): Promise<StorageInfo | null> {
  try {
    const res = await fetch("/api/media/storage", {
      headers: auth(token),
      cache: "no-store",
    });
    return res.ok
      ? ((await res.json()) as { storage: StorageInfo }).storage
      : null;
  } catch {
    return null;
  }
}

export type AnalyzeResult =
  { ok: true; media: MediaRecord } | { ok: false; error: string };

/** Measures loudness and pauses (a few seconds per hour of audio) and stores the result. */
export async function analyzeMedia(
  token: string,
  id: string,
): Promise<AnalyzeResult> {
  try {
    const res = await fetch(`/api/media/${id}/analyze`, {
      method: "POST",
      headers: auth(token),
    });
    const data = (await res.json().catch(() => ({}))) as {
      media?: MediaRecord;
      error?: string;
    };
    return res.ok && data.media
      ? { ok: true, media: data.media }
      : { ok: false, error: data.error ?? "failed" };
  } catch {
    return { ok: false, error: "network" };
  }
}
