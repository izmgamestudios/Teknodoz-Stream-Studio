// src/server/live-policy.ts
// Pure policy helpers of the RTMP(S) live bridge: configuration, destination validation
// (host allowlist, SSRF guard), secret redaction and the ffmpeg command line.
// No Node APIs are imported at module level: this file is bundled for every deployment
// target (including serverless ones where the live bridge simply stays disabled).

export interface LiveConfig {
  /** `LIVE_ADMIN_TOKEN` (>= 16 chars). null = the whole feature is disabled. */
  token: string | null;
  ffmpegPath: string;
  /** extra host patterns (`LIVE_ALLOWED_HOSTS`, comma separated, `*.example.com` allowed) */
  allowedHosts: readonly string[];
  /** `LIVE_ALLOW_ANY_HOST=1`: any public host (the token holder is trusted) */
  allowAnyHost: boolean;
  /** `LIVE_ALLOW_PRIVATE=1`: private/loopback targets, e.g. a local nginx-rtmp / SRS ingest */
  allowPrivate: boolean;
  maxMinutes: number;
  maxVideoKbps: number;
  x264Preset: string;
  /** stop the stream when no media chunk arrived for this long */
  idleStopMs: number;
}

export const MIN_TOKEN_CHARS = 16;

const PRESETS = new Set([
  "ultrafast",
  "superfast",
  "veryfast",
  "faster",
  "fast",
  "medium",
]);

function int(
  v: string | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  const n = Number(v);
  return Number.isFinite(n)
    ? Math.min(max, Math.max(min, Math.floor(n)))
    : fallback;
}

export function liveConfigFromEnv(
  env: Record<string, string | undefined>,
): LiveConfig {
  const token = (env["LIVE_ADMIN_TOKEN"] ?? "").trim();
  const preset = (env["LIVE_X264_PRESET"] ?? "veryfast").trim();
  return {
    token: token.length >= MIN_TOKEN_CHARS ? token : null,
    ffmpegPath: (env["LIVE_FFMPEG_PATH"] ?? "ffmpeg").trim() || "ffmpeg",
    allowedHosts: (env["LIVE_ALLOWED_HOSTS"] ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
    allowAnyHost: env["LIVE_ALLOW_ANY_HOST"] === "1",
    allowPrivate: env["LIVE_ALLOW_PRIVATE"] === "1",
    maxMinutes: int(env["LIVE_MAX_MINUTES"], 360, 1, 24 * 60),
    maxVideoKbps: int(env["LIVE_MAX_VIDEO_KBPS"], 9000, 500, 50_000),
    x264Preset: PRESETS.has(preset) ? preset : "veryfast",
    idleStopMs: int(env["LIVE_IDLE_STOP_SECONDS"], 20, 5, 300) * 1000,
  };
}

/** True when the env defines a token but it is too short to be accepted. */
export function tokenTooShort(
  env: Record<string, string | undefined>,
): boolean {
  const t = (env["LIVE_ADMIN_TOKEN"] ?? "").trim();
  return t.length > 0 && t.length < MIN_TOKEN_CHARS;
}

/* ------------------------------------------------------------------ */
/* Hosts                                                               */
/* ------------------------------------------------------------------ */

/**
 * Built-in ingest domains of the supported platforms. Instagram, TikTok, Kick and Twitch hand
 * out account/session specific server URLs, hence the wildcards. Anything else needs
 * `LIVE_ALLOWED_HOSTS` or `LIVE_ALLOW_ANY_HOST=1`.
 */
export const BUILTIN_HOSTS: readonly string[] = [
  "*.youtube.com",
  "live-api-s.facebook.com",
  "*.facebook.com",
  "*.instagram.com",
  "*.fbcdn.net",
  "*.twitch.tv",
  "*.live-video.net",
  "*.kick.com",
  "*.tiktokcdn.com",
  "*.tiktokcdn-us.com",
  "*.tiktok.com",
];

export function hostMatches(host: string, pattern: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  const p = pattern.toLowerCase();
  if (p.startsWith("*."))
    return h.endsWith(p.slice(1)) && h.length > p.length - 1;
  return h === p;
}

export function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

/** loopback / private / link-local / CGNAT / ULA / multicast / unspecified (v4 + v6). */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase();
  const m4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v);
  if (m4) {
    const [a, b] = [Number(m4[1]), Number(m4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (v === "::" || v === "::1") return true;
  return (
    v.startsWith("fc") ||
    v.startsWith("fd") ||
    v.startsWith("fe8") ||
    v.startsWith("fe9") ||
    v.startsWith("fea") ||
    v.startsWith("feb") ||
    v.startsWith("ff") ||
    v.startsWith("::ffff:") // other v4-mapped forms: refuse, be strict
  );
}

/* ------------------------------------------------------------------ */
/* Destinations                                                        */
/* ------------------------------------------------------------------ */

export type DestinationErrorCode =
  | "bad-url"
  | "bad-scheme"
  | "bad-key"
  | "host-not-allowed"
  | "port-not-allowed"
  | "private-address";

export class DestinationError extends Error {
  constructor(readonly code: DestinationErrorCode) {
    super(code);
  }
}

const SERVER_RE =
  /^rtmps?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?(?:\/[A-Za-z0-9._~%+=\-/]*)?(?:\?[A-Za-z0-9._~%+=&\-/]*)?$/;
const KEY_RE = /^[A-Za-z0-9._~%+=&?-]{4,512}$/;
const PORTS = new Set([80, 443, 1935, 1936, 3443, 8080, 8443]);

export interface ParsedDestination {
  /** `rtmps://host[:port]/app/key` handed to ffmpeg: contains the secret, never log it */
  publishUrl: string;
  host: string;
  secure: boolean;
  /** strings that must be scrubbed from any text shown to a client */
  secrets: string[];
}

export interface HostResolver {
  (host: string): Promise<string[]>;
}

/** Validate one destination. Throws `DestinationError`. */
export async function parseDestination(
  server: string,
  key: string,
  cfg: Pick<LiveConfig, "allowedHosts" | "allowAnyHost" | "allowPrivate">,
  resolve: HostResolver,
): Promise<ParsedDestination> {
  const s = server.trim();
  if (!SERVER_RE.test(s)) throw new DestinationError("bad-url");
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new DestinationError("bad-url");
  }
  if (u.protocol !== "rtmps:" && u.protocol !== "rtmp:")
    throw new DestinationError("bad-scheme");
  if (u.username || u.password) throw new DestinationError("bad-url");
  const k = key.trim();
  if (!KEY_RE.test(k)) throw new DestinationError("bad-key");

  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) throw new DestinationError("bad-url");
  const port = u.port ? Number(u.port) : u.protocol === "rtmps:" ? 443 : 1935;
  if (!cfg.allowPrivate && !PORTS.has(port))
    throw new DestinationError("port-not-allowed");

  const ip = isIpLiteral(host);
  const listed = [...BUILTIN_HOSTS, ...cfg.allowedHosts].some((p) =>
    hostMatches(host, p),
  );
  if (!listed && !cfg.allowAnyHost && !cfg.allowPrivate)
    throw new DestinationError("host-not-allowed");
  if (ip && !cfg.allowAnyHost && !cfg.allowPrivate)
    throw new DestinationError("host-not-allowed");

  if (!cfg.allowPrivate) {
    const addrs = ip ? [host.replace(/^\[|\]$/g, "")] : await resolve(host);
    if (addrs.length === 0 || addrs.some(isPrivateAddress))
      throw new DestinationError("private-address");
  }

  const base = s.replace(/\/+$/, "");
  return {
    publishUrl: `${base}/${k}`,
    host,
    secure: u.protocol === "rtmps:",
    secrets: [k, `${base}/${k}`],
  };
}

/** Replace secrets and any rtmp(s) URL by placeholders. */
export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of [...secrets].sort((a, b) => b.length - a.length)) {
    if (s.length >= 4) out = out.split(s).join("***");
  }
  return out.replace(/rtmps?:\/\/[^\s'"]+/gi, (m) => {
    const host = /^rtmps?:\/\/([^/:?\s]+)/i.exec(m)?.[1] ?? "?";
    return `rtmp://${host}/***`;
  });
}

/* ------------------------------------------------------------------ */
/* ffmpeg command line                                                 */
/* ------------------------------------------------------------------ */

export interface FfmpegPlan {
  container: "webm" | "mp4";
  video: { width: number; height: number; fps: number; kbps: number };
  audioKbps: number;
  urls: readonly string[];
  x264Preset: string;
}

/**
 * One decode, one encode (H.264 + AAC), N outputs through the tee muxer. Arguments are passed
 * as an argv array (no shell); URLs were validated against a strict character set that
 * excludes the tee separators (`|`, `[`, `]`, quotes, backslash).
 */
export function buildFfmpegArgs(plan: FfmpegPlan): string[] {
  const { width: w, height: h, fps, kbps } = plan.video;
  const gop = String(Math.max(1, Math.round(fps * 2)));
  const args = [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "warning",
    "-progress",
    "pipe:1",
    "-nostats",
    "-fflags",
    "+genpts",
    "-f",
    plan.container === "webm" ? "matroska" : "mp4",
    "-i",
    "pipe:0",
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-vf",
    `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,fps=${fps},format=yuv420p`,
    "-c:v",
    "libx264",
    "-preset",
    plan.x264Preset,
    "-tune",
    "zerolatency",
    "-profile:v",
    "main",
    "-b:v",
    `${kbps}k`,
    "-maxrate",
    `${kbps}k`,
    "-bufsize",
    `${kbps * 2}k`,
    "-g",
    gop,
    "-keyint_min",
    gop,
    "-sc_threshold",
    "0",
    "-c:a",
    "aac",
    "-b:a",
    `${plan.audioKbps}k`,
    "-ar",
    "48000",
    "-ac",
    "2",
  ];
  if (plan.urls.length === 1) {
    args.push(
      "-flvflags",
      "no_duration_filesize",
      "-f",
      "flv",
      plan.urls[0] as string,
    );
  } else {
    const slaves = plan.urls
      .map((u) => `[f=flv:flvflags=no_duration_filesize:onfail=ignore]${u}`)
      .join("|");
    args.push("-f", "tee", slaves);
  }
  return args;
}

/** Parse one `-progress` block (`key=value` lines) into numbers. */
export interface LiveProgress {
  frame: number;
  fps: number;
  bitrateKbps: number;
  outTimeMs: number;
  speed: number;
  dropped: number;
}

export const EMPTY_PROGRESS: LiveProgress = Object.freeze({
  frame: 0,
  fps: 0,
  bitrateKbps: 0,
  outTimeMs: 0,
  speed: 0,
  dropped: 0,
});

export function applyProgressLine(
  cur: Partial<LiveProgress>,
  line: string,
): { block: Partial<LiveProgress>; done: boolean } {
  const i = line.indexOf("=");
  if (i < 0) return { block: cur, done: false };
  const k = line.slice(0, i).trim();
  const v = line.slice(i + 1).trim();
  const num = Number.parseFloat(v);
  const next = { ...cur };
  switch (k) {
    case "frame":
      if (Number.isFinite(num)) next.frame = num;
      break;
    case "fps":
      if (Number.isFinite(num)) next.fps = num;
      break;
    case "bitrate":
      if (Number.isFinite(num)) next.bitrateKbps = num; // "1234.5kbits/s"
      break;
    case "out_time_us":
    case "out_time_ms":
      if (Number.isFinite(num)) next.outTimeMs = num / 1000;
      break;
    case "speed":
      if (Number.isFinite(num)) next.speed = num; // "1.01x"
      break;
    case "drop_frames":
      if (Number.isFinite(num)) next.dropped = num;
      break;
    case "progress":
      return { block: next, done: true };
  }
  return { block: next, done: false };
}
