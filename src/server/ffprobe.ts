// src/server/ffprobe.ts
// ffprobe wrapper: duration, size and stream kinds of a media file. Returns null when ffprobe is
// not installed (callers then trust the declared MIME type).
import { execFile } from "node:child_process";

import type { ProbeResult, Prober } from "./media";

interface FfprobeJson {
  format?: { duration?: string };
  streams?: {
    codec_type?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
  }[];
}

/** "30000/1001" -> 29.97; null for "0/0" or junk. */
export function parseRate(text: string | undefined): number | null {
  const m = /^(\d+)\/(\d+)$/.exec(text ?? "");
  if (!m || Number(m[2]) === 0) return null;
  const v = Number(m[1]) / Number(m[2]);
  return v > 0 && v < 1000 ? Math.round(v * 1000) / 1000 : null;
}

export function ffprobeProber(binary = "ffprobe"): Prober {
  let missing = false;
  return (file) =>
    new Promise<ProbeResult | null>((resolve) => {
      if (missing) return resolve(null);
      execFile(
        binary,
        [
          "-v",
          "error",
          "-print_format",
          "json",
          "-show_format",
          "-show_streams",
          file,
        ],
        { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout) => {
          if (err) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") {
              missing = true;
              return resolve(null);
            }
            // ffprobe ran but could not read the file: it is not media
            return resolve({
              durationMs: null,
              width: null,
              height: null,
              hasVideo: false,
              hasAudio: false,
              fps: null,
            });
          }
          try {
            const j = JSON.parse(stdout) as FfprobeJson;
            const video = j.streams?.find((s) => s.codec_type === "video");
            const d = Number(j.format?.duration);
            resolve({
              durationMs:
                Number.isFinite(d) && d > 0 ? Math.round(d * 1000) : null,
              width: video?.width ?? null,
              height: video?.height ?? null,
              fps: parseRate(video?.avg_frame_rate),
              hasVideo: !!video,
              hasAudio: !!j.streams?.some((s) => s.codec_type === "audio"),
            });
          } catch {
            resolve(null);
          }
        },
      );
    });
}
