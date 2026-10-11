/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LIVE_LIMITS,
  createLiveApi,
  type LiveApi,
  type LiveProc,
} from "./live";
import {
  BUILTIN_HOSTS,
  DestinationError,
  applyProgressLine,
  buildFfmpegArgs,
  hostMatches,
  isPrivateAddress,
  liveConfigFromEnv,
  parseDestination,
  redact,
  tokenTooShort,
  type LiveConfig,
} from "./live-policy";

const TOKEN = "t".repeat(24);
const KEY = "abcd-efgh-ijkl-mnop-qrst";
const YT = "rtmps://a.rtmps.youtube.com:443/live2";

const cfg = (over: Partial<LiveConfig> = {}): LiveConfig => ({
  ...liveConfigFromEnv({ LIVE_ADMIN_TOKEN: TOKEN }),
  ...over,
});
const publicDns = async () => ["142.250.1.1"];

describe("config", () => {
  it("is disabled without a long enough token", () => {
    expect(liveConfigFromEnv({}).token).toBeNull();
    expect(liveConfigFromEnv({ LIVE_ADMIN_TOKEN: "short" }).token).toBeNull();
    expect(tokenTooShort({ LIVE_ADMIN_TOKEN: "short" })).toBe(true);
    expect(tokenTooShort({})).toBe(false);
    expect(liveConfigFromEnv({ LIVE_ADMIN_TOKEN: TOKEN }).token).toBe(TOKEN);
  });
  it("expands ~ in LIVE_FFMPEG_PATH (no root / no shell needed)", () => {
    const at = (p: string | undefined, home = "/home/site/") =>
      liveConfigFromEnv({
        LIVE_ADMIN_TOKEN: TOKEN,
        HOME: home,
        ...(p === undefined ? {} : { LIVE_FFMPEG_PATH: p }),
      }).ffmpegPath;
    expect(at("~/bin/ffmpeg")).toBe("/home/site/bin/ffmpeg");
    expect(at("~")).toBe("/home/site");
    expect(at("/usr/local/bin/ffmpeg")).toBe("/usr/local/bin/ffmpeg");
    expect(at("~other/ffmpeg")).toBe("~other/ffmpeg");
    expect(at(undefined)).toBe("ffmpeg");
    expect(at("~/bin/ffmpeg", "")).toBe("~/bin/ffmpeg"); // unknown HOME: left alone
  });
  it("parses and clamps the optional settings", () => {
    const c = liveConfigFromEnv({
      LIVE_ADMIN_TOKEN: TOKEN,
      LIVE_ALLOWED_HOSTS: " Ingest.Example.com , *.cdn.test ,",
      LIVE_ALLOW_ANY_HOST: "1",
      LIVE_MAX_MINUTES: "99999",
      LIVE_MAX_VIDEO_KBPS: "nope",
      LIVE_X264_PRESET: "placebo; rm -rf /",
    });
    expect(c.allowedHosts).toEqual(["ingest.example.com", "*.cdn.test"]);
    expect(c.allowAnyHost).toBe(true);
    expect(c.allowPrivate).toBe(false);
    expect(c.maxMinutes).toBe(24 * 60);
    expect(c.maxVideoKbps).toBe(9000);
    expect(c.x264Preset).toBe("veryfast");
  });
});

describe("hosts and addresses", () => {
  it("matches exact names and *.wildcards (never the apex)", () => {
    expect(hostMatches("a.rtmps.youtube.com", "*.youtube.com")).toBe(true);
    expect(hostMatches("youtube.com", "*.youtube.com")).toBe(false);
    expect(hostMatches("evilyoutube.com", "*.youtube.com")).toBe(false);
    expect(hostMatches("youtube.com.evil.io", "*.youtube.com")).toBe(false);
    expect(
      hostMatches("LIVE-API-S.facebook.com.", "live-api-s.facebook.com"),
    ).toBe(true);
    expect(BUILTIN_HOSTS.length).toBeGreaterThan(5);
  });
  it.each([
    ["127.0.0.1", true],
    ["10.1.2.3", true],
    ["172.16.0.9", true],
    ["172.32.0.9", false],
    ["192.168.1.1", true],
    ["169.254.169.254", true],
    ["100.64.0.1", true],
    ["0.0.0.0", true],
    ["224.0.0.1", true],
    ["8.8.8.8", false],
    ["142.250.1.1", false],
    ["::1", true],
    ["::", true],
    ["fd00::1", true],
    ["fe80::1", true],
    ["::ffff:10.0.0.1", true],
    ["::ffff:8.8.8.8", false],
    ["2606:4700::1111", false],
  ])("isPrivateAddress(%s) = %s", (ip, expected) => {
    expect(isPrivateAddress(ip)).toBe(expected);
  });
});

describe("parseDestination", () => {
  const c = cfg();
  const code = async (
    server: string,
    key = KEY,
    over: Partial<LiveConfig> = {},
    dns = publicDns,
  ) => {
    try {
      await parseDestination(server, key, { ...c, ...over }, dns);
      return "ok";
    } catch (e) {
      return e instanceof DestinationError ? e.code : "other";
    }
  };

  it("accepts the known platform hosts and builds the publish URL", async () => {
    const d = await parseDestination(`${YT}/`, KEY, c, publicDns);
    expect(d.publishUrl).toBe(`${YT}/${KEY}`);
    expect(d.host).toBe("a.rtmps.youtube.com");
    expect(d.secure).toBe(true);
    expect(d.secrets).toContain(KEY);
    expect(
      await code(
        "rtmps://live-api-s.facebook.com:443/rtmp/",
        "FB-1234?s_bl=1&s_sc=x",
      ),
    ).toBe("ok");
    expect(
      await code(
        "rtmp://push.tiktokcdn.com/live/",
        "stream-1234?expire=1&sign=ab",
      ),
    ).toBe("ok");
    expect(
      await code(
        "rtmps://abc123.global-contribute.live-video.net:443/app",
        KEY,
      ),
    ).toBe("ok");
  });

  it("rejects hosts outside the allowlist unless the operator opted in", async () => {
    expect(await code("rtmps://evil.example.com/live", KEY)).toBe(
      "host-not-allowed",
    );
    expect(await code("rtmps://youtube.com.evil.io/live", KEY)).toBe(
      "host-not-allowed",
    );
    expect(await code("rtmps://203.0.113.9/live", KEY)).toBe(
      "host-not-allowed",
    );
    expect(
      await code("rtmps://ingest.example.com/live", KEY, {
        allowedHosts: ["ingest.example.com"],
      }),
    ).toBe("ok");
    expect(
      await code("rtmps://evil.example.com/live", KEY, { allowAnyHost: true }),
    ).toBe("ok");
  });

  it("blocks names that resolve to private addresses (SSRF), even when allowed", async () => {
    const priv = async () => ["10.0.0.5"];
    expect(await code(YT, KEY, {}, priv)).toBe("private-address");
    const mixed = async () => ["142.250.1.1", "127.0.0.1"];
    expect(await code(YT, KEY, {}, mixed)).toBe("private-address");
    expect(await code(YT, KEY, {}, async () => [])).toBe("private-address");
    expect(
      await code("rtmp://127.0.0.1:1935/live", KEY, { allowAnyHost: true }),
    ).toBe("private-address");
    // explicit self-hosted ingest
    expect(
      await code("rtmp://127.0.0.1:19350/live", KEY, { allowPrivate: true }),
    ).toBe("ok");
  });

  it("rejects malformed urls, schemes, credentials, ports and keys", async () => {
    expect(await code("http://a.rtmps.youtube.com/live2")).toBe("bad-url");
    expect(await code("ftp://a.rtmps.youtube.com/live2")).toBe("bad-url");
    expect(await code("rtmps://user:pw@a.rtmps.youtube.com/live2")).toBe(
      "bad-url",
    );
    expect(await code("rtmps://a.rtmps.youtube.com/live2 -f null")).toBe(
      "bad-url",
    );
    expect(
      await code("rtmps://a.rtmps.youtube.com/live2|[f=flv]rtmp://x/y"),
    ).toBe("bad-url");
    expect(await code("rtmps://a.rtmps.youtube.com/live2'\"")).toBe("bad-url");
    expect(await code("rtmps://a.rtmps.youtube.com:22/live2")).toBe(
      "port-not-allowed",
    );
    expect(await code(YT, "ab")).toBe("bad-key");
    expect(await code(YT, "key with space")).toBe("bad-key");
    expect(await code(YT, "key|[f=flv]x")).toBe("bad-key");
    expect(await code(YT, "../../etc/passwd")).toBe("bad-key");
    expect(await code(YT, "x".repeat(600))).toBe("bad-key");
  });
});

describe("redact", () => {
  it("scrubs keys and urls from ffmpeg output", () => {
    const url = `${YT}/${KEY}`;
    const text = `Error opening output ${url}: Connection refused (key ${KEY})`;
    const out = redact(text, [KEY, url]);
    expect(out).not.toContain(KEY);
    expect(out).not.toContain("live2");
    expect(redact("push rtmp://other.host/app/SECRETKEY99 failed", [])).toBe(
      "push rtmp://other.host/*** failed",
    );
  });
});

describe("ffmpeg plan", () => {
  const plan = {
    container: "webm" as const,
    video: { width: 1280, height: 720, fps: 30, kbps: 3000 },
    audioKbps: 128,
    x264Preset: "veryfast",
  };
  it("single destination writes plain flv last", () => {
    const a = buildFfmpegArgs({ ...plan, urls: [`${YT}/${KEY}`] });
    expect(a.slice(-3)).toEqual(["-f", "flv", `${YT}/${KEY}`]);
    expect(a).toContain("libx264");
    expect(a[a.indexOf("-g") + 1]).toBe("60");
    expect(a[a.indexOf("-f") + 1]).toBe("matroska");
    expect(a.join(" ")).toContain("scale=1280:720");
  });
  it("several destinations share one encode through the tee muxer", () => {
    const a = buildFfmpegArgs({
      ...plan,
      container: "mp4",
      urls: ["rtmps://a/x/1111", "rtmps://b/y/2222"],
    });
    expect(a.filter((x) => x === "libx264")).toHaveLength(1);
    expect(a.slice(-3, -1)).toEqual(["-f", "tee"]);
    const tee = a[a.length - 1] as string;
    expect(tee.split("|")).toHaveLength(2);
    expect(tee).toContain("onfail=ignore");
    expect(a[a.indexOf("-f") + 1]).toBe("mp4");
  });
  it("parses -progress blocks", () => {
    let blk = {};
    let done = false;
    for (const l of [
      "frame=120",
      "fps=29.97",
      "bitrate=2876.4kbits/s",
      "out_time_us=4004000",
      "speed=1.01x",
      "drop_frames=2",
      "progress=continue",
    ]) {
      const r = applyProgressLine(blk, l);
      blk = r.block;
      done = r.done;
    }
    expect(done).toBe(true);
    expect(blk).toMatchObject({
      frame: 120,
      fps: 29.97,
      bitrateKbps: 2876.4,
      outTimeMs: 4004,
      speed: 1.01,
      dropped: 2,
    });
    expect(applyProgressLine({}, "bitrate=N/A").block).toEqual({});
  });
});

/* ------------------------------ API level ------------------------------ */

const BASE = "http://studio.test";
let clock = 5_000_000;
let api: LiveApi;
let procs: FakeProc[];

class FakeProc implements LiveProc {
  writes: Uint8Array[] = [];
  ended = false;
  killed: string[] = [];
  out: ((l: string) => void)[] = [];
  err: ((l: string) => void)[] = [];
  exit: ((c: number | null, s: string | null) => void)[] = [];
  constructor(readonly args: string[]) {}
  async write(chunk: Uint8Array) {
    if (this.ended) throw new Error("gone");
    this.writes.push(chunk);
  }
  endInput() {
    this.ended = true;
    queueMicrotask(() => this.die(0));
  }
  kill(s: "SIGTERM" | "SIGKILL") {
    this.killed.push(s);
    this.die(null, s);
  }
  onStdout(cb: (l: string) => void) {
    this.out.push(cb);
  }
  onStderr(cb: (l: string) => void) {
    this.err.push(cb);
  }
  onExit(cb: (c: number | null, s: string | null) => void) {
    this.exit.push(cb);
  }
  die(code: number | null, sig: string | null = null) {
    this.ended = true;
    for (const c of this.exit) c(code, sig);
    this.exit = [];
  }
  progress(frame: number) {
    for (const l of [
      `frame=${frame}`,
      "fps=30",
      "bitrate=2500kbits/s",
      "speed=1x",
      "progress=continue",
    ])
      for (const c of this.out) c(l);
  }
}

function make(over: Partial<LiveConfig> = {}) {
  procs = [];
  api = createLiveApi({
    config: cfg(over),
    now: () => clock,
    resolver: publicDns,
    spawner: async (_cmd, args) => {
      const p = new FakeProc(args);
      procs.push(p);
      return p;
    },
    randomId: () => "sess01",
  });
}

async function call(
  path: string,
  o: {
    method?: string;
    body?: unknown;
    raw?: Uint8Array;
    token?: string | null;
    ip?: string;
  } = {},
) {
  const headers: Record<string, string> = {
    "x-forwarded-for": o.ip ?? "1.2.3.4",
  };
  if (o.token !== null) headers["authorization"] = `Bearer ${o.token ?? TOKEN}`;
  const init: RequestInit = { method: o.method ?? "GET", headers };
  if (o.raw) init.body = o.raw as unknown as BodyInit;
  else if (o.body !== undefined) init.body = JSON.stringify(o.body);
  const res = await api.handle(new Request(`${BASE}${path}`, init));
  return {
    status: res?.status ?? -1,
    data: (res ? await res.json() : null) as Record<string, any>,
  };
}

const START = {
  destinations: [{ label: "YouTube", server: YT, key: KEY }],
  video: { width: 1280, height: 720, fps: 30, kbps: 3000 },
};

beforeEach(() => {
  clock = 5_000_000;
  vi.useFakeTimers();
  make();
});
afterEach(async () => {
  await api.dispose();
  vi.useRealTimers();
});

describe("live API: access", () => {
  it("is off when no token is configured", async () => {
    make({ token: null });
    expect(
      (await call("/api/live/health", { token: null })).data["enabled"],
    ).toBe(false);
    expect((await call("/api/live/status")).status).toBe(503);
  });
  it("health is public and says enabled", async () => {
    const r = await call("/api/live/health", { token: null });
    expect(r.data).toMatchObject({ enabled: true });
  });
  it("needs the bearer token and throttles guessing", async () => {
    expect((await call("/api/live/status", { token: null })).status).toBe(403);
    expect((await call("/api/live/status", { token: "wrong" })).status).toBe(
      403,
    );
    for (let i = 0; i < LIVE_LIMITS.authFailPer10Min; i++)
      await call("/api/live/status", { token: "guess" + i, ip: "6.6.6.6" });
    expect((await call("/api/live/status", { ip: "6.6.6.6" })).status).toBe(
      429,
    );
    // other clients are unaffected
    expect((await call("/api/live/status", { ip: "7.7.7.7" })).status).toBe(
      200,
    );
  });
  it("ignores paths outside /api/live", async () => {
    const res = await api.handle(new Request(`${BASE}/api/room/health`));
    expect(res).toBeNull();
  });
});

describe("live API: session", () => {
  it("validates the request body and destinations", async () => {
    expect(
      (await call("/api/live/session", { method: "POST", body: {} })).status,
    ).toBe(400);
    expect(
      (
        await call("/api/live/session", {
          method: "POST",
          body: { ...START, video: { ...START.video, width: 1281 } },
        })
      ).status,
    ).toBe(400);
    const bad = await call("/api/live/session", {
      method: "POST",
      body: {
        ...START,
        destinations: [
          START.destinations[0],
          { server: "rtmps://evil.example.com/x", key: KEY },
        ],
      },
    });
    expect(bad.status).toBe(400);
    expect(bad.data).toMatchObject({
      error: "bad-destination",
      index: 1,
      reason: "host-not-allowed",
    });
    expect(procs).toHaveLength(0);
    const hi = await call("/api/live/session", {
      method: "POST",
      body: { ...START, video: { ...START.video, kbps: 20000 } },
    });
    expect(hi.data["error"]).toBe("bitrate-too-high");
  });

  it("starts ffmpeg without ever returning the stream key", async () => {
    const r = await call("/api/live/session", { method: "POST", body: START });
    expect(r.status).toBe(201);
    expect(JSON.stringify(r.data)).not.toContain(KEY);
    expect(r.data["session"]).toMatchObject({
      id: "sess01",
      state: "starting",
    });
    expect(r.data["session"].destinations).toEqual([
      { label: "YouTube", host: "a.rtmps.youtube.com", secure: true },
    ]);
    expect(procs[0]?.args.at(-1)).toBe(`${YT}/${KEY}`);
    const st = await call("/api/live/status");
    expect(JSON.stringify(st.data)).not.toContain(KEY);
    expect(st.data["session"].id).toBe("sess01");
  });

  it("allows only one session at a time", async () => {
    await call("/api/live/session", { method: "POST", body: START });
    const again = await call("/api/live/session", {
      method: "POST",
      body: START,
    });
    expect(again.status).toBe(409);
    expect(again.data["session"].id).toBe("sess01");
    expect(JSON.stringify(again.data)).not.toContain(KEY);
  });

  it("reports a missing ffmpeg binary", async () => {
    api = createLiveApi({
      config: cfg(),
      resolver: publicDns,
      spawner: async () => {
        throw new Error("ENOENT");
      },
    });
    const r = await call("/api/live/session", { method: "POST", body: START });
    expect(r.status).toBe(503);
    expect(r.data["error"]).toBe("ffmpeg-missing");
  });

  it("feeds chunks in order, tolerates retries and refuses gaps", async () => {
    await call("/api/live/session", { method: "POST", body: START });
    const post = (seq: number, bytes: number[]) =>
      call(`/api/live/session/sess01/chunk?seq=${seq}`, {
        method: "POST",
        raw: new Uint8Array(bytes),
      });
    expect((await post(0, [1, 2])).data).toMatchObject({ ok: true, next: 1 });
    expect((await post(0, [1, 2])).data).toMatchObject({
      duplicate: true,
      next: 1,
    });
    const gap = await post(5, [9]);
    expect(gap.status).toBe(409);
    expect(gap.data).toMatchObject({ error: "bad-seq", expected: 1 });
    expect((await post(1, [3])).data["next"]).toBe(2);
    expect(procs[0]?.writes.map((w) => Array.from(w))).toEqual([[1, 2], [3]]);
    expect(
      (
        await call("/api/live/session/sess01/chunk?seq=x", {
          method: "POST",
          raw: new Uint8Array(1),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("/api/live/session/nope/chunk?seq=0", {
          method: "POST",
          raw: new Uint8Array(1),
        })
      ).status,
    ).toBe(404);
    const big = await call("/api/live/session/sess01/chunk?seq=2", {
      method: "POST",
      raw: new Uint8Array(LIVE_LIMITS.maxChunkBytes + 1),
    });
    expect(big.status).toBe(413);
  });

  it("turns live once ffmpeg reports frames and exposes progress", async () => {
    await call("/api/live/session", { method: "POST", body: START });
    procs[0]?.progress(0);
    expect((await call("/api/live/session/sess01")).data["session"].state).toBe(
      "starting",
    );
    procs[0]?.progress(90);
    const s = (await call("/api/live/session/sess01")).data["session"];
    expect(s.state).toBe("live");
    expect(s.progress).toMatchObject({
      frame: 90,
      fps: 30,
      bitrateKbps: 2500,
      speed: 1,
    });
  });

  it("stops on DELETE and then refuses media", async () => {
    await call("/api/live/session", { method: "POST", body: START });
    const del = call("/api/live/session/sess01", { method: "DELETE" });
    await vi.advanceTimersByTimeAsync(200);
    const r = await del;
    expect(r.data["session"].state).toBe("ended");
    expect(procs[0]?.ended).toBe(true);
    const late = await call("/api/live/session/sess01/chunk?seq=0", {
      method: "POST",
      raw: new Uint8Array(1),
    });
    expect(late.status).toBe(410);
    // a new session may start afterwards
    expect(
      (await call("/api/live/session", { method: "POST", body: START })).status,
    ).toBe(201);
  });

  it("surfaces an ffmpeg crash with a redacted reason", async () => {
    await call("/api/live/session", { method: "POST", body: START });
    for (const cb of procs[0]!.err)
      cb(`Error opening output ${YT}/${KEY}: Connection reset by peer`);
    procs[0]!.die(1);
    const s = (await call("/api/live/session/sess01")).data["session"];
    expect(s.state).toBe("error");
    expect(s.error).toContain("code 1");
    expect(JSON.stringify(s)).not.toContain(KEY);
    expect(JSON.stringify(s)).not.toContain("live2");
    const late = await call("/api/live/session/sess01/chunk?seq=0", {
      method: "POST",
      raw: new Uint8Array(1),
    });
    expect(late.status).toBe(410);
  });

  it("stops by itself when the browser goes silent or the time limit is hit", async () => {
    await call("/api/live/session", { method: "POST", body: START });
    clock += 25_000;
    await vi.advanceTimersByTimeAsync(2_500);
    await vi.advanceTimersByTimeAsync(200);
    const s = (await call("/api/live/session/sess01")).data["session"];
    expect(s.state).toBe("ended");
    expect(s.error).toBe("idle");

    make({ maxMinutes: 1 });
    await call("/api/live/session", { method: "POST", body: START });
    const keep = () =>
      call("/api/live/session/sess01/chunk?seq=0", {
        method: "POST",
        raw: new Uint8Array(1),
      });
    await keep();
    clock += 61_000;
    await vi.advanceTimersByTimeAsync(2_500);
    await vi.advanceTimersByTimeAsync(200);
    const t = (await call("/api/live/session/sess01")).data["session"];
    expect(t.error).toBe("max-duration");
    expect(t.state).toBe("ended");
  });

  it("kills ffmpeg when it ignores the graceful stop", async () => {
    await call("/api/live/session", { method: "POST", body: START });
    const p = procs[0]!;
    p.endInput = () => {
      p.ended = true; // input closed but the process lingers
    };
    const del = call("/api/live/session/sess01", { method: "DELETE" });
    await vi.advanceTimersByTimeAsync(LIVE_LIMITS.stopGraceMs + 100);
    expect(p.killed).toContain("SIGTERM");
    await vi.advanceTimersByTimeAsync(LIVE_LIMITS.killGraceMs + 100);
    expect((await del).data["session"].state).toBe("ended");
  });
});

describe("live API: probe", () => {
  it("refuses blocked hosts before opening any socket", async () => {
    const r = await call("/api/live/probe", {
      method: "POST",
      body: { server: "rtmps://evil.example.com/live" },
    });
    expect(r.status).toBe(400);
    expect(r.data).toMatchObject({
      error: "bad-destination",
      reason: "host-not-allowed",
    });
  });
});
