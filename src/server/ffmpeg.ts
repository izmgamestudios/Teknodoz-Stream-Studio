// src/server/ffmpeg.ts
// Small ffmpeg helpers for the media library: capability probing and poster frames.
import { execFile } from "node:child_process";

export interface FfmpegCaps {
  available: boolean;
  /** libass "subtitles" filter (burned-in captions) */
  subtitles: boolean;
  loudnorm: boolean;
  libx264: boolean;
}

const NONE: FfmpegCaps = {
  available: false,
  subtitles: false,
  loudnorm: false,
  libx264: false,
};

function run(
  bin: string,
  args: string[],
  timeout = 15_000,
): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      { timeout, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => resolve(err ? null : stdout),
    );
  });
}

/** Looks at the installed ffmpeg once (cached by the caller). */
export async function ffmpegCapabilities(bin = "ffmpeg"): Promise<FfmpegCaps> {
  const version = await run(bin, ["-version"]);
  if (version === null) return NONE;
  const [filters, encoders] = await Promise.all([
    run(bin, ["-hide_banner", "-filters"]),
    run(bin, ["-hide_banner", "-encoders"]),
  ]);
  return {
    available: true,
    subtitles: /\bsubtitles\b/.test(filters ?? ""),
    loudnorm: /\bloudnorm\b/.test(filters ?? ""),
    libx264: /\blibx264\b/.test(encoders ?? ""),
  };
}

/** Writes a JPEG poster frame (about 1 s in, 640 px wide). Best effort: false on any failure. */
export async function ffmpegPoster(
  bin: string,
  input: string,
  out: string,
  atSec = 1,
): Promise<boolean> {
  for (const ss of [atSec, 0]) {
    const r = await run(
      bin,
      [
        "-y",
        "-loglevel",
        "error",
        "-ss",
        String(ss),
        "-i",
        input,
        "-frames:v",
        "1",
        "-vf",
        "scale=640:-2",
        "-q:v",
        "4",
        out,
      ],
      30_000,
    );
    if (r !== null) return true;
  }
  return false;
}
