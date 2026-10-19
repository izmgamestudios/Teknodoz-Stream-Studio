// src/studio/engine/download.ts
// Saving blobs from the browser (anchor + object URL) and building the recording bundle
// (video + chapters.txt + .srt). Everything touching the DOM happens inside functions only.
import {
  buildChaptersTxt,
  buildSrt,
  replaceControlChars,
  type ChapterOptions,
} from "./chapters";
import type { RecordingResult } from "./recorder";

export type DownloadErrorCode =
  /** no DOM / URL.createObjectURL (SSR, workers, very old browsers) */
  | "unsupported"
  /** the blob argument is not a Blob */
  | "invalid-blob"
  /** creating or clicking the download anchor failed */
  | "failed";

export class DownloadError extends Error {
  readonly code: DownloadErrorCode;

  constructor(code: DownloadErrorCode, message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "DownloadError";
    this.code = code;
  }
}

export interface BundleFile {
  name: string;
  blob: Blob;
}

export interface BundleOptions extends ChapterOptions {
  /**
   * Emit chapters.txt / .srt even when the recording has no user markers (they would only
   * contain the auto "Başlangıç" chapter). Default false.
   */
  includeEmptyChapters?: boolean;
}

export interface DownloadBundleOptions extends BundleOptions {
  /** Delay between consecutive downloads, ms. Default 250. */
  staggerMs?: number;
  /** How long object URLs stay valid after the click, ms. Default 30 000. */
  revokeDelayMs?: number;
}

const MAX_FILENAME_LENGTH = 120;
const DEFAULT_STAGGER_MS = 250;
const DEFAULT_REVOKE_DELAY_MS = 30_000;
const DEFAULT_BASENAME_PREFIX = "teknodoz";

// Characters that are illegal on Windows / macOS / Linux file systems (path separators included).
const RESERVED_CHARS = /[<>:"/\\|?*]+/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Cut to at most `max` UTF-16 units without splitting a surrogate pair. */
function truncateUnits(text: string, max: number): string {
  let out = "";
  for (const ch of text) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}

/**
 * Make an arbitrary string safe as a file name: whitespace collapses to single spaces, illegal
 * characters (`<>:"/\|?*`) become `-`, invisible / control characters vanish, leading dots,
 * hyphens and spaces and trailing dots and spaces are stripped, Windows reserved names get a `_`
 * prefix, and the length is bounded (a short extension survives). Never returns "".
 */
export function safeFilename(name: string, fallback = "kayit"): string {
  const input = typeof name === "string" ? name : "";
  // whitespace first (tabs / newlines become spaces), then drop the remaining invisible chars
  let s = replaceControlChars(input.normalize("NFC").replace(/\s+/g, " "), "")
    .replace(RESERVED_CHARS, "-")
    .replace(/\s+/g, " ")
    .replace(/^[.\s-]+/, "")
    .replace(/[.\s]+$/, "");

  if (s.length > MAX_FILENAME_LENGTH) {
    const dot = s.lastIndexOf(".");
    const ext = dot > 0 && s.length - dot <= 8 ? s.slice(dot) : "";
    const stem = truncateUnits(
      dot > 0 && ext !== "" ? s.slice(0, dot) : s,
      MAX_FILENAME_LENGTH - ext.length,
    );
    s = `${stem.trimEnd()}${ext}`;
  }

  if (s === "")
    return fallback === "kayit" ? fallback : safeFilename(fallback, "kayit");
  // "CON.txt" is reserved on Windows too: only the part before the first dot counts.
  const stem = (s.split(".")[0] ?? s).trim();
  if (WINDOWS_RESERVED.test(stem)) s = `_${s}`;
  return s;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** `prefix-YYYYMMDD-HHmmss` in local time, prefix sanitised. */
export function timestampName(
  prefix = DEFAULT_BASENAME_PREFIX,
  date: Date = new Date(),
): string {
  const d = Number.isFinite(date.getTime()) ? date : new Date(0);
  const stamp =
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
  const p = safeFilename(prefix, DEFAULT_BASENAME_PREFIX);
  return `${p}-${stamp}`;
}

/**
 * Trigger a browser download. The object URL is revoked after `revokeDelayMs` (large files
 * need the URL to outlive the click). Throws DownloadError when no DOM is available.
 */
export function downloadBlob(
  blob: Blob,
  filename: string,
  opts: { revokeDelayMs?: number } = {},
): void {
  if (typeof Blob === "undefined" || !(blob instanceof Blob)) {
    throw new DownloadError("invalid-blob", "İndirilecek veri geçersiz.");
  }
  if (
    typeof document === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    throw new DownloadError("unsupported", "Bu ortamda dosya indirilemez.");
  }
  const delay =
    typeof opts.revokeDelayMs === "number" && opts.revokeDelayMs >= 0
      ? opts.revokeDelayMs
      : DEFAULT_REVOKE_DELAY_MS;
  let url: string | null = null;
  let anchor: HTMLAnchorElement | null = null;
  try {
    url = URL.createObjectURL(blob);
    anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = safeFilename(filename);
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
  } catch (cause) {
    if (url !== null) URL.revokeObjectURL(url);
    throw new DownloadError("failed", "İndirme başlatılamadı.", cause);
  } finally {
    anchor?.remove();
  }
  const toRevoke = url;
  setTimeout(() => {
    try {
      URL.revokeObjectURL(toRevoke);
    } catch {
      // ignore
    }
  }, delay);
}

/**
 * Pure: the files of a finished recording. `<base>.<ext>` always; `<base>-chapters.txt` (YouTube
 * description block) and `<base>.srt` when the recording has markers (or
 * `includeEmptyChapters`). The .srt shares the video's base name so players pick it up.
 */
export function buildBundleFiles(
  result: RecordingResult,
  baseName?: string,
  opts: BundleOptions = {},
): BundleFile[] {
  const base = safeFilename(
    baseName ?? timestampName(),
    DEFAULT_BASENAME_PREFIX,
  );
  const files: BundleFile[] = [
    { name: `${base}.${result.ext}`, blob: result.blob },
  ];
  if (result.markers.length === 0 && !opts.includeEmptyChapters) return files;

  const chapterOpts: ChapterOptions = {};
  if (opts.introLabel !== undefined) chapterOpts.introLabel = opts.introLabel;
  if (opts.minChapterMs !== undefined)
    chapterOpts.minChapterMs = opts.minChapterMs;
  if (opts.mergeShort !== undefined) chapterOpts.mergeShort = opts.mergeShort;

  const txt = buildChaptersTxt(result.markers, result.durationMs, chapterOpts);
  const srt = buildSrt(result.markers, result.durationMs, chapterOpts);
  files.push({
    name: `${base}-chapters.txt`,
    blob: new Blob([txt], { type: "text/plain;charset=utf-8" }),
  });
  if (srt !== "") {
    files.push({
      name: `${base}.srt`,
      blob: new Blob([srt], { type: "application/x-subrip;charset=utf-8" }),
    });
  }
  return files;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Download video + chapters.txt + .srt, one file every ~250 ms so browsers do not block the
 * multi-download. Resolves with the downloaded file names.
 */
export async function downloadRecordingBundle(
  result: RecordingResult,
  baseName?: string,
  opts: DownloadBundleOptions = {},
): Promise<string[]> {
  const files = buildBundleFiles(result, baseName, opts);
  const gap =
    typeof opts.staggerMs === "number" && opts.staggerMs >= 0
      ? opts.staggerMs
      : DEFAULT_STAGGER_MS;
  const names: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file) continue;
    if (i > 0) await sleep(gap);
    downloadBlob(
      file.blob,
      file.name,
      opts.revokeDelayMs !== undefined
        ? { revokeDelayMs: opts.revokeDelayMs }
        : {},
    );
    names.push(file.name);
  }
  return names;
}
