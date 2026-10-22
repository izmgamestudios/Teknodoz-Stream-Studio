// src/studio/watch/media-url.ts
// Turns a pasted link into a typed, safe playable source. Only YouTube, Vimeo, plain https video
// files and our own room links are accepted; nothing else is ever put into an iframe/video src.

export type MediaSource =
  | { kind: "youtube"; id: string }
  | { kind: "vimeo"; id: string }
  | { kind: "file"; url: string }
  | { kind: "room"; code: string };

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{5,12}$/;
const ROOM_CODE = /^[A-HJ-NP-Z2-9]{6}$/;
const FILE_EXT = /\.(mp4|webm|ogv|m4v)$/i;

const YT_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

export function parseMediaInput(
  input: string,
  siteHost?: string,
): MediaSource | null {
  const text = input.trim();
  if (text === "" || text.length > 2000) return null;
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase();

  if (host === "youtu.be") {
    const id = u.pathname.split("/")[1] ?? "";
    return YT_ID.test(id) ? { kind: "youtube", id } : null;
  }
  if (YT_HOSTS.has(host)) {
    const parts = u.pathname.split("/").filter(Boolean);
    const first = parts[0];
    let id: string | null = null;
    if (first === "watch") id = u.searchParams.get("v");
    else if (first === "embed" || first === "shorts" || first === "live")
      id = parts[1] ?? null;
    return id && YT_ID.test(id) ? { kind: "youtube", id } : null;
  }
  if (
    host === "vimeo.com" ||
    host === "www.vimeo.com" ||
    host === "player.vimeo.com"
  ) {
    const id = u.pathname
      .split("/")
      .filter(Boolean)
      .find((p) => VIMEO_ID.test(p));
    return id ? { kind: "vimeo", id } : null;
  }
  if (siteHost && host === siteHost.toLowerCase()) {
    const m = /^\/r\/([A-Za-z0-9]{6})\/?$/.exec(u.pathname);
    const code = m?.[1]?.toUpperCase() ?? "";
    if (ROOM_CODE.test(code)) return { kind: "room", code };
  }
  if (FILE_EXT.test(u.pathname)) return { kind: "file", url: u.toString() };
  return null;
}

/** Validates a source object that came from storage / the network. */
export function isMediaSource(v: unknown): v is MediaSource {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  switch (s["kind"]) {
    case "youtube":
      return typeof s["id"] === "string" && YT_ID.test(s["id"]);
    case "vimeo":
      return typeof s["id"] === "string" && VIMEO_ID.test(s["id"]);
    case "room":
      return typeof s["code"] === "string" && ROOM_CODE.test(s["code"]);
    case "file":
      return (
        typeof s["url"] === "string" &&
        parseMediaInput(s["url"])?.kind === "file"
      );
    default:
      return false;
  }
}

export function embedUrl(s: MediaSource, autoplay = false): string | null {
  const ap = autoplay ? "1" : "0";
  if (s.kind === "youtube")
    return `https://www.youtube-nocookie.com/embed/${s.id}?enablejsapi=1&rel=0&playsinline=1&autoplay=${ap}`;
  if (s.kind === "vimeo")
    return `https://player.vimeo.com/video/${s.id}?autoplay=${ap}&dnt=1`;
  return null;
}

export function thumbnailUrl(s: MediaSource): string | null {
  return s.kind === "youtube"
    ? `https://i.ytimg.com/vi/${s.id}/hqdefault.jpg`
    : null;
}

export function sourceLink(s: MediaSource): string {
  switch (s.kind) {
    case "youtube":
      return `https://www.youtube.com/watch?v=${s.id}`;
    case "vimeo":
      return `https://vimeo.com/${s.id}`;
    case "room":
      return `/r/${s.code}?as=viewer`;
    case "file":
      return s.url;
  }
}
