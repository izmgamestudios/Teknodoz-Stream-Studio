// src/server/vtt.ts
// WebVTT helpers: accept WebVTT or SRT (what the Whisper CLIs and subtitle editors produce),
// return clean, bounded WebVTT or null when the text is not subtitles.

export const MAX_VTT_BYTES = 2 * 1024 * 1024;

const TIME = /(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{3}/;
const CUE_LINE = new RegExp(
  `^\\s*(${TIME.source})\\s*-->\\s*(${TIME.source})(.*)$`,
);

/** Number of cues (lines with `-->`). */
export function cueCount(vtt: string): number {
  return vtt.split("\n").filter((l) => CUE_LINE.test(l)).length;
}

/** "1:02:03,456" / "02:03.456" -> "01:02:03.456" */
function fixTime(t: string): string {
  const [hms, ms] = t.replace(",", ".").split(".") as [string, string];
  const parts = hms.split(":");
  while (parts.length < 3) parts.unshift("00");
  return `${parts.map((p) => p.padStart(2, "0")).join(":")}.${ms}`;
}

/**
 * Normalises WebVTT or SRT text to WebVTT: strips BOM / NULs / CR, converts SRT timestamps,
 * drops numeric SRT cue ids, requires at least one cue and caps the size.
 */
export function normalizeVtt(input: string): string | null {
  if (typeof input !== "string" || input.length > MAX_VTT_BYTES) return null;
  const noBom = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const text = noBom
    // eslint-disable-next-line no-control-regex
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (text === "") return null;

  const lines = text.split("\n");
  const body = /^WEBVTT/.test(lines[0] ?? "") ? lines.slice(1) : lines;
  const out: string[] = ["WEBVTT", ""];
  let cues = 0;
  for (let i = 0; i < body.length; i++) {
    const line = body[i] as string;
    const m = CUE_LINE.exec(line);
    if (m) {
      // an SRT numeric id on the previous line is not needed
      if (/^\d+$/.test(out[out.length - 1] ?? "")) out.pop();
      out.push(
        `${fixTime(m[1] as string)} --> ${fixTime(m[3] as string)}${m[5] ?? ""}`,
      );
      cues++;
    } else if (/^\d+$/.test(line.trim()) && TIME.test(body[i + 1] ?? "")) {
      // SRT cue id: keep it out
    } else if (
      /^(NOTE|STYLE|REGION)\b/.test(line) &&
      out[out.length - 1] === ""
    ) {
      out.push(line);
    } else {
      // cue text must not contain "-->" (would start a new cue) or "<script" style markup
      out.push(line.replace(/-->/g, "->").replace(/<\s*script/gi, "<"));
    }
  }
  if (cues === 0) return null;
  return `${out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()}\n`;
}

/** Shifts every cue by `offsetMs` (negative = earlier); cues that end before 0 are dropped. */
export function shiftVtt(vtt: string, offsetMs: number): string {
  const toMs = (t: string): number => {
    const [h, m, rest] = t.split(":") as [string, string, string];
    const [s, ms] = rest.split(".") as [string, string];
    return ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000 + Number(ms);
  };
  const fmt = (ms: number): string => {
    const v = Math.max(0, Math.round(ms));
    const h = Math.floor(v / 3_600_000);
    const m = Math.floor((v % 3_600_000) / 60_000);
    const s = Math.floor((v % 60_000) / 1000);
    const p = (n: number, w = 2) => String(n).padStart(w, "0");
    return `${p(h)}:${p(m)}:${p(s)}.${p(v % 1000, 3)}`;
  };
  const blocks = vtt.replace(/^WEBVTT\n*/, "").split(/\n\n+/);
  const kept: string[] = [];
  for (const b of blocks) {
    const lines = b.split("\n");
    const idx = lines.findIndex((l) => CUE_LINE.test(l));
    if (idx < 0) {
      if (b.trim()) kept.push(b);
      continue;
    }
    const m = CUE_LINE.exec(lines[idx] as string)!;
    const start = toMs(fixTime(m[1] as string)) + offsetMs;
    const end = toMs(fixTime(m[3] as string)) + offsetMs;
    if (end <= 0) continue;
    lines[idx] = `${fmt(start)} --> ${fmt(end)}${m[5] ?? ""}`;
    kept.push(lines.join("\n"));
  }
  return `WEBVTT\n\n${kept.join("\n\n")}\n`;
}

/** "00:01:02.345" -> "00:01:02,345" */
const srtTime = (t: string): string => fixTime(t).replace(".", ",");

/**
 * WebVTT -> SubRip. Cue settings, NOTE/STYLE/REGION blocks and voice/class tags are dropped,
 * `<i> <b> <u>` stay (SRT players understand them); cues are numbered from 1.
 */
export function vttToSrt(vtt: string): string {
  const blocks = vtt
    .replace(/\r\n?/g, "\n")
    .replace(/^\uFEFF?WEBVTT[^\n]*\n*/, "")
    .split(/\n\n+/);
  const out: string[] = [];
  for (const b of blocks) {
    const lines = b.split("\n");
    const idx = lines.findIndex((l) => CUE_LINE.test(l));
    if (idx < 0) continue;
    const m = CUE_LINE.exec(lines[idx] as string)!;
    const text = lines
      .slice(idx + 1)
      .join("\n")
      .replace(/<\/?v(?:\s[^>]*)?>/gi, "")
      .replace(/<\/?c(?:\.[^>\s]*)?(?:\s[^>]*)?>/gi, "")
      .replace(/<\d{1,2}:\d{2}[.:]\d{3}>/g, "")
      .trim();
    if (!text) continue;
    out.push(
      `${out.length + 1}\n${srtTime(m[1] as string)} --> ${srtTime(m[3] as string)}\n${text}`,
    );
  }
  return out.length ? `${out.join("\n\n")}\n` : "";
}
