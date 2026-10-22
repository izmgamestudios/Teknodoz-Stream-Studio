// src/studio/watch/media-client.ts
// Browser client for the media library (/api/media). All calls need the admin token.
export interface Chapter {
  t: number;
  label: string;
}

export interface MediaRecord {
  id: string;
  kind: "video" | "audio";
  mime: string;
  file: string;
  size: number;
  title: string;
  filename: string;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  chapters: Chapter[];
  captions: { lang: string; label: string }[];
  hasPoster: boolean;
  origin: "studio" | "upload" | "edit";
  parentId: string | null;
  createdAt: string;
}

export type UploadResult =
  | { ok: true; media: MediaRecord }
  | {
      ok: false;
      reason:
        "unauthorized" | "too-large" | "unsupported" | "network" | "server";
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
    xhr.setRequestHeader("authorization", `Bearer ${token}`);
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

const auth = (token: string): HeadersInit => ({
  authorization: `Bearer ${token}`,
});

export async function listMedia(token: string): Promise<MediaRecord[] | null> {
  try {
    const res = await fetch("/api/media", {
      headers: auth(token),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return ((await res.json()) as { media: MediaRecord[] }).media;
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
