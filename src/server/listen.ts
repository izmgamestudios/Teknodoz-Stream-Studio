// src/server/listen.ts
// Mass listening without an SFU. The moderator's browser keeps the only WebRTC mesh (a handful of
// guests); for the audience it uploads the mix as small Opus/WebM chunks. The server pipes them
// through ffmpeg into a live MP3 and fans it out over plain HTTP, so thousands of listeners cost
// one ffmpeg process and some bandwidth (Cloudflare can carry the stream). Latency is a few
// seconds. MP3 is joinable anywhere in the stream, which is why listeners may arrive at any time.
//
//   POST /api/listen                 creator/admin  { title? } -> { id, token }
//   POST /api/listen/:id/chunk       X-Listen-Token  body = WebM bytes (<= 512 KB)
//   POST /api/listen/:id/stop        X-Listen-Token
//   GET  /api/listen/:id             { live, title, listeners }
//   GET  /listen/:id/live.mp3        public audio stream
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";

import { z } from "zod";

export const LISTEN_LIMITS = {
  maxStreams: 3,
  maxListeners: 800,
  maxChunkBytes: 512 * 1024,
  idleMs: 45_000,
  /** a listener this many bytes behind is dropped instead of slowing everybody */
  maxLag: 2 * 1024 * 1024,
} as const;

interface Listener {
  controller: ReadableStreamDefaultController<Uint8Array>;
  lag: number;
}

interface Stream {
  id: string;
  token: string;
  title: string;
  child: ChildProcess | null;
  listeners: Set<Listener>;
  startedAt: number;
  lastChunk: number;
  ended: boolean;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });

const safeEq = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export interface ListenOptions {
  ffmpegBin: string;
  /** who may start a stream (creator or admin) */
  canStart: (req: Request) => boolean | Promise<boolean>;
  now?: () => number;
  spawnImpl?: typeof spawn;
}

export function createListenApi(opts: ListenOptions) {
  const now = opts.now ?? Date.now;
  const run = opts.spawnImpl ?? spawn;
  const streams = new Map<string, Stream>();
  const enc = new TextEncoder();

  function end(s: Stream): void {
    if (s.ended) return;
    s.ended = true;
    try {
      s.child?.stdin?.end();
      s.child?.kill("SIGTERM");
    } catch {
      /* already gone */
    }
    for (const l of s.listeners) {
      try {
        l.controller.close();
      } catch {
        /* closed by the client */
      }
    }
    s.listeners.clear();
    streams.delete(s.id);
  }

  function sweep(): void {
    const t = now();
    for (const s of [...streams.values()])
      if (t - s.lastChunk > LISTEN_LIMITS.idleMs) end(s);
  }

  function startFfmpeg(s: Stream): void {
    const child = run(
      opts.ffmpegBin,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-fflags",
        "+nobuffer+discardcorrupt",
        "-i",
        "pipe:0",
        "-vn",
        "-ac",
        "2",
        "-ar",
        "44100",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "96k",
        "-flush_packets",
        "1",
        "-f",
        "mp3",
        "pipe:1",
      ],
      { stdio: ["pipe", "pipe", "ignore"] },
    );
    s.child = child;
    child.stdout?.on("data", (buf: Buffer) => {
      const bytes = new Uint8Array(buf);
      for (const l of [...s.listeners]) {
        const room = l.controller.desiredSize ?? 1;
        if (room <= 0) l.lag += bytes.length;
        else l.lag = 0;
        if (l.lag > LISTEN_LIMITS.maxLag) {
          s.listeners.delete(l);
          try {
            l.controller.close();
          } catch {
            /* gone */
          }
          continue;
        }
        if (room > 0) {
          try {
            l.controller.enqueue(bytes);
          } catch {
            s.listeners.delete(l);
          }
        }
      }
    });
    child.stdin?.on("error", () => end(s));
    child.on("close", () => end(s));
    child.on("error", () => end(s));
  }

  async function handle(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    const path = url.pathname;
    const m = /^\/listen\/([a-z0-9]{8})\/live\.mp3$/.exec(path);
    const method = req.method.toUpperCase();
    if (m) {
      if (method !== "GET") return json({ error: "method-not-allowed" }, 405);
      sweep();
      const s = streams.get(m[1] as string);
      if (!s) return json({ error: "not-live" }, 404);
      if (s.listeners.size >= LISTEN_LIMITS.maxListeners)
        return json({ error: "full" }, 503);
      let me: Listener | null = null;
      const body = new ReadableStream<Uint8Array>(
        {
          start(controller) {
            me = { controller, lag: 0 };
            s.listeners.add(me);
          },
          cancel() {
            if (me) s.listeners.delete(me);
          },
        },
        { highWaterMark: 64 * 1024, size: (c) => c.byteLength },
      );
      return new Response(body, {
        headers: {
          "content-type": "audio/mpeg",
          "cache-control": "no-store",
          "x-accel-buffering": "no",
          "x-content-type-options": "nosniff",
          "icy-name": enc.encode(s.title).length ? "Teknodoz" : "Teknodoz",
        },
      });
    }
    if (path !== "/api/listen" && !path.startsWith("/api/listen/")) return null;
    sweep();
    const rest = path.slice("/api/listen".length).split("/").filter(Boolean);

    if (rest.length === 0 && method === "POST") {
      if (!(await opts.canStart(req)))
        return json({ error: "creator-required" }, 401);
      if (streams.size >= LISTEN_LIMITS.maxStreams)
        return json({ error: "busy" }, 503);
      const b = z
        .object({ title: z.string().trim().max(80).optional() })
        .safeParse(await req.json().catch(() => ({})));
      const id = randomBytes(6).toString("hex").slice(0, 8);
      const s: Stream = {
        id,
        token: randomBytes(18).toString("base64url"),
        title: (b.success && b.data.title) || "Podcast",
        child: null,
        listeners: new Set(),
        startedAt: now(),
        lastChunk: now(),
        ended: false,
      };
      streams.set(id, s);
      return json({ id, token: s.token }, 201);
    }

    const s = streams.get(rest[0] ?? "");
    if (rest.length === 1 && method === "GET")
      return s
        ? json({ live: true, title: s.title, listeners: s.listeners.size })
        : json({ live: false, title: "", listeners: 0 });
    if (!s) return json({ error: "not-found" }, 404);
    const token = req.headers.get("x-listen-token") ?? "";
    if (!safeEq(token, s.token)) return json({ error: "unauthorized" }, 401);

    if (rest[1] === "chunk" && method === "POST") {
      const buf = Buffer.from(await req.arrayBuffer());
      if (buf.length === 0 || buf.length > LISTEN_LIMITS.maxChunkBytes)
        return json({ error: "bad-chunk" }, 400);
      s.lastChunk = now();
      if (!s.child) startFfmpeg(s);
      s.child?.stdin?.write(buf);
      return json({ ok: true, listeners: s.listeners.size });
    }
    if (rest[1] === "stop" && method === "POST") {
      end(s);
      return json({ ok: true });
    }
    return json({ error: "not-found" }, 404);
  }

  return { handle, streams, dispose: () => [...streams.values()].forEach(end) };
}
