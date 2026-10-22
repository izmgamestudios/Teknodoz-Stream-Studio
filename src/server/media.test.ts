/* eslint-disable @typescript-eslint/no-explicit-any */
// src/server/media.test.ts
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { memoryStore } from "./catalog";
import { createMediaApi, type MediaRecord, type Prober } from "./media";

const TOKEN = "t".repeat(20);
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "media-test-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const okProbe: Prober = async () => ({
  durationMs: 4200,
  width: 1280,
  height: 720,
  hasVideo: true,
  hasAudio: true,
});

function setup(o: { probe?: Prober | undefined; maxBytes?: number } = {}) {
  const store = memoryStore<MediaRecord>();
  const api = createMediaApi({
    token: TOKEN,
    store,
    dir,
    ...(o.maxBytes ? { maxBytes: o.maxBytes } : {}),
    ...("probe" in o
      ? o.probe
        ? { probe: o.probe }
        : {}
      : { probe: okProbe }),
    now: () => Date.parse("2026-10-22T12:00:00Z"),
  });
  const call = async (
    method: string,
    path: string,
    init: {
      body?: BodyInit | Uint8Array;
      headers?: Record<string, string>;
      auth?: boolean;
    } = {},
  ) => {
    const res = await api.handle(
      new Request(`http://x${path}`, {
        method,
        headers: {
          ...(init.auth === false ? {} : { authorization: `Bearer ${TOKEN}` }),
          ...init.headers,
        },
        ...(init.body !== undefined ? { body: init.body as BodyInit } : {}),
      }),
    );
    return res!;
  };
  return { api, store, call };
}

const bytes = (n: number) =>
  new Uint8Array(Array.from({ length: n }, (_, i) => i % 251));

describe("media upload", () => {
  it("ignores other paths; admin routes need the token", async () => {
    const s = setup();
    expect(await s.api.handle(new Request("http://x/api/catalog"))).toBeNull();
    expect((await s.call("POST", "/api/media", { auth: false })).status).toBe(
      401,
    );
    expect((await s.call("GET", "/api/media", { auth: false })).status).toBe(
      401,
    );
  });

  it("stores the file, probes it and creates a record", async () => {
    const s = setup();
    const res = await s.call("POST", "/api/media", {
      body: bytes(5000),
      headers: {
        "content-type": "video/webm;codecs=vp9,opus",
        "x-title": encodeURIComponent("Röportaj Şubat"),
        "x-filename": encodeURIComponent("kayıt.webm"),
        "x-origin": "studio",
        "x-chapters": encodeURIComponent(
          JSON.stringify([
            { t: 0, label: "Başlangıç" },
            { t: 3000, label: "Soru 1" },
          ]),
        ),
      },
    });
    expect(res.status).toBe(201);
    const { media } = (await res.json()) as any;
    expect(media).toMatchObject({
      kind: "video",
      mime: "video/webm",
      size: 5000,
      title: "Röportaj Şubat",
      origin: "studio",
      durationMs: 4200,
      width: 1280,
      chapters: [{ t: 0 }, { t: 3000 }],
    });
    expect(media.id).toMatch(/^[a-f0-9]{16}$/);
    expect((await readFile(join(dir, media.file))).length).toBe(5000);
    expect(await readdir(dir)).toEqual([media.file]); // no .part left behind
    expect(
      ((await (await s.call("GET", "/api/media")).json()) as any).media,
    ).toHaveLength(1);
  });

  it("rejects unsupported types, empty bodies, oversize files and non-media", async () => {
    const s = setup({ maxBytes: 1000 });
    const post = (type: string, body: Uint8Array) =>
      s.call("POST", "/api/media", { body, headers: { "content-type": type } });
    expect((await post("text/html", bytes(10))).status).toBe(415);
    expect((await post("application/x-msdownload", bytes(10))).status).toBe(
      415,
    );
    expect((await post("video/mp4", new Uint8Array(0))).status).toBe(400);
    expect((await post("video/mp4", bytes(2000))).status).toBe(413);
    expect(await readdir(dir)).toEqual([]);

    const strict = setup({
      probe: async () => ({
        durationMs: 1,
        width: null,
        height: null,
        hasVideo: false,
        hasAudio: false,
      }),
    });
    const r = await strict.call("POST", "/api/media", {
      body: bytes(50),
      headers: { "content-type": "video/mp4" },
    });
    expect(r.status).toBe(415);
    expect(await readdir(dir)).toEqual([]);
  });

  it("accepts files when ffprobe is not installed", async () => {
    const s = setup({ probe: undefined });
    const r = await s.call("POST", "/api/media", {
      body: bytes(100),
      headers: { "content-type": "audio/mpeg" },
    });
    expect(r.status).toBe(201);
    expect(((await r.json()) as any).media).toMatchObject({
      kind: "audio",
      durationMs: null,
    });
  });
});

describe("media serving", () => {
  async function uploaded() {
    const s = setup();
    const r = await s.call("POST", "/api/media", {
      body: bytes(1000),
      headers: { "content-type": "video/mp4" },
    });
    const media = ((await r.json()) as any).media as MediaRecord;
    return { ...s, media };
  }

  it("streams the whole file publicly with safe headers", async () => {
    const { call, media } = await uploaded();
    const res = await call(`GET`, `/media/${media.id}`, { auth: false });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes(1000));
  });

  it("supports byte ranges (206) and rejects bad ones (416)", async () => {
    const { call, media } = await uploaded();
    const get = (range: string) =>
      call("GET", `/media/${media.id}`, { auth: false, headers: { range } });
    const a = await get("bytes=10-19");
    expect(a.status).toBe(206);
    expect(a.headers.get("content-range")).toBe("bytes 10-19/1000");
    expect(new Uint8Array(await a.arrayBuffer())).toEqual(
      bytes(1000).slice(10, 20),
    );
    const b = await get("bytes=990-");
    expect(b.headers.get("content-range")).toBe("bytes 990-999/1000");
    const c = await get("bytes=-5");
    expect(c.headers.get("content-range")).toBe("bytes 995-999/1000");
    expect((await get("bytes=5000-6000")).status).toBe(416);
    expect((await get("bytes=x-y")).status).toBe(416);
    expect(
      (await call("HEAD", `/media/${media.id}`, { auth: false })).headers.get(
        "content-length",
      ),
    ).toBe("1000");
  });

  it("only serves known ids and never touches paths outside the library", async () => {
    const { call, media } = await uploaded();
    for (const p of [
      "/media/..%2F..%2Fetc%2Fpasswd",
      "/media/0000000000000000",

      `/media/${media.id}/poster.jpg`,
      `/media/${media.id}/captions/xx.vtt`,
      `/media/${media.id}/other`,
    ])
      expect((await call("GET", p, { auth: false })).status).toBe(404);
    expect(
      (await call("POST", `/media/${media.id}`, { auth: false })).status,
    ).toBe(405);
  });

  it("URL normalisation can never reach outside /media", async () => {
    const { api } = await uploaded();
    // "/media/../etc/passwd" is normalised to "/etc/passwd" by the URL parser: not ours at all
    expect(
      await api.handle(new Request("http://x/media/../etc/passwd")),
    ).toBeNull();
  });

  it("renames and deletes (record and every file)", async () => {
    const { call, store, media } = await uploaded();
    await writeFile(join(dir, `${media.id}.tr.vtt`), "WEBVTT");
    const ren = await call("PATCH", `/api/media/${media.id}`, {
      body: JSON.stringify({ title: "Yeni ad" }),
    });
    expect(((await ren.json()) as any).media.title).toBe("Yeni ad");
    expect(
      (
        await call("PATCH", `/api/media/${media.id}`, {
          body: JSON.stringify({ title: " " }),
        })
      ).status,
    ).toBe(400);
    expect((await call("DELETE", `/api/media/${media.id}`)).status).toBe(200);
    expect(await store.list()).toHaveLength(0);
    expect(await readdir(dir)).toEqual([]);
    expect(
      (await call("GET", `/media/${media.id}`, { auth: false })).status,
    ).toBe(404);
  });
});

describe("storage usage and quota", () => {
  it("reports used bytes, counts and disk space", async () => {
    const s = setup();
    await s.call("POST", "/api/media", {
      body: bytes(3000),
      headers: { "content-type": "video/mp4" },
    });
    await s.call("POST", "/api/media", {
      body: bytes(500),
      headers: { "content-type": "audio/mpeg" },
    });
    const r = (await (await s.call("GET", "/api/media/storage")).json()) as any;
    expect(r.storage).toMatchObject({
      usedBytes: 3500,
      files: 2,
      videos: 1,
      audios: 1,
      quotaBytes: null,
    });
    expect(r.storage.diskTotalBytes).toBeGreaterThan(r.storage.diskFreeBytes);
    expect(
      (await s.call("GET", "/api/media/storage", { auth: false })).status,
    ).toBe(401);
  });

  it("refuses uploads that would exceed the quota, early and while streaming", async () => {
    const store = memoryStore<MediaRecord>();
    const api = createMediaApi({ token: TOKEN, store, dir, quotaBytes: 5000 });
    const post = (n: number, extra: Record<string, string> = {}) =>
      api.handle(
        new Request("http://x/api/media", {
          method: "POST",
          headers: {
            authorization: `Bearer ${TOKEN}`,
            "content-type": "video/mp4",
            ...extra,
          },
          body: bytes(n) as BodyInit,
        }),
      );
    expect((await post(3000))!.status).toBe(201);
    const over = await post(3000);
    expect(over!.status).toBe(507);
    expect(((await over!.json()) as any).error).toBe("quota-exceeded");
    expect((await post(1500))!.status).toBe(201); // 4500 <= 5000
    expect(await readdir(dir)).toHaveLength(2); // nothing left over from the refused upload
  });
});
