/* eslint-disable @typescript-eslint/no-explicit-any */
// src/server/media-edit.test.ts
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { memoryStore } from "./catalog";
import { ffprobeProber } from "./ffprobe";
import { ffmpegPoster } from "./ffmpeg";
import { createMediaApi, type MediaRecord } from "./media";
import {
  createMediaEditApi,
  editSpecSchema,
  PlanError,
  planEdit,
  remapChapters,
  type PlanInput,
} from "./media-edit";
import { whisperCommand, whisperFromEnv } from "./whisper";

const rec = (o: Partial<MediaRecord> = {}): MediaRecord => ({
  id: "0123456789abcdef",
  kind: "video",
  mime: "video/webm",
  file: "0123456789abcdef.webm",
  size: 1000,
  title: "Röportaj",
  filename: "r.webm",
  durationMs: 60_000,
  width: 1280,
  height: 720,
  hasAudio: true,
  chapters: [],
  captions: [],
  hasPoster: false,
  origin: "studio",
  parentId: null,
  createdAt: "2026-10-22T10:00:00.000Z",
  ...o,
});

const base = (o: Partial<PlanInput> = {}): PlanInput => ({
  main: rec(),
  spec: editSpecSchema.parse({}),
  caps: { subtitles: true, loudnorm: true },
  out: "out.mp4",
  ...o,
});

describe("editSpecSchema", () => {
  it("defaults and bounds", () => {
    expect(editSpecSchema.parse({})).toMatchObject({
      fadeMs: 0,
      normalize: false,
    });
    expect(
      editSpecSchema.safeParse({ trim: { startMs: 5000, endMs: 5100 } })
        .success,
    ).toBe(false);
    expect(
      editSpecSchema.safeParse({
        intro: { kind: "card", assetId: "../etc", seconds: 3 },
      }).success,
    ).toBe(false);
    expect(
      editSpecSchema.safeParse({
        intro: { kind: "card", assetId: "0123456789abcdef", seconds: 30 },
      }).success,
    ).toBe(false);
    expect(editSpecSchema.safeParse({ burnLang: "tr; rm -rf" }).success).toBe(
      false,
    );
  });
});

describe("planEdit", () => {
  it("trims with fast input seeking and re-encodes to H.264/AAC mp4", () => {
    const p = planEdit(
      base({
        spec: editSpecSchema.parse({ trim: { startMs: 5000, endMs: 15_000 } }),
      }),
    );
    const a = p.args;
    expect(a.slice(a.indexOf("-ss"), a.indexOf("-ss") + 4)).toEqual([
      "-ss",
      "5.000",
      "-t",
      "10.000",
    ]);
    expect(a).toContain("libx264");
    expect(a).toContain("+faststart");
    expect(p.expectedMs).toBe(10_000);
    expect(p.ext).toBe("mp4");
    expect(a.join(" ")).not.toContain("subtitles=");
  });

  it("adds intro / outro and concatenates in order", () => {
    const p = planEdit(
      base({
        intro: {
          kind: "card",
          file: "aaaaaaaaaaaaaaaa.png",
          durationMs: 3000,
          hasAudio: false,
        },
        outro: {
          kind: "media",
          file: "bbbbbbbbbbbbbbbb.mp4",
          durationMs: 5000,
          hasAudio: true,
        },
      }),
    );
    const g = p.args[p.args.indexOf("-filter_complex") + 1]!;
    expect(g).toContain("concat=n=3:v=1:a=1[vc][ac]");
    expect(g.indexOf("[v0][a0][v1][a1][v2][a2]")).toBeGreaterThan(-1);
    expect(p.args).toContain("aaaaaaaaaaaaaaaa.png");
    expect(p.expectedMs).toBe(68_000);
  });

  it("fade and loudness normalisation end up in the graph", () => {
    const p = planEdit(
      base({ spec: editSpecSchema.parse({ fadeMs: 500, normalize: true }) }),
    );
    const g = p.args[p.args.indexOf("-filter_complex") + 1]!;
    expect(g).toContain("fade=t=in:st=0:d=0.500");
    expect(g).toContain("fade=t=out:st=59.500:d=0.500");
    expect(g).toContain("afade=t=out:st=59.500");
    expect(g).toContain("loudnorm=I=-16");
  });

  it("burned-in captions use trim filters so the cues stay aligned", () => {
    const p = planEdit(
      base({
        main: rec({ captions: [{ lang: "tr", label: "Türkçe" }] }),
        spec: editSpecSchema.parse({
          burnLang: "tr",
          trim: { startMs: 2000, endMs: 8000 },
        }),
        burnFile: "0123456789abcdef.tr.vtt",
      }),
    );
    const g = p.args[p.args.indexOf("-filter_complex") + 1]!;
    expect(g).toContain(
      "subtitles=0123456789abcdef.tr.vtt,trim=start=2.000:end=8.000,setpts=PTS-STARTPTS",
    );
    expect(g).toContain("atrim=start=2.000:end=8.000");
    expect(p.args).not.toContain("-ss"); // no input seeking when burning
  });

  it("a silent video gets generated silence of the cut length", () => {
    const p = planEdit(
      base({
        main: rec({ hasAudio: false }),
        spec: editSpecSchema.parse({ trim: { startMs: 0, endMs: 4000 } }),
      }),
    );
    expect(p.args.join(" ")).toContain("-f lavfi -t 4.000 -i anullsrc");
  });

  it("audio files: trim / fade / normalise only, to m4a", () => {
    const p = planEdit(
      base({
        main: rec({ kind: "audio", file: "x.mp3", mime: "audio/mpeg" }),
        spec: editSpecSchema.parse({ normalize: true }),
      }),
    );
    expect(p.ext).toBe("m4a");
    expect(p.args).toContain("-vn");
    expect(() =>
      planEdit(
        base({
          main: rec({ kind: "audio" }),
          spec: editSpecSchema.parse({
            intro: { kind: "media", mediaId: "0123456789abcdef" },
          }),
        }),
      ),
    ).toThrow(PlanError);
  });

  it("rejects impossible requests", () => {
    expect(() =>
      planEdit(
        base({
          spec: editSpecSchema.parse({
            trim: { startMs: 90_000, endMs: 95_000 },
          }),
        }),
      ),
    ).toThrow("trim-out-of-range");
    expect(() =>
      planEdit(
        base({
          spec: editSpecSchema.parse({ normalize: true }),
          caps: { subtitles: true, loudnorm: false },
        }),
      ),
    ).toThrow("loudnorm-unavailable");
    expect(() =>
      planEdit(
        base({
          spec: editSpecSchema.parse({ burnLang: "tr" }),
          caps: { subtitles: false, loudnorm: true },
          burnFile: "x.vtt",
        }),
      ),
    ).toThrow("burn-unavailable");
  });
});

describe("remapChapters", () => {
  it("keeps chapters inside the cut and shifts them past the intro", () => {
    const ch = [
      { t: 0, label: "A" },
      { t: 5000, label: "B" },
      { t: 20_000, label: "C" },
    ];
    expect(remapChapters(ch, 4000, 15_000, 3000)).toEqual([
      { t: 4000, label: "B" },
    ]);
    expect(remapChapters(ch, 0, null, 0)).toHaveLength(3);
  });
});

describe("whisper command builder", () => {
  it("builds argument lists for each backend and validates env", () => {
    const cpp = whisperFromEnv({
      WHISPER_BACKEND: "whisper-cpp",
      WHISPER_MODEL: "/m/ggml-small.bin",
      WHISPER_THREADS: "4",
    })!;
    const c = whisperCommand(cpp, "/tmp/a.wav", "/tmp/out", "tr");
    expect(c.args).toEqual([
      "-m",
      "/m/ggml-small.bin",
      "-f",
      "/tmp/a.wav",
      "-l",
      "tr",
      "-t",
      "4",
      "-ovtt",
      "-of",
      "/tmp/out/a",
      "-pp",
    ]);
    expect(c.outFile).toBe("/tmp/out/a.vtt");
    const ct = whisperFromEnv({ WHISPER_BACKEND: "whisper-ctranslate2" })!;
    expect(whisperCommand(ct, "/tmp/a.wav", "/o", "en").args).toContain(
      "--compute_type",
    );
    expect(
      whisperCommand(ct, "/tmp/a.wav", "/o", "../../x").args,
    ).not.toContain("--language");
    expect(whisperFromEnv({ WHISPER_BACKEND: "whisper-cpp" })).toBeNull(); // needs a model file
    expect(whisperFromEnv({ WHISPER_BACKEND: "nope" })).toBeNull();
    expect(whisperFromEnv({})).toBeNull();
  });
});

/* -------- end to end with the real ffmpeg (skipped where it is not installed) -------- */

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasFfmpeg)("edit + subtitles with real ffmpeg", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "edit-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const TOKEN = "t".repeat(20);

  async function setup(whisperScript?: string) {
    const store = memoryStore<MediaRecord>();
    const probe = ffprobeProber();
    const media = createMediaApi({
      token: TOKEN,
      store,
      dir,
      probe,
      poster: (i, o) => ffmpegPoster("ffmpeg", i, o),
    });
    let whisper = null;
    if (whisperScript) {
      const bin = join(dir, "fake-whisper");
      await writeFile(bin, whisperScript);
      await chmod(bin, 0o755);
      whisper = {
        backend: "whisper-cpp" as const,
        bin,
        model: "m.bin",
        threads: 1,
        timeoutMs: 60_000,
      };
    }
    const edit = createMediaEditApi({
      token: TOKEN,
      media,
      ffmpegBin: "ffmpeg",
      probe,
      whisper,
    });
    const call = async (
      method: string,
      path: string,
      body?: BodyInit,
      headers: Record<string, string> = {},
    ) => {
      const req = new Request(`http://x${path}`, {
        method,
        headers: { authorization: `Bearer ${TOKEN}`, ...headers },
        ...(body !== undefined ? { body } : {}),
      });
      return (await edit.handle(req)) ?? (await media.handle(req))!;
    };
    return { store, call, media };
  }

  const makeVideo = (
    name: string,
    seconds: number,
    audio = true,
    size = "320x180",
  ) => {
    const out = join(dir, name);
    execFileSync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `testsrc=duration=${seconds}:size=${size}:rate=25`,
      ...(audio
        ? [
            "-f",
            "lavfi",
            "-i",
            `sine=frequency=440:duration=${seconds}`,
            "-c:a",
            "libopus",
          ]
        : []),
      "-c:v",
      "libvpx",
      "-b:v",
      "200k",
      out,
    ]);
    return out;
  };

  const upload = async (
    s: Awaited<ReturnType<typeof setup>>,
    path: string,
    headers: Record<string, string> = {},
  ) => {
    const body = await readFile(path);
    const r = await s.call("POST", "/api/media", body, {
      "content-type": "video/webm",
      ...headers,
    });
    return ((await r.json()) as any).media as MediaRecord;
  };

  const waitJob = async (s: Awaited<ReturnType<typeof setup>>, id: string) => {
    for (let i = 0; i < 300; i++) {
      const j = (
        (await (await s.call("GET", `/api/media/jobs/${id}`)).json()) as any
      ).job;
      if (j.status === "done" || j.status === "error") return j;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("job timeout");
  };

  it("trim + title-card intro + fade + normalise produces a playable mp4 of the right length", async () => {
    const s = await setup();
    const main = await upload(s, makeVideo("main.webm", 8), {
      "x-chapters": encodeURIComponent(
        JSON.stringify([
          { t: 0, label: "Başla" },
          { t: 4000, label: "Orta" },
        ]),
      ),
    });
    expect(main.hasPoster).toBe(true);

    // a title card: any PNG
    const png = join(dir, "card.png");
    execFileSync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=0x0b1220:s=640x360",
      "-frames:v",
      "1",
      png,
    ]);
    const asset = await s.call("POST", "/api/media/asset", await readFile(png));
    expect(asset.status).toBe(201);
    const assetId = ((await asset.json()) as any).media.id;

    const res = await s.call(
      "POST",
      `/api/media/${main.id}/edit`,
      JSON.stringify({
        spec: {
          title: "Kısaltılmış",
          trim: { startMs: 2000, endMs: 6000 },
          intro: { kind: "card", assetId, seconds: 2 },
          fadeMs: 300,
          normalize: true,
        },
      }),
    );
    expect(res.status).toBe(202);
    const job = await waitJob(s, ((await res.json()) as any).job.id);
    expect(job.error).toBeNull();
    expect(job.status).toBe("done");

    const out = (await s.store.list()).find((r) => r.id === job.resultId)!;
    expect(out).toMatchObject({
      kind: "video",
      mime: "video/mp4",
      origin: "edit",
      parentId: main.id,
      title: "Kısaltılmış",
      hasPoster: true,
    });
    expect(out.durationMs!).toBeGreaterThan(5500);
    expect(out.durationMs!).toBeLessThan(6600); // 2 s card + 4 s cut
    expect(out.chapters).toEqual([{ t: 4000, label: "Orta" }]); // 4000 - 2000 cut + 2000 intro
    // streams really are H.264 + AAC
    const info = JSON.parse(
      execFileSync("ffprobe", [
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_streams",
        join(dir, out.file),
      ]).toString(),
    );
    expect(info.streams.map((x: any) => x.codec_name).sort()).toEqual([
      "aac",
      "h264",
    ]);
  }, 60_000);

  it("a video can be an outro, and silent footage keeps working", async () => {
    const s = await setup();
    const main = await upload(s, makeVideo("a.webm", 3, false));
    const outro = await upload(s, makeVideo("b.webm", 2, true, "640x360"));
    const res = await s.call(
      "POST",
      `/api/media/${main.id}/edit`,
      JSON.stringify({ spec: { outro: { kind: "media", mediaId: outro.id } } }),
    );
    const job = await waitJob(s, ((await res.json()) as any).job.id);
    expect(job.error).toBeNull();
    const out = (await s.store.list()).find((r) => r.id === job.resultId)!;
    expect(out.durationMs!).toBeGreaterThan(4500);
    expect(out.durationMs!).toBeLessThan(5700);
  }, 60_000);

  it("rejects bad specs and reports failures instead of hanging", async () => {
    const s = await setup();
    const main = await upload(s, makeVideo("a.webm", 2));
    expect(
      (
        await s.call(
          "POST",
          `/api/media/${main.id}/edit`,
          JSON.stringify({ spec: { fadeMs: 99999 } }),
        )
      ).status,
    ).toBe(400);
    const missing = await s.call(
      "POST",
      `/api/media/${main.id}/edit`,
      JSON.stringify({
        spec: {
          intro: { kind: "card", assetId: "ffffffffffffffff", seconds: 2 },
        },
      }),
    );
    const job = await waitJob(s, ((await missing.json()) as any).job.id);
    expect(job).toMatchObject({ status: "error", error: "asset-missing" });
    expect(
      (await s.call("POST", `/api/media/${main.id}/edit`, "{bad")).status,
    ).toBe(400);
  }, 60_000);

  it("assets must be real PNGs", async () => {
    const s = await setup();
    expect(
      (
        await s.call(
          "POST",
          "/api/media/asset",
          new Uint8Array([1, 2, 3, 4, 5]),
        )
      ).status,
    ).toBe(415);
    expect(
      (await s.call("POST", "/api/media/asset", new Uint8Array(0))).status,
    ).toBe(413);
  });

  it("generates subtitles through the Whisper CLI, installs them and serves them", async () => {
    // a stand-in for whisper-cli: honours --help and writes <of>.vtt
    const fake = `#!/bin/sh
for a in "$@"; do [ "$a" = "--help" ] && exit 0; done
while [ $# -gt 0 ]; do [ "$1" = "-of" ] && OF="$2"; shift; done
echo "progress = 50%"
printf 'WEBVTT\\n\\n00:00:00.500 --> 00:00:02.000\\nMerhaba dünya\\n\\n00:00:02.500 --> 00:00:04.000\\nİkinci satır\\n' > "$OF.vtt"
echo "progress = 100%"
`;
    const s = await setup(fake);
    const main = await upload(s, makeVideo("a.webm", 3));
    const caps = (await (
      await s.call("GET", "/api/media/capabilities")
    ).json()) as any;
    expect(caps).toMatchObject({
      ffmpeg: { available: true, libx264: true },
      whisper: { backend: "whisper-cpp", available: true },
    });

    const res = await s.call(
      "POST",
      `/api/media/${main.id}/subtitles`,
      JSON.stringify({ lang: "tr" }),
    );
    expect(res.status).toBe(202);
    const job = await waitJob(s, ((await res.json()) as any).job.id);
    expect(job).toMatchObject({ status: "done", error: null });
    const updated = (await s.store.list()).find((r) => r.id === main.id)!;
    expect(updated.captions).toEqual([{ lang: "tr", label: "Türkçe" }]);
    const vtt = await s.call("GET", `/media/${main.id}/captions/tr.vtt`);
    expect(vtt.headers.get("content-type")).toContain("text/vtt");
    expect(await vtt.text()).toContain("Merhaba dünya");

    // manual edit + bad input + delete
    const put = await s.call(
      "PUT",
      `/api/media/${main.id}/captions/en`,
      "1\n00:00:01,000 --> 00:00:02,000\nHello\n",
    );
    expect(put.status).toBe(200);
    expect(((await put.json()) as any).media.captions).toHaveLength(2);
    expect(
      (
        await s.call(
          "PUT",
          `/api/media/${main.id}/captions/en`,
          "not subtitles",
        )
      ).status,
    ).toBe(400);
    expect(
      (
        (await (
          await s.call("DELETE", `/api/media/${main.id}/captions/en`)
        ).json()) as any
      ).media.captions,
    ).toHaveLength(1);

    // burn the generated captions into a new video
    const burn = await s.call(
      "POST",
      `/api/media/${main.id}/edit`,
      JSON.stringify({
        spec: { burnLang: "tr", trim: { startMs: 0, endMs: 2500 } },
      }),
    );
    const bj = await waitJob(s, ((await burn.json()) as any).job.id);
    expect(bj.error).toBeNull();
  }, 90_000);

  it("subtitles are refused when Whisper is not configured", async () => {
    const s = await setup();
    const main = await upload(s, makeVideo("a.webm", 2));
    const r = await s.call(
      "POST",
      `/api/media/${main.id}/subtitles`,
      JSON.stringify({ lang: "tr" }),
    );
    expect(r.status).toBe(503);
    expect(((await r.json()) as any).error).toBe("whisper-unavailable");
  }, 30_000);
});
