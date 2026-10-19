// src/server/live.ts
// RTMP(S) live bridge. Browsers cannot speak RTMP, so the studio records its program output with
// MediaRecorder and POSTs the WebM/MP4 chunks here; ffmpeg re-encodes them to H.264/AAC and
// pushes them to one or more platforms (YouTube, Facebook, Twitch, Kick, Instagram, TikTok, custom).
//
// Disabled unless `LIVE_ADMIN_TOKEN` (>= 16 chars) is set: every call must carry it as a bearer
// token. Needs ONE long-lived Node process with ffmpeg installed (same deployment as rooms.ts).
// Pure `Request -> Response`; Node APIs (child_process, dns, net) are imported lazily so this
// file is harmless in bundles for targets that cannot run it.
import { z } from "zod";

import {
  BUILTIN_HOSTS,
  DestinationError,
  EMPTY_PROGRESS,
  applyProgressLine,
  buildFfmpegArgs,
  parseDestination,
  redact,
  type HostResolver,
  type LiveConfig,
  type LiveProgress,
} from "./live-policy";

export const LIVE_API_PREFIX = "/api/live";

export const LIVE_LIMITS = {
  maxChunkBytes: 6 * 1024 * 1024,
  maxDestinations: 4,
  authFailPer10Min: 10,
  endedRetainMs: 5 * 60_000,
  stopGraceMs: 6_000,
  killGraceMs: 3_000,
  tailLines: 12,
} as const;

/* ------------------------------------------------------------------ */
/* process abstraction (so tests can fake ffmpeg)                       */
/* ------------------------------------------------------------------ */

export interface LiveProc {
  /** resolves when the chunk was handed to ffmpeg (back-pressure), rejects if it is gone */
  write(chunk: Uint8Array): Promise<void>;
  endInput(): void;
  kill(signal: "SIGTERM" | "SIGKILL"): void;
  onStdout(cb: (line: string) => void): void;
  onStderr(cb: (line: string) => void): void;
  onExit(cb: (code: number | null, signal: string | null) => void): void;
}

export type Spawner = (cmd: string, args: string[]) => Promise<LiveProc>;

function lineSplitter(
  cb: (line: string) => void,
): (d: Uint8Array | string) => void {
  let buf = "";
  return (d) => {
    buf += typeof d === "string" ? d : new TextDecoder().decode(d);
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      cb(buf.slice(0, i).replace(/\r$/, ""));
      buf = buf.slice(i + 1);
    }
    if (buf.length > 8192) buf = buf.slice(-4096);
  };
}

export const nodeSpawner: Spawner = async (cmd, args) => {
  const { spawn } = await import("node:child_process");
  const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
  let dead = false;
  let exitCb: ((c: number | null, s: string | null) => void) | null = null;
  const spawnError = new Promise<Error>((resolve) =>
    child.once("error", resolve),
  );
  child.once("exit", (code, signal) => {
    dead = true;
    exitCb?.(code, signal);
  });
  child.stdin.on("error", () => undefined); // EPIPE after ffmpeg exits
  // surface ENOENT (ffmpeg missing) before returning
  const early = await Promise.race([
    spawnError,
    new Promise<null>((r) => setTimeout(() => r(null), 30)),
  ]);
  if (early) throw early;
  return {
    write(chunk) {
      return new Promise<void>((resolve, reject) => {
        if (dead || !child.stdin.writable)
          return reject(new Error("ffmpeg-gone"));
        child.stdin.write(chunk, (err) => (err ? reject(err) : resolve()));
      });
    },
    endInput: () => {
      if (!dead) child.stdin.end();
    },
    kill: (sig) => {
      if (!dead) child.kill(sig);
    },
    onStdout: (cb) => child.stdout.on("data", lineSplitter(cb)),
    onStderr: (cb) => child.stderr.on("data", lineSplitter(cb)),
    onExit: (cb) => {
      exitCb = cb;
      if (dead) cb(child.exitCode, child.signalCode);
    },
  };
};

export const nodeResolver: HostResolver = async (host) => {
  const dns = await import("node:dns/promises");
  const r = await dns.lookup(host, { all: true });
  return r.map((x) => x.address);
};

async function tcpProbe(
  host: string,
  port: number,
  ms = 4000,
): Promise<number | null> {
  const net = await import("node:net");
  return new Promise((resolve) => {
    const t0 = Date.now();
    const sock = net.connect({ host, port });
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok ? Date.now() - t0 : null);
    };
    sock.setTimeout(ms, () => done(false));
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });
}

async function ffmpegVersion(cfg: LiveConfig): Promise<string | null> {
  try {
    const { execFile } = await import("node:child_process");
    return await new Promise((resolve) =>
      execFile(
        cfg.ffmpegPath,
        ["-hide_banner", "-version"],
        { timeout: 5000 },
        (err, out) =>
          resolve(
            err
              ? null
              : (/ffmpeg version (\S+)/.exec(String(out))?.[1] ?? "unknown"),
          ),
      ),
    );
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* schemas                                                             */
/* ------------------------------------------------------------------ */

const destinationBody = z.object({
  label: z.string().max(60).default(""),
  server: z.string().max(600),
  key: z.string().max(600),
});

const sessionBody = z.object({
  destinations: z
    .array(destinationBody)
    .min(1)
    .max(LIVE_LIMITS.maxDestinations),
  video: z.object({
    width: z
      .number()
      .int()
      .min(320)
      .max(1920)
      .refine((n) => n % 2 === 0),
    height: z
      .number()
      .int()
      .min(180)
      .max(1080)
      .refine((n) => n % 2 === 0),
    fps: z.number().int().min(10).max(60),
    kbps: z.number().int().min(300).max(50_000),
  }),
  audioKbps: z.number().int().min(48).max(320).default(128),
  container: z.enum(["webm", "mp4"]).default("webm"),
});

const probeBody = z.object({ server: z.string().max(600) });

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

type State = "starting" | "live" | "stopping" | "ended" | "error";

interface Session {
  id: string;
  state: State;
  startedAt: number;
  endedAt: number | null;
  lastChunkAt: number;
  nextSeq: number;
  bytesIn: number;
  chunks: number;
  hosts: { label: string; host: string; secure: boolean }[];
  proc: LiveProc;
  progress: LiveProgress;
  block: Partial<LiveProgress>;
  tail: string[];
  error: string | null;
  secrets: string[];
  queue: Promise<unknown>;
  timer: ReturnType<typeof setInterval>;
  maxMs: number;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export interface LiveApiOptions {
  config: LiveConfig;
  now?: () => number;
  spawner?: Spawner;
  resolver?: HostResolver;
  /** test seam */
  randomId?: () => string;
}

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
} as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function randomId(): string {
  const b = new Uint8Array(9);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function createLiveApi(opts: LiveApiOptions) {
  const cfg = opts.config;
  const now = opts.now ?? (() => Date.now());
  const spawner = opts.spawner ?? nodeSpawner;
  const resolver = opts.resolver ?? nodeResolver;
  const newId = opts.randomId ?? randomId;
  const fails = new Map<string, { count: number; start: number }>();
  let current: Session | null = null;
  let version: Promise<string | null> | null = null;

  /* ------------------------------ helpers ------------------------------ */

  function clientIp(req: Request): string {
    const fwd = req.headers.get("x-forwarded-for");
    // the reverse proxy appends the real client address: only the last entry is trustworthy
    return (
      (fwd ? fwd.split(",").pop()?.trim() : req.headers.get("x-real-ip")) ||
      "unknown"
    );
  }

  function authorize(req: Request): void {
    if (!cfg.token) throw new HttpError(503, "disabled");
    const ip = clientIp(req);
    const t = now();
    const f = fails.get(ip);
    if (f && t - f.start < 600_000 && f.count >= LIVE_LIMITS.authFailPer10Min)
      throw new HttpError(429, "rate-limited");
    const m = /^Bearer\s+(\S{1,200})$/.exec(
      req.headers.get("authorization") ?? "",
    );
    if (!m || !safeEqual(m[1] as string, cfg.token)) {
      if (!f || t - f.start >= 600_000) fails.set(ip, { count: 1, start: t });
      else f.count++;
      if (fails.size > 1000)
        for (const [k, v] of fails) if (t - v.start >= 600_000) fails.delete(k);
      throw new HttpError(403, "forbidden");
    }
  }

  async function readJson<T>(
    req: Request,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  ): Promise<T> {
    const text = await req.text();
    if (text.length > 32 * 1024) throw new HttpError(413, "too-large");
    let raw: unknown;
    try {
      raw = text ? JSON.parse(text) : {};
    } catch {
      throw new HttpError(400, "bad-json");
    }
    const r = schema.safeParse(raw);
    if (!r.success) throw new HttpError(400, "bad-request");
    return r.data;
  }

  function snapshot(s: Session) {
    const end = s.endedAt ?? now();
    return {
      id: s.id,
      state: s.state,
      startedAt: s.startedAt,
      uptimeMs: Math.max(0, end - s.startedAt),
      bytesIn: s.bytesIn,
      chunks: s.chunks,
      nextSeq: s.nextSeq,
      destinations: s.hosts,
      progress: s.progress,
      error: s.error,
      tail: s.tail,
    };
  }

  function addTail(s: Session, line: string): void {
    const clean = redact(line, s.secrets).slice(0, 300);
    if (!clean.trim()) return;
    s.tail.push(clean);
    if (s.tail.length > LIVE_LIMITS.tailLines) s.tail.shift();
  }

  function finish(
    s: Session,
    state: "ended" | "error",
    error: string | null,
  ): void {
    if (s.state === "ended" || s.state === "error") return;
    s.state = state;
    s.error = error;
    s.endedAt = now();
    clearInterval(s.timer);
    // keep the final snapshot around for a while, then forget it
    const drop = setTimeout(() => {
      if (current === s) current = null;
    }, LIVE_LIMITS.endedRetainMs);
    (drop as { unref?: () => void }).unref?.();
  }

  async function stop(s: Session): Promise<void> {
    if (s.state === "ended" || s.state === "error") return;
    s.state = "stopping";
    s.proc.endInput();
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (s.endedAt !== null) {
          clearInterval(check);
          clearTimeout(t1);
          clearTimeout(t2);
          resolve();
        }
      }, 50);
      const t1 = setTimeout(
        () => s.proc.kill("SIGTERM"),
        LIVE_LIMITS.stopGraceMs,
      );
      const t2 = setTimeout(() => {
        s.proc.kill("SIGKILL");
        finish(s, "ended", s.error);
      }, LIVE_LIMITS.stopGraceMs + LIVE_LIMITS.killGraceMs);
    });
  }

  /* ------------------------------- routes ------------------------------ */

  async function status(): Promise<Response> {
    version ??= ffmpegVersion(cfg);
    const v = await version;
    if (v === null) version = null; // retry next time (maybe installed meanwhile)
    return json({
      ffmpeg: { ok: v !== null, version: v },
      limits: {
        maxDestinations: LIVE_LIMITS.maxDestinations,
        maxVideoKbps: cfg.maxVideoKbps,
        maxMinutes: cfg.maxMinutes,
        allowAnyHost: cfg.allowAnyHost,
        allowPrivate: cfg.allowPrivate,
        hosts: [...BUILTIN_HOSTS, ...cfg.allowedHosts],
      },
      session: current ? snapshot(current) : null,
    });
  }

  async function start(req: Request): Promise<Response> {
    const body = await readJson(req, sessionBody);
    if (current && current.state !== "ended" && current.state !== "error")
      throw new HttpError(409, "busy", { session: snapshot(current) });
    if (body.video.kbps > cfg.maxVideoKbps)
      throw new HttpError(400, "bitrate-too-high");

    const parsed = [];
    for (const [index, d] of body.destinations.entries()) {
      try {
        parsed.push({
          label: d.label,
          ...(await parseDestination(d.server, d.key, cfg, resolver)),
        });
      } catch (e) {
        if (e instanceof DestinationError)
          throw new HttpError(400, "bad-destination", {
            index,
            reason: e.code,
          });
        throw e;
      }
    }

    const args = buildFfmpegArgs({
      container: body.container,
      video: body.video,
      audioKbps: body.audioKbps,
      urls: parsed.map((p) => p.publishUrl),
      x264Preset: cfg.x264Preset,
    });
    let proc: LiveProc;
    try {
      proc = await spawner(cfg.ffmpegPath, args);
    } catch {
      throw new HttpError(503, "ffmpeg-missing");
    }

    const t = now();
    const s: Session = {
      id: newId(),
      state: "starting",
      startedAt: t,
      endedAt: null,
      lastChunkAt: t,
      nextSeq: 0,
      bytesIn: 0,
      chunks: 0,
      hosts: parsed.map((p) => ({
        label: p.label,
        host: p.host,
        secure: p.secure,
      })),
      proc,
      progress: EMPTY_PROGRESS,
      block: {},
      tail: [],
      error: null,
      secrets: parsed.flatMap((p) => p.secrets),
      queue: Promise.resolve(),
      maxMs: cfg.maxMinutes * 60_000,
      timer: setInterval(() => watchdog(s), 2_000),
    };
    (s.timer as { unref?: () => void }).unref?.();
    current = s;

    proc.onStdout((line) => {
      const r = applyProgressLine(s.block, line);
      s.block = r.block;
      if (r.done) {
        s.progress = { ...EMPTY_PROGRESS, ...s.block };
        s.block = {};
        if (s.state === "starting" && s.progress.frame > 0) s.state = "live";
      }
    });
    proc.onStderr((line) => addTail(s, line));
    proc.onExit((code, signal) => {
      if (s.state === "stopping") finish(s, "ended", s.error);
      else if (code === 0) finish(s, "ended", s.error);
      else
        finish(
          s,
          "error",
          `ffmpeg exited (${signal ?? `code ${String(code)}`})` +
            (s.tail.length ? `: ${s.tail[s.tail.length - 1]}` : ""),
        );
    });
    console.log(
      `[live] session ${s.id} started -> ${s.hosts.map((h) => h.host).join(", ")} ` +
        `(${body.video.width}x${body.video.height}@${body.video.fps}, ${body.video.kbps} kbps)`,
    );
    return json({ session: snapshot(s) }, 201);
  }

  function watchdog(s: Session): void {
    const t = now();
    if (s.state === "ended" || s.state === "error" || s.state === "stopping")
      return;
    if (t - s.startedAt > s.maxMs) {
      s.error = "max-duration";
      void stop(s);
    } else if (t - s.lastChunkAt > cfg.idleStopMs) {
      s.error = "idle";
      void stop(s);
    }
  }

  function getSession(id: string): Session {
    if (!current || current.id !== id) throw new HttpError(404, "not-found");
    return current;
  }

  async function chunk(req: Request, url: URL, id: string): Promise<Response> {
    const s = getSession(id);
    const seq = Number(url.searchParams.get("seq"));
    if (!Number.isInteger(seq) || seq < 0)
      throw new HttpError(400, "bad-request");
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > LIVE_LIMITS.maxChunkBytes) throw new HttpError(413, "too-large");
    const buf = new Uint8Array(await req.arrayBuffer());
    if (buf.byteLength > LIVE_LIMITS.maxChunkBytes)
      throw new HttpError(413, "too-large");
    if (s.state === "ended" || s.state === "error" || s.state === "stopping")
      throw new HttpError(410, "ended", { session: snapshot(s) });
    if (seq === s.nextSeq - 1)
      return json({ ok: true, duplicate: true, next: s.nextSeq });
    if (seq !== s.nextSeq)
      throw new HttpError(409, "bad-seq", { expected: s.nextSeq });
    // claim the slot synchronously, then write in order
    s.nextSeq++;
    s.lastChunkAt = now();
    s.bytesIn += buf.byteLength;
    s.chunks++;
    const write = s.queue.then(() => s.proc.write(buf));
    s.queue = write.catch(() => undefined);
    try {
      await write;
    } catch {
      throw new HttpError(410, "ended", { session: snapshot(s) });
    }
    return json({ ok: true, next: s.nextSeq, state: s.state });
  }

  async function probe(req: Request): Promise<Response> {
    const body = await readJson(req, probeBody);
    try {
      const d = await parseDestination(body.server, "probe-key", cfg, resolver);
      const u = new URL(body.server.trim());
      const port = u.port
        ? Number(u.port)
        : u.protocol === "rtmps:"
          ? 443
          : 1935;
      const ms = await tcpProbe(d.host, port);
      return json({
        host: d.host,
        port,
        secure: d.secure,
        reachable: ms !== null,
        ms,
      });
    } catch (e) {
      if (e instanceof DestinationError)
        throw new HttpError(400, "bad-destination", { reason: e.code });
      throw e;
    }
  }

  /* ------------------------------- router ------------------------------ */

  async function handle(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    if (
      url.pathname !== LIVE_API_PREFIX &&
      !url.pathname.startsWith(`${LIVE_API_PREFIX}/`)
    )
      return null;
    try {
      const rest = url.pathname
        .slice(LIVE_API_PREFIX.length)
        .split("/")
        .filter(Boolean);
      const method = req.method.toUpperCase();
      if (rest[0] === "health" && rest.length === 1 && method === "GET")
        return json({ enabled: cfg.token !== null, v: 1 });
      authorize(req);
      if (rest[0] === "status" && rest.length === 1 && method === "GET")
        return await status();
      if (rest[0] === "probe" && rest.length === 1 && method === "POST")
        return await probe(req);
      if (rest[0] === "session") {
        if (rest.length === 1 && method === "POST") return await start(req);
        const id = rest[1];
        if (id && rest.length === 2) {
          if (method === "GET")
            return json({ session: snapshot(getSession(id)) });
          if (method === "DELETE") {
            const s = getSession(id);
            await stop(s);
            return json({ session: snapshot(s) });
          }
        }
        if (id && rest.length === 3 && rest[2] === "chunk" && method === "POST")
          return await chunk(req, url, id);
      }
      throw new HttpError(404, "not-found");
    } catch (e) {
      if (e instanceof HttpError)
        return json({ error: e.code, ...e.extra }, e.status);
      console.error("[live]", e instanceof Error ? e.message : "error");
      return json({ error: "internal" }, 500);
    }
  }

  return {
    handle,
    /** stop everything (process shutdown / tests) */
    async dispose(): Promise<void> {
      const s = current;
      if (s) {
        clearInterval(s.timer);
        s.proc.endInput();
        s.proc.kill("SIGTERM");
      }
      current = null;
      fails.clear();
    },
  };
}

export type LiveApi = ReturnType<typeof createLiveApi>;
