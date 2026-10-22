// src/studio/watch/timecode.ts
// Timecodes for the editor: "mm:ss.mmm" for subtitles and "hh:mm:ss:ff" (frames) for cutting.

const pad = (n: number, w = 2) => String(Math.trunc(n)).padStart(w, "0");

/** "01:02:03.456" (hours only when needed unless `forceHours`). */
export function formatClock(ms: number, forceHours = false): string {
  const v = Math.max(0, Math.round(ms));
  const h = Math.floor(v / 3_600_000);
  const m = Math.floor((v % 3_600_000) / 60_000);
  const s = Math.floor((v % 60_000) / 1000);
  const base = `${pad(m)}:${pad(s)}.${pad(v % 1000, 3)}`;
  return h > 0 || forceHours ? `${pad(h)}:${base}` : base;
}

/** Accepts "90", "1:30", "01:30.5", "1:02:03.456" (comma or dot) -> ms, or null. */
export function parseClock(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!/^\d+(:\d{1,2}){0,2}(\.\d{1,3})?$/.test(t)) return null;
  const [main, frac = ""] = t.split(".") as [string, string?];
  const parts = main.split(":").map(Number);
  while (parts.length < 3) parts.unshift(0);
  const [h, m, s] = parts as [number, number, number];
  if (m > 59 || s > 59) {
    // "90" alone means 90 seconds: allow overflow only for the leading component
    if (parts.length === 3 && main.split(":").length === 1)
      return s * 1000 + Number(frac.padEnd(3, "0") || 0);
    return null;
  }
  return ((h * 60 + m) * 60 + s) * 1000 + Number(frac.padEnd(3, "0") || 0);
}

/** Frame-accurate timecode "hh:mm:ss:ff" at `fps` (non-drop frame). */
export function formatFrames(ms: number, fps: number): string {
  const rate = fps > 0 ? fps : 30;
  const totalFrames = Math.max(0, Math.round((ms / 1000) * rate));
  const whole = Math.floor(rate);
  const ff = totalFrames % whole;
  const totalSeconds = Math.floor(totalFrames / whole);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(ff)}`;
}

/** Parses "hh:mm:ss:ff" / "mm:ss:ff" / "ss:ff" back to ms at `fps`; falls back to parseClock. */
export function parseFrames(text: string, fps: number): number | null {
  const t = text.trim();
  const parts = t.split(":");
  if (
    parts.length >= 2 &&
    parts.length <= 4 &&
    parts.every((p) => /^\d+$/.test(p))
  ) {
    const rate = fps > 0 ? fps : 30;
    const nums = parts.map(Number);
    const ff = nums.pop() as number;
    const [h = 0, m = 0, s = 0] = [
      ...Array(3 - nums.length).fill(0),
      ...nums,
    ] as number[];
    return Math.round((h * 3600 + m * 60 + s) * 1000 + (ff / rate) * 1000);
  }
  return parseClock(t);
}

/** Frame index at a time. */
export function frameAt(ms: number, fps: number): number {
  return Math.round((ms / 1000) * (fps > 0 ? fps : 30));
}

/** Snap a time to the nearest frame boundary. */
export function snapToFrame(ms: number, fps: number): number {
  const rate = fps > 0 ? fps : 30;
  return Math.round(Math.round((ms / 1000) * rate) * (1000 / rate));
}

/** One frame in ms. */
export const frameMs = (fps: number): number => 1000 / (fps > 0 ? fps : 30);
