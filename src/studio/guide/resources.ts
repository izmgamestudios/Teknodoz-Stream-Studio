// src/studio/guide/resources.ts
// Guide resources the owner configures in `resources-config.ts`: Google Drive / Docs PDFs, YouTube
// videos and other links. Every URL is parsed and rebuilt from its parts (never echoed as typed),
// so only well-formed https links on the expected hosts reach an `href` or an iframe `src`.

export interface PdfInput {
  title: string;
  url: string;
}
export interface VideoInput {
  title: string;
  url: string;
  /** shown on the card, e.g. "4:30" */
  duration?: string;
}
export interface LinkInput {
  title: string;
  url: string;
  note?: string;
}
export interface ResourcesConfig {
  pdf: readonly PdfInput[];
  videos: readonly VideoInput[];
  links: readonly LinkInput[];
}

export type ResourceProblem =
  | "invalid"
  | "not-https"
  | "credentials"
  | "host"
  | "id"
  | "too-long"
  | "title";

export interface ResolvedPdf {
  title: string;
  /** opens in a new tab */
  openUrl: string;
  /** iframe-able preview, only for Google Drive / Docs files */
  embedUrl: string | null;
}
export interface ResolvedVideo {
  title: string;
  duration?: string;
  videoId: string;
  watchUrl: string;
  /** privacy-enhanced embed; the page only loads it after a click */
  embedUrl: string;
}
export interface ResolvedLink {
  title: string;
  url: string;
  note?: string;
}
export interface ResourceIssue {
  kind: "pdf" | "video" | "link";
  index: number;
  problem: ResourceProblem;
}
export interface ResolvedResources {
  pdf: ResolvedPdf[];
  videos: ResolvedVideo[];
  links: ResolvedLink[];
  issues: ResourceIssue[];
}

const ID = /^[A-Za-z0-9_-]{10,128}$/;
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const MAX_URL = 500;
const MAX_TITLE = 120;

type Parsed = { ok: true; url: URL } | { ok: false; problem: ResourceProblem };

function parseHttps(raw: string): Parsed {
  const s = raw.trim();
  if (s.length > MAX_URL) return { ok: false, problem: "too-long" };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, problem: "invalid" };
  }
  if (u.protocol !== "https:") return { ok: false, problem: "not-https" };
  if (u.username || u.password) return { ok: false, problem: "credentials" };
  return { ok: true, url: u };
}

function cleanTitle(t: string): string | null {
  const s = t.replace(/\s+/g, " ").trim();
  return s.length === 0 || s.length > MAX_TITLE ? null : s;
}

/* ------------------------------------------------------------------ */
/* Google Drive / Docs                                                 */
/* ------------------------------------------------------------------ */

const DRIVE_HOSTS = ["drive.google.com", "docs.google.com"];

/** `/file/d/ID/view`, `open?id=ID`, `uc?id=ID`, `/document/d/ID/edit` -> ids and kind. */
export function driveRef(
  u: URL,
): { kind: "file" | "document" | "presentation"; id: string } | null {
  if (!DRIVE_HOSTS.includes(u.hostname)) return null;
  const m = /^\/(file|document|presentation)\/d\/([A-Za-z0-9_-]+)/.exec(
    u.pathname,
  );
  if (m) {
    const id = m[2] as string;
    return ID.test(id)
      ? {
          kind:
            m[1] === "file" ? "file" : (m[1] as "document" | "presentation"),
          id,
        }
      : null;
  }
  if (
    u.hostname === "drive.google.com" &&
    (u.pathname === "/open" || u.pathname === "/uc")
  ) {
    const id = u.searchParams.get("id") ?? "";
    return ID.test(id) ? { kind: "file", id } : null;
  }
  return null;
}

export function resolvePdf(
  input: PdfInput,
  siteHost = "",
): { ok: true; value: ResolvedPdf } | { ok: false; problem: ResourceProblem } {
  const title = cleanTitle(input.title);
  if (!title) return { ok: false, problem: "title" };
  const p = parseHttps(input.url);
  if (!p.ok) return p;
  const ref = driveRef(p.url);
  if (ref) {
    const base =
      ref.kind === "file"
        ? `https://drive.google.com/file/d/${ref.id}`
        : `https://docs.google.com/${ref.kind}/d/${ref.id}`;
    return {
      ok: true,
      value: {
        title,
        openUrl: ref.kind === "file" ? `${base}/view` : `${base}/edit`,
        embedUrl: `${base}/preview`,
      },
    };
  }
  // a plain .pdf link on GitHub, the site itself or Drive's own download host is fine to open
  const okHost =
    p.url.hostname === "github.com" ||
    p.url.hostname === "raw.githubusercontent.com" ||
    (siteHost !== "" && p.url.hostname === siteHost);
  if (okHost && /\.pdf$/i.test(p.url.pathname))
    return {
      ok: true,
      value: { title, openUrl: p.url.toString(), embedUrl: null },
    };
  return {
    ok: false,
    problem: DRIVE_HOSTS.includes(p.url.hostname) ? "id" : "host",
  };
}

/* ------------------------------------------------------------------ */
/* YouTube                                                             */
/* ------------------------------------------------------------------ */

const YT_HOSTS = [
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtube-nocookie.com",
  "youtube-nocookie.com",
];

/** `90`, `1m30s`, `1h2m3s` -> seconds (0 when unparsable). */
export function parseStart(v: string | null): number {
  if (!v) return 0;
  if (/^\d{1,9}$/.test(v)) return Number(v);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(v);
  if (!m || (!m[1] && !m[2] && !m[3])) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

export function youtubeRef(u: URL): { id: string; start: number } | null {
  if (!YT_HOSTS.includes(u.hostname)) return null;
  let id = "";
  if (u.hostname === "youtu.be") id = u.pathname.slice(1).split("/")[0] ?? "";
  else if (u.pathname === "/watch") id = u.searchParams.get("v") ?? "";
  else {
    const m = /^\/(embed|shorts|live|v)\/([^/?#]+)/.exec(u.pathname);
    if (m) id = m[2] as string;
  }
  if (!YT_ID.test(id)) return null;
  const start = Math.min(
    parseStart(u.searchParams.get("t") ?? u.searchParams.get("start")),
    86_400,
  );
  return { id, start };
}

export function resolveVideo(
  input: VideoInput,
):
  { ok: true; value: ResolvedVideo } | { ok: false; problem: ResourceProblem } {
  const title = cleanTitle(input.title);
  if (!title) return { ok: false, problem: "title" };
  const p = parseHttps(input.url);
  if (!p.ok) return p;
  if (!YT_HOSTS.includes(p.url.hostname)) return { ok: false, problem: "host" };
  const ref = youtubeRef(p.url);
  if (!ref) return { ok: false, problem: "id" };
  const t = ref.start > 0 ? `&t=${ref.start}s` : "";
  const s = ref.start > 0 ? `&start=${ref.start}` : "";
  const duration = input.duration?.replace(/\s+/g, " ").trim().slice(0, 12);
  return {
    ok: true,
    value: {
      title,
      ...(duration ? { duration } : {}),
      videoId: ref.id,
      watchUrl: `https://www.youtube.com/watch?v=${ref.id}${t}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${ref.id}?rel=0&modestbranding=1${s}`,
    },
  };
}

/* ------------------------------------------------------------------ */

export function resolveLink(
  input: LinkInput,
): { ok: true; value: ResolvedLink } | { ok: false; problem: ResourceProblem } {
  const title = cleanTitle(input.title);
  if (!title) return { ok: false, problem: "title" };
  const p = parseHttps(input.url);
  if (!p.ok) return p;
  const note = input.note?.replace(/\s+/g, " ").trim().slice(0, 200);
  return {
    ok: true,
    value: { title, url: p.url.toString(), ...(note ? { note } : {}) },
  };
}

export function resolveResources(
  cfg: ResourcesConfig,
  siteUrl = "",
): ResolvedResources {
  let host = "";
  try {
    if (siteUrl) host = new URL(siteUrl).hostname;
  } catch {
    host = "";
  }
  const out: ResolvedResources = { pdf: [], videos: [], links: [], issues: [] };
  cfg.pdf.forEach((x, index) => {
    const r = resolvePdf(x, host);
    if (r.ok) out.pdf.push(r.value);
    else out.issues.push({ kind: "pdf", index, problem: r.problem });
  });
  cfg.videos.forEach((x, index) => {
    const r = resolveVideo(x);
    if (r.ok) out.videos.push(r.value);
    else out.issues.push({ kind: "video", index, problem: r.problem });
  });
  cfg.links.forEach((x, index) => {
    const r = resolveLink(x);
    if (r.ok) out.links.push(r.value);
    else out.issues.push({ kind: "link", index, problem: r.problem });
  });
  return out;
}
