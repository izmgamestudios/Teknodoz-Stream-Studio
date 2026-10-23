// src/server/seo/model.ts
// Item -> what a page needs: player source, durations, summary / description fallbacks,
// transcript cues, absolute URLs. Pure except for the injected VTT reader.
import { blocksToText } from "../../shared/blocks";
import type { EntityType } from "../../shared/schema-registry";
import { parseCues, type Cue } from "../../studio/watch/cues";
import { embedUrl, parseMediaInput } from "../../studio/watch/media-url";
import type { ContentRow } from "../content-model";
import { absUrl, type SiteConfig } from "./site";

export const TYPE_PATH: Record<string, string> = {
  story: "stories",
  video: "videos",
  podcast: "podcasts",
};
export const PATH_TYPE: Record<string, EntityType> = {
  stories: "story",
  videos: "video",
  podcasts: "podcast",
};

export const itemPath = (type: EntityType, slug: string): string =>
  `/library/${TYPE_PATH[type]}/${slug}`;
export const listPath = (type: EntityType): string =>
  `/library/${TYPE_PATH[type]}`;

export interface MediaInfo {
  kind: "youtube" | "vimeo" | "video" | "audio" | "none";
  /** iframe src for embeds */
  embed: string;
  /** absolute file URL for <video> / <audio> */
  src: string;
  mime: string;
  /** page the media lives on (for JSON-LD contentUrl / embedUrl) */
  link: string;
  /** thumbnail from the provider when no poster is set */
  thumb: string;
}

const MIME: [RegExp, string][] = [
  [/\.mp4(\?|$)/i, "video/mp4"],
  [/\.webm(\?|$)/i, "video/webm"],
  [/\.m4v(\?|$)/i, "video/mp4"],
  [/\.mp3(\?|$)/i, "audio/mpeg"],
  [/\.m4a(\?|$)/i, "audio/mp4"],
  [/\.ogg(\?|$)|\.opus(\?|$)/i, "audio/ogg"],
  [/\.wav(\?|$)/i, "audio/wav"],
];

export function mediaOf(row: ContentRow, site: SiteConfig): MediaInfo {
  const none: MediaInfo = {
    kind: "none",
    embed: "",
    src: "",
    mime: "",
    link: "",
    thumb: "",
  };
  const raw = row.meta["media_url"];
  if (typeof raw !== "string" || raw === "") return none;
  const legacy = row.meta["legacy"] as
    { source?: { kind?: string; media?: string } } | undefined;
  const wantsAudio =
    row.type === "podcast" ||
    legacy?.source?.media === "audio" ||
    legacy?.source?.kind === "audio";

  if (raw.startsWith("/media/")) {
    const abs = absUrl(site, raw);
    return {
      kind: wantsAudio ? "audio" : "video",
      embed: "",
      src: abs,
      mime: "",
      link: abs,
      thumb: "",
    };
  }
  const parsed = parseMediaInput(raw);
  if (parsed?.kind === "youtube" || parsed?.kind === "vimeo") {
    const embed = embedUrl(parsed) ?? "";
    return {
      kind: parsed.kind,
      embed: embed.replace("enablejsapi=1&", ""),
      src: "",
      mime: "",
      link: raw,
      thumb:
        parsed.kind === "youtube"
          ? `https://i.ytimg.com/vi/${parsed.id}/hqdefault.jpg`
          : "",
    };
  }
  const abs = absUrl(site, raw);
  if (!abs) return none;
  const mime = MIME.find(([re]) => re.test(abs))?.[1] ?? "";
  const audio = wantsAudio || mime.startsWith("audio/");
  return {
    kind: audio ? "audio" : "video",
    embed: "",
    src: abs,
    mime,
    link: abs,
    thumb: "",
  };
}

export const durationIso = (sec: number): string => {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `PT${h ? `${h}H` : ""}${m ? `${m}M` : ""}${s % 60 || (!h && !m) ? `${s % 60}S` : ""}`;
};

export const durationOf = (row: ContentRow): number | null => {
  const d = row.meta["duration_sec"];
  return typeof d === "number" && d > 0 ? d : null;
};

export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20))}…`;
}

export const titleOf = (row: ContentRow, siteName: string): string => {
  const base = row.seo_title || row.title;
  return base.toLowerCase().includes(siteName.toLowerCase())
    ? clip(base, 70)
    : clip(`${base} | ${siteName}`, 70);
};

export const descriptionOf = (row: ContentRow): string =>
  clip(
    row.seo_description ||
      row.summary ||
      blocksToText(row.body_blocks) ||
      row.title,
    160,
  );

export const posterOf = (
  row: ContentRow,
  site: SiteConfig,
  media: MediaInfo,
): string =>
  absUrl(site, row.og_image) ||
  absUrl(site, row.meta["poster_url"]) ||
  media.thumb ||
  "";

export function faqOf(row: ContentRow): { q: string; a: string }[] {
  const f = row.meta["faq"];
  return Array.isArray(f)
    ? f.filter(
        (x): x is { q: string; a: string } =>
          typeof x?.q === "string" && typeof x?.a === "string",
      )
    : [];
}

/** Where the transcript (WebVTT) of an item lives, if anywhere. */
export function transcriptPath(row: ContentRow): string | null {
  const t = row.meta["transcript_url"];
  if (typeof t === "string" && t.startsWith("/media/")) return t;
  const legacy = row.meta["legacy"] as
    { captions?: { url?: string; lang?: string }[] } | undefined;
  const c =
    legacy?.captions?.find((x) => x.lang === row.locale) ??
    legacy?.captions?.[0];
  return typeof c?.url === "string" && c.url.startsWith("/media/")
    ? c.url
    : null;
}

export async function transcriptCues(
  row: ContentRow,
  read: (path: string) => Promise<string | null>,
): Promise<Cue[]> {
  const p = transcriptPath(row);
  if (!p) return [];
  const text = await read(p).catch(() => null);
  return text ? parseCues(text).slice(0, 2000) : [];
}

export const fmtTime = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
};
