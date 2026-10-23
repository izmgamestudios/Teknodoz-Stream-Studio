/* eslint-disable @typescript-eslint/no-explicit-any */
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createListenApi, LISTEN_LIMITS } from "./listen";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "listen-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

let hasFfmpeg = true;
try {
  execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
} catch {
  hasFfmpeg = false;
}

const req = (path: string, init: RequestInit = {}) =>
  new Request(`http://x${path}`, init);

function api(allow = true) {
  return createListenApi({ ffmpegBin: "ffmpeg", canStart: () => allow });
}

describe("listen api (no ffmpeg needed)", () => {
  it("only creators/admin start a stream; status of an unknown stream is not live", async () => {
    const a = api(false);
    expect(
      (await a.handle(req("/api/listen", { method: "POST" })))!.status,
    ).toBe(401);
    expect(await (await a.handle(req("/api/listen/abcdefgh")))!.json()).toEqual(
      { live: false, title: "", listeners: 0 },
    );
    expect(await a.handle(req("/api/other"))).toBeNull();
    expect((await a.handle(req("/listen/abcdefgh/live.mp3")))!.status).toBe(
      404,
    );
  });
  it("chunks and stop need the stream's token; the number of streams is capped", async () => {
    const a = api();
    const made: any[] = [];
    for (let i = 0; i < LISTEN_LIMITS.maxStreams; i++)
      made.push(
        await (await a.handle(
          req("/api/listen", {
            method: "POST",
            body: JSON.stringify({ title: "T" }),
          }),
        ))!.json(),
      );
    expect(
      (await a.handle(req("/api/listen", { method: "POST" })))!.status,
    ).toBe(503);
    const { id } = made[0];
    expect(
      (await a.handle(
        req(`/api/listen/${id}/chunk`, {
          method: "POST",
          body: new Uint8Array(10),
        }),
      ))!.status,
    ).toBe(401);
    expect(
      (await a.handle(
        req(`/api/listen/${id}/chunk`, {
          method: "POST",
          headers: { "x-listen-token": "nope" },
          body: new Uint8Array(10),
        }),
      ))!.status,
    ).toBe(401);
    expect(
      (await a.handle(
        req(`/api/listen/${id}/stop`, {
          method: "POST",
          headers: { "x-listen-token": made[0].token },
        }),
      ))!.status,
    ).toBe(200);
    expect((await a.handle(req(`/listen/${id}/live.mp3`)))!.status).toBe(404);
    a.dispose();
  });
  it("rejects oversized and empty chunks", async () => {
    const a = api();
    const { id, token } = (await (await a.handle(
      req("/api/listen", { method: "POST" }),
    ))!.json()) as any;
    const post = (body: Uint8Array) =>
      a.handle(
        req(`/api/listen/${id}/chunk`, {
          method: "POST",
          headers: { "x-listen-token": token },
          body: body as unknown as BodyInit,
        }),
      ) as Promise<Response>;
    expect((await post(new Uint8Array(0))).status).toBe(400);
    expect(
      (await post(new Uint8Array(LISTEN_LIMITS.maxChunkBytes + 1))).status,
    ).toBe(400);
    a.dispose();
  });
});

describe.skipIf(!hasFfmpeg)("listen api with real ffmpeg", () => {
  it("turns WebM/Opus chunks into a live MP3 that a late listener can join", async () => {
    const src = join(dir, "in.webm");
    execFileSync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=4",
      "-c:a",
      "libopus",
      src,
    ]);
    const bytes = await readFile(src);
    const a = api();
    const { id, token } = (await (await a.handle(
      req("/api/listen", {
        method: "POST",
        body: JSON.stringify({ title: "Canlı" }),
      }),
    ))!.json()) as any;
    const post = (chunk: Uint8Array) =>
      a.handle(
        req(`/api/listen/${id}/chunk`, {
          method: "POST",
          headers: { "x-listen-token": token },
          body: chunk as unknown as BodyInit,
        }),
      ) as Promise<Response>;
    const size = Math.ceil(bytes.length / 4);
    await post(bytes.subarray(0, size)); // starts ffmpeg with the header chunk
    // the listener joins after the stream started
    const live = await a.handle(req(`/listen/${id}/live.mp3`));
    expect(live!.status).toBe(200);
    expect(live!.headers.get("content-type")).toBe("audio/mpeg");
    const reader = live!.body!.getReader();
    for (let i = 1; i < 4; i++)
      await post(bytes.subarray(i * size, (i + 1) * size));
    expect(
      await (await a.handle(req(`/api/listen/${id}`)))!.json(),
    ).toMatchObject({ live: true, title: "Canlı", listeners: 1 });
    let got = 0;
    let first: Uint8Array | null = null;
    const deadline = Date.now() + 8000;
    while (got < 4000 && Date.now() < deadline) {
      const r = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>((res) =>
          setTimeout(() => res({ done: true, value: undefined }), 3000),
        ),
      ]);
      if (r.done || !r.value) break;
      first ??= r.value;
      got += r.value.length;
    }
    expect(got).toBeGreaterThan(2000);
    // MP3 frame sync (0xFF 0xEx/0xFx) or an ID3 tag
    const b0 = first![0]!;
    const b1 = first![1]!;
    expect(
      (b0 === 0xff && (b1 & 0xe0) === 0xe0) || (b0 === 0x49 && b1 === 0x44),
    ).toBe(true);
    await a.handle(
      req(`/api/listen/${id}/stop`, {
        method: "POST",
        headers: { "x-listen-token": token },
      }),
    );
    a.dispose();
  }, 30_000);
});
