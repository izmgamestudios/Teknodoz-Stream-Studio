/* eslint-disable @typescript-eslint/no-explicit-any */
// End-to-end check of the live bridge with the REAL ffmpeg: a WebM stream is POSTed in chunks,
// re-encoded and pushed (plain RTMP) to a local ffmpeg listener; the captured FLV is probed.
// Skipped automatically when ffmpeg/ffprobe are not installed. RTMPS itself needs TLS and a
// real platform, so that part is only covered by unit tests of the command line.
import { execFile, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterAll, describe, expect, it } from "vitest";

import { createLiveApi } from "./live";
import { liveConfigFromEnv } from "./live-policy";

const run = promisify(execFile);
const has = await run("ffmpeg", ["-version"]).then(
  () => true,
  () => false,
);
const hasProbe =
  has &&
  (await run("ffprobe", ["-version"]).then(
    () => true,
    () => false,
  ));

const TOKEN = "e2e-token-0123456789";
const tmp = mkdtempSync(join(tmpdir(), "tkz-live-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe.skipIf(!hasProbe)("live bridge with real ffmpeg", () => {
  it("re-encodes a posted WebM stream and publishes it over RTMP", async () => {
    const port = 19350 + Math.floor(Math.random() * 400);
    const out = join(tmp, "captured.flv");

    // 1) a local RTMP "platform"
    const listener = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-listen",
        "1",
        "-i",
        `rtmp://127.0.0.1:${port}/live/e2ekey`,
        "-c",
        "copy",
        out,
      ],
      { stdio: "ignore" },
    );
    const listenerDone = new Promise<number | null>((r) =>
      listener.once("exit", (c) => r(c)),
    );
    await sleep(700);

    // 2) 4 s of VP8 + Opus as the browser's MediaRecorder would produce it
    const { stdout } = (await new Promise<{ stdout: Buffer }>(
      (resolve, reject) => {
        const p = spawn(
          "ffmpeg",
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=640x360:rate=30",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000",
            "-t",
            "4",
            "-c:v",
            "libvpx",
            "-b:v",
            "600k",
            "-c:a",
            "libopus",
            "-f",
            "webm",
            "pipe:1",
          ],
          { stdio: ["ignore", "pipe", "inherit"] },
        );
        const bufs: Buffer[] = [];
        p.stdout.on("data", (d: Buffer) => bufs.push(d));
        p.once("error", reject);
        p.once("exit", () => resolve({ stdout: Buffer.concat(bufs) }));
      },
    )) as { stdout: Buffer };
    expect(stdout.length).toBeGreaterThan(10_000);

    // 3) the API under test (real spawner, local ingest explicitly allowed)
    const api = createLiveApi({
      config: liveConfigFromEnv({
        LIVE_ADMIN_TOKEN: TOKEN,
        LIVE_ALLOW_PRIVATE: "1",
      }),
    });
    const call = async (path: string, init: RequestInit = {}) => {
      const res = await api.handle(
        new Request(`http://studio.test${path}`, {
          ...init,
          headers: {
            authorization: `Bearer ${TOKEN}`,
            "x-forwarded-for": "9.9.9.9",
          },
        }),
      );
      return {
        status: res!.status,
        data: (await res!.json()) as Record<string, any>,
      };
    };

    const start = await call("/api/live/session", {
      method: "POST",
      body: JSON.stringify({
        destinations: [
          {
            label: "local",
            server: `rtmp://127.0.0.1:${port}/live`,
            key: "e2ekey",
          },
        ],
        video: { width: 640, height: 360, fps: 30, kbps: 800 },
        audioKbps: 96,
        container: "webm",
      }),
    });
    expect(start.status).toBe(201);
    const id = start.data["session"].id as string;
    expect(JSON.stringify(start.data)).not.toContain("e2ekey");

    // 4) stream the bytes in ~6 KB pieces
    const size = 6000;
    let seq = 0;
    for (let i = 0; i < stdout.length; i += size) {
      const r = await call(`/api/live/session/${id}/chunk?seq=${seq++}`, {
        method: "POST",
        body: new Uint8Array(stdout.subarray(i, i + size)),
      });
      expect(r.status, JSON.stringify(r.data)).toBe(200);
    }
    // wait until ffmpeg reports frames, then stop
    let state = "";
    for (let i = 0; i < 40 && state !== "live"; i++) {
      state = (await call(`/api/live/session/${id}`)).data["session"].state;
      if (state !== "live") await sleep(250);
    }
    const stop = await call(`/api/live/session/${id}`, { method: "DELETE" });
    expect(stop.data["session"].state).toBe("ended");
    expect(stop.data["session"].error).toBeNull();
    expect(stop.data["session"].progress.frame).toBeGreaterThan(30);

    await Promise.race([listenerDone, sleep(8000)]);
    listener.kill("SIGKILL");
    await api.dispose();

    // 5) what "the platform" received
    const probe = await run("ffprobe", [
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      out,
    ]);
    const info = JSON.parse(probe.stdout) as {
      streams: any[];
      format: { duration: string };
    };
    const v = info.streams.find((s) => s.codec_type === "video");
    const a = info.streams.find((s) => s.codec_type === "audio");
    expect(v).toMatchObject({
      codec_name: "h264",
      width: 640,
      height: 360,
      profile: "Main",
    });
    expect(a).toMatchObject({ codec_name: "aac", channels: 2 });
    expect(Number(info.format.duration)).toBeGreaterThan(2.5);
  }, 60_000);

  it("refuses private ingest targets unless the operator allows them", async () => {
    const api = createLiveApi({
      config: liveConfigFromEnv({
        LIVE_ADMIN_TOKEN: TOKEN,
        LIVE_ALLOW_ANY_HOST: "1",
      }),
    });
    const res = await api.handle(
      new Request("http://studio.test/api/live/session", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({
          destinations: [
            { server: "rtmp://127.0.0.1:1935/live", key: "e2ekey" },
          ],
          video: { width: 640, height: 360, fps: 30, kbps: 800 },
        }),
      }),
    );
    expect(res!.status).toBe(400);
    expect(await res!.json()).toMatchObject({ reason: "private-address" });
    await api.dispose();
  });
});
