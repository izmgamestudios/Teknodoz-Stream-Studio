import { describe, expect, it } from "vitest";

import { createLayer, defaultProject } from "../defaults";
import { createMemoryAssetStore } from "../storage";
import type { ProjectState } from "../types";
import { PptdzError } from "./errors";
import {
  exportPptdz,
  importPptdz,
  blobToBytes,
  PPTDZ_HEADER_BYTES,
  suggestedFilename,
  verifyPptdzHeader,
} from "./pptdz";

interface AssetJson {
  id: string;
  offset: number;
  size: number;
  mime: string;
}
interface ManifestJson {
  app: string;
  project: unknown;
  assets: [AssetJson, AssetJson];
}
const bytesOf = blobToBytes;
const streamOf = (b: Uint8Array) =>
  new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(c) {
      c.enqueue(b as Uint8Array<ArrayBuffer>);
      c.close();
    },
  });

async function fixture() {
  const src = createMemoryAssetStore();
  const img = await src.put(
    new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" }),
    {
      name: "logo.png",
      type: "image",
    },
  );
  const vid = await src.put(
    new Blob([new Uint8Array(1000).fill(7)], { type: "video/webm" }),
    {
      name: "bg.webm",
      type: "video",
    },
  );
  const project = defaultProject();
  project.name = "Test Proje";
  project.scenes[0]!.layers.push(createLayer("image", { assetId: img.id }));
  project.scenes[0]!.layers.push(createLayer("video", { assetId: vid.id }));
  return { src, project, img, vid };
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code });
  await expect(p).rejects.toBeInstanceOf(PptdzError);
}

describe("pptdz export/import", () => {
  it("round-trips project and asset bytes", async () => {
    const { src, project, img, vid } = await fixture();
    const { blob, missingAssets } = await exportPptdz(project, src);
    expect(missingAssets).toEqual([]);
    const dst = createMemoryAssetStore();
    const res = await importPptdz(blob, dst, { mode: "replace" });
    expect(res.importedAssets).toBe(2);
    expect(res.project.name).toBe("Test Proje");
    const got = await dst.get(img.id);
    expect(Array.from(await bytesOf(got!.blob))).toEqual([1, 2, 3, 4]);
    expect(got!.mime).toBe("image/png");
    expect((await dst.get(vid.id))!.blob.size).toBe(1000);
    expect(res.project.scenes[0]!.layers.map((l) => l.kind)).toEqual(
      project.scenes[0]!.layers.map((l) => l.kind),
    );
  });

  it("merge mode remaps colliding ids and rewrites layer assetIds", async () => {
    const { src, project, img } = await fixture();
    const { blob } = await exportPptdz(project, src);
    const dst = createMemoryAssetStore();
    await dst.put(
      new Blob(["other"], { type: "image/png" }),
      { name: "x", type: "image" },
      img.id,
    );
    const res = await importPptdz(blob, dst, { mode: "merge" });
    const imgLayer = res.project.scenes[0]!.layers.find(
      (l) => l.kind === "image",
    )!;
    expect(imgLayer.kind === "image" && imgLayer.assetId).not.toBe(img.id);
    expect((await dst.get(img.id))!.blob.size).toBe(5); // untouched
    const id = imgLayer.kind === "image" ? imgLayer.assetId : "";
    expect(Array.from(await bytesOf((await dst.get(id))!.blob))).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it("reports assets missing at export time", async () => {
    const { src, project } = await fixture();
    project.scenes[0]!.layers.push(createLayer("image", { assetId: "ghost" }));
    const { blob, missingAssets } = await exportPptdz(project, src);
    expect(missingAssets).toEqual(["ghost"]);
    const res = await importPptdz(blob, createMemoryAssetStore());
    expect(res.warnings.some((w) => w.includes("pakette yok"))).toBe(true);
  });

  it("suggests a safe filename", () => {
    const p: ProjectState = {
      ...defaultProject(),
      name: "../evil/Ad ğüşi?.exe",
    };
    const f = suggestedFilename(p);
    expect(f.endsWith(".pptdz")).toBe(true);
    expect(f).not.toMatch(/[\\/:?]/);
  });
});

describe("pptdz validation", () => {
  async function valid() {
    const { src, project } = await fixture();
    const { blob } = await exportPptdz(project, src);
    return { bytes: await bytesOf(blob), blob };
  }
  const run = (b: Uint8Array) =>
    importPptdz(new Blob([b as BlobPart]), createMemoryAssetStore());

  it("rejects wrong magic / version / empty file", async () => {
    const { bytes } = await valid();
    const badMagic = bytes.slice();
    badMagic[0] = 0;
    await expectCode(run(badMagic), "bad-magic");
    const badVer = bytes.slice();
    badVer[6] = 9;
    await expectCode(run(badVer), "bad-version");
    await expectCode(run(new Uint8Array(0)), "bad-magic");
  });

  it("rejects truncated files", async () => {
    const { bytes } = await valid();
    await expectCode(run(bytes.slice(0, PPTDZ_HEADER_BYTES + 5)), "corrupt");
    await expectCode(run(bytes.slice(0, bytes.length - 10)), "corrupt");
  });

  it("rejects a huge declared manifest (zip-bomb style)", async () => {
    const { bytes } = await valid();
    const b = bytes.slice();
    new DataView(b.buffer).setUint32(8, 0xffffffff, true);
    await expectCode(run(b), "too-large");
  });

  it("rejects a gzip manifest that inflates past the cap", async () => {
    const huge = new Uint8Array(40 * 1024 * 1024); // zeros compress to ~40 KB
    const gz = new Uint8Array(
      await new Response(
        streamOf(huge).pipeThrough(new CompressionStream("gzip")),
      ).arrayBuffer(),
    );
    expect(gz.length).toBeLessThan(8 * 1024 * 1024);
    const header = new Uint8Array(PPTDZ_HEADER_BYTES);
    header.set([0x50, 0x50, 0x54, 0x44, 0x5a, 0, 1, 1], 0);
    new DataView(header.buffer).setUint32(8, gz.length, true);
    await expectCode(run(new Uint8Array([...header, ...gz])), "too-large");
  });

  it("rejects tampered asset offsets and mime", async () => {
    const { src, project } = await fixture();
    const manifestOf = async (mutate: (m: ManifestJson) => void) => {
      const { blob } = await exportPptdz(project, src);
      const all = await bytesOf(blob);
      const h = verifyPptdzHeader(all);
      let body = all.slice(PPTDZ_HEADER_BYTES, h.dataStart);
      if (h.flags & 1) {
        body = new Uint8Array(
          await new Response(
            streamOf(body).pipeThrough(new DecompressionStream("gzip")),
          ).arrayBuffer(),
        );
      }
      const m = JSON.parse(new TextDecoder().decode(body));
      mutate(m);
      const nb = new TextEncoder().encode(JSON.stringify(m));
      const head = new Uint8Array(PPTDZ_HEADER_BYTES);
      head.set([0x50, 0x50, 0x54, 0x44, 0x5a, 0, 1, 0], 0);
      new DataView(head.buffer).setUint32(8, nb.length, true);
      return new Uint8Array([...head, ...nb, ...all.slice(h.dataStart)]);
    };
    await expectCode(
      run(await manifestOf((m) => (m.assets[0].offset = 10 ** 9))),
      "corrupt",
    );
    await expectCode(
      run(await manifestOf((m) => (m.assets[1].offset = m.assets[0].offset))),
      "corrupt",
    );
    await expectCode(
      run(await manifestOf((m) => (m.assets[0].size = 1))),
      "corrupt",
    );
    await expectCode(
      run(await manifestOf((m) => (m.assets[0].mime = "text/html"))),
      "unsupported-asset",
    );
    await expectCode(
      run(await manifestOf((m) => (m.assets[1].id = m.assets[0].id))),
      "corrupt",
    );
    await expectCode(
      run(await manifestOf((m) => (m.app = "other"))),
      "corrupt",
    );
    await expectCode(
      run(await manifestOf((m) => (m.project = { version: 7 }))),
      "invalid-project",
    );
  });

  it("enforces maxAssetBytes", async () => {
    const { blob } = await valid();
    await expectCode(
      importPptdz(blob, createMemoryAssetStore(), { maxAssetBytes: 10 }),
      "too-large",
    );
  });
});
