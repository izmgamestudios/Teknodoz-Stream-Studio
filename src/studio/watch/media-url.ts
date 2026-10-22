// src/studio/watch/media-url.ts
// Turns a pasted link into a typed, safe playable source. Only YouTube, Vimeo, plain https video
// files and our own room links are accepted; nothing else is ever put into an iframe/video src.

export type MediaSource =
  | { kind: "youtube"; id: string }
  /** whatever the channel is streaming right now (embed/live_stream?channel=UC…) */
  | { kind: "youtube-live"; channel: string }
  | { kind: "vimeo"; id: string }
  | { kind: "file"; url: string }
  | { kind: "room"; code: string }
  /** plain https audio file (mp3, wav, ogg, m4a, aac, flac, opus) */
  | { kind: "audio"; url: string }
  /** a file kept in this site's media library (served from /media/<id>) */
  | { kind: "upload"; id: string; media: "video" | "audio" };

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const YT_CHANNEL = /^UC[A-Za-z0-9_-]{22}$/;
const VIMEO_ID = /^\d{5,12}$/;
const ROOM_CODE = /^[A-HJ-NP-Z2-9]{6}$/;
const FILE_EXT = /\.(mp4|webm|ogv|m4v)$/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba)$/i;
const UPLOAD_ID = /^[a-f0-9]{16}$/;

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
  // a bare channel id (UC + 22 chars) means "this channel's live stream"
  if (YT_CHANNEL.test(text)) return { kind: "youtube-live", channel: text };
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
    if (first === "channel") {
      const ch = parts[1] ?? "";
      const tail = parts[2];
      return YT_CHANNEL.test(ch) && (tail === undefined || tail === "live")
        ? { kind: "youtube-live", channel: ch }
        : null;
    }
    if (first === "embed" && parts[1] === "live_stream") {
      const ch = u.searchParams.get("channel") ?? "";
      return YT_CHANNEL.test(ch) ? { kind: "youtube-live", channel: ch } : null;
    }
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
  if (AUDIO_EXT.test(u.pathname)) return { kind: "audio", url: u.toString() };
  return null;
}

/** Validates a source object that came from storage / the network. */
export function isMediaSource(v: unknown): v is MediaSource {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  switch (s["kind"]) {
    case "youtube":
      return typeof s["id"] === "string" && YT_ID.test(s["id"]);
    case "youtube-live":
      return typeof s["channel"] === "string" && YT_CHANNEL.test(s["channel"]);
    case "vimeo":
      return typeof s["id"] === "string" && VIMEO_ID.test(s["id"]);
    case "room":
      return typeof s["code"] === "string" && ROOM_CODE.test(s["code"]);
    case "file":
      return (
        typeof s["url"] === "string" &&
        parseMediaInput(s["url"])?.kind === "file"
      );
    case "audio":
      return (
        typeof s["url"] === "string" &&
        parseMediaInput(s["url"])?.kind === "audio"
      );
    case "upload":
      return (
        typeof s["id"] === "string" &&
        UPLOAD_ID.test(s["id"]) &&
        (s["media"] === "video" || s["media"] === "audio")
      );
    default:
      return false;
  }
}

export function embedUrl(s: MediaSource, autoplay = false): string | null {
  const ap = autoplay ? "1" : "0";
  if (s.kind === "youtube")
    return `https://www.youtube-nocookie.com/embed/${s.id}?enablejsapi=1&rel=0&playsinline=1&autoplay=${ap}`;
  if (s.kind === "youtube-live")
    return `https://www.youtube-nocookie.com/embed/live_stream?channel=${s.channel}&enablejsapi=1&rel=0&playsinline=1&autoplay=${ap}`;
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
    case "youtube-live":
      return `https://www.youtube.com/channel/${s.channel}/live`;
    case "vimeo":
      return `https://vimeo.com/${s.id}`;
    case "room":
      return `/r/${s.code}?as=viewer`;
    case "file":
    case "audio":
      return s.url;
    case "upload":
      return uploadUrl(s.id);
  }
}

export function uploadUrl(id: string): string {
  return `/media/${id}`;
}

/** Is this source played with an <audio> element (podcast / music) rather than video? */
export function isAudioSource(s: MediaSource | null): boolean {
  return s?.kind === "audio" || (s?.kind === "upload" && s.media === "audio");
}

/** Direct file URL for <video>/<audio>, or null for embeds and rooms. */
export function fileSrc(s: MediaSource): string | null {
  if (s.kind === "file" || s.kind === "audio") return s.url;
  if (s.kind === "upload") return uploadUrl(s.id);
  return null;
}
