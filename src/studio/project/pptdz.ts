// src/studio/project/pptdz.ts
// `.pptdz` portable project package.
//
//   offset  size  field
//   0       6     magic "PPTDZ\0"
//   6       1     format version (1)
//   7       1     flags (bit0: manifest is gzip-compressed)
//   8       4     manifest length, u32 little-endian
//   12      n     manifest (JSON, UTF-8)
//   12+n    ...   raw asset blobs, concatenated (offsets in the manifest are relative to here)
//
// The output is assembled with `new Blob([...])`, so large videos are never copied into JS
// memory. Import slices the file lazily and validates every number before trusting it.
import { z } from "zod";

import { uid } from "../defaults";
import type { AssetStore, AssetType, ProjectState } from "../types";
import { PptdzError } from "./errors";
import { parseProject } from "./schema";
import { assetIdsInProject } from "./store";

export const PPTDZ_MAGIC = [0x50, 0x50, 0x54, 0x44, 0x5a, 0x00] as const; // "PPTDZ\0"
export const PPTDZ_FORMAT_VERSION = 1;
export const PPTDZ_HEADER_BYTES = 12;
export const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
/** Hard cap on the DEcompressed manifest (zip-bomb guard). */
export const MAX_MANIFEST_INFLATED_BYTES = 32 * 1024 * 1024;
export const MAX_ASSETS = 500;
const FLAG_GZIP = 1;

export interface PptdzProgress {
  phase: "manifest" | "assets";
  done: number;
  total: number;
}

const assetEntry = z.object({
  id: z.string().min(1).max(128),
  name: z.string().max(300),
  type: z.enum(["image", "video", "audio"]),
  mime: z
    .string()
    .max(100)
    .regex(/^[a-z]+\/[a-z0-9.+-]+$/i),
  size: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  length: z.number().int().nonnegative(),
});
const manifestSchema = z.object({
  app: z.literal("teknodoz-studio"),
  exportedAt: z.number().optional(),
  project: z.unknown(),
  assets: z.array(assetEntry).max(MAX_ASSETS),
});
type Manifest = z.infer<typeof manifestSchema>;

/** Validate the fixed 12-byte header. `head` may be longer (e.g. the first 64 KB). */
export function verifyPptdzHeader(head: Uint8Array): {
  version: number;
  flags: number;
  manifestLength: number;
  dataStart: number;
} {
  if (head.length < PPTDZ_HEADER_BYTES) throw new PptdzError("bad-magic");
  for (let i = 0; i < PPTDZ_MAGIC.length; i++) {
    if (head[i] !== PPTDZ_MAGIC[i]) throw new PptdzError("bad-magic");
  }
  const version = head[6] as number;
  if (version !== PPTDZ_FORMAT_VERSION) throw new PptdzError("bad-version");
  const flags = head[7] as number;
  if ((flags & ~FLAG_GZIP) !== 0) throw new PptdzError("bad-version");
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const manifestLength = view.getUint32(8, true);
  if (manifestLength === 0) throw new PptdzError("corrupt");
  if (manifestLength > MAX_MANIFEST_BYTES) throw new PptdzError("too-large");
  return {
    version,
    flags,
    manifestLength,
    dataStart: PPTDZ_HEADER_BYTES + manifestLength,
  };
}

function safeBase(name: string): string {
  const s = name
    .normalize("NFKD")
    .replace(/[^\w\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return s || "proje";
}

export function suggestedFilename(project: ProjectState): string {
  return `${safeBase(project.name)}.pptdz`;
}

/** Blob -> bytes. Uses Blob.arrayBuffer when present, FileReader otherwise (old engines, jsdom). */
export function blobToBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") {
    return blob.arrayBuffer().then((b) => new Uint8Array(b));
  }
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsArrayBuffer(blob);
  });
}

function bytesStream(
  bytes: Uint8Array,
): ReadableStream<Uint8Array<ArrayBuffer>> {
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(bytes as Uint8Array<ArrayBuffer>);
      controller.close();
    },
  });
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;
  const stream = bytesStream(bytes).pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzipBounded(
  bytes: Uint8Array,
  maxBytes: number,
): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined")
    throw new PptdzError("corrupt");
  const stream = bytesStream(bytes).pipeThrough(
    new DecompressionStream("gzip"),
  );
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new PptdzError("too-large");
      }
      chunks.push(value);
    }
  } catch (e) {
    if (e instanceof PptdzError) throw e;
    throw new PptdzError("corrupt", undefined, { cause: e });
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

export interface ExportResult {
  blob: Blob;
  /** asset ids referenced by the project but not found in the store */
  missingAssets: string[];
}

export async function exportPptdz(
  project: ProjectState,
  assets: AssetStore,
  opts: { onProgress?: (p: PptdzProgress) => void } = {},
): Promise<ExportResult> {
  const ids = assetIdsInProject(project);
  const entries: z.infer<typeof assetEntry>[] = [];
  const blobs: Blob[] = [];
  const missingAssets: string[] = [];
  let offset = 0;
  let i = 0;
  for (const id of ids) {
    const rec = await assets.get(id);
    opts.onProgress?.({ phase: "assets", done: i++, total: ids.length });
    if (!rec) {
      missingAssets.push(id);
      continue;
    }
    entries.push({
      id: rec.id,
      name: rec.name,
      type: rec.type,
      mime: rec.mime,
      size: rec.blob.size,
      offset,
      length: rec.blob.size,
    });
    blobs.push(rec.blob);
    offset += rec.blob.size;
  }
  if (entries.length > MAX_ASSETS) throw new PptdzError("too-large");

  const manifest: Manifest = {
    app: "teknodoz-studio",
    exportedAt: Date.now(),
    project,
    assets: entries,
  };
  let body: Uint8Array = new TextEncoder().encode(JSON.stringify(manifest));
  let flags = 0;
  const zipped = await gzip(body);
  if (zipped && zipped.byteLength < body.byteLength) {
    body = zipped;
    flags |= FLAG_GZIP;
  }
  if (body.byteLength > MAX_MANIFEST_BYTES) throw new PptdzError("too-large");

  const header = new Uint8Array(PPTDZ_HEADER_BYTES);
  header.set(PPTDZ_MAGIC, 0);
  header[6] = PPTDZ_FORMAT_VERSION;
  header[7] = flags;
  new DataView(header.buffer).setUint32(8, body.byteLength, true);

  opts.onProgress?.({ phase: "assets", done: ids.length, total: ids.length });
  return {
    blob: new Blob([header as BlobPart, body as BlobPart, ...blobs], {
      type: "application/x-pptdz",
    }),
    missingAssets,
  };
}

export interface ImportOptions {
  /** "replace" overwrites assets with the same id; "merge" always remaps ids (default). */
  mode?: "replace" | "merge";
  onProgress?: (p: PptdzProgress) => void;
  /** per-asset cap in bytes (default 2 GiB) */
  maxAssetBytes?: number;
}

export interface ImportResult {
  project: ProjectState;
  importedAssets: number;
  warnings: string[];
}

export async function importPptdz(
  file: Blob,
  assets: AssetStore,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  const mode = opts.mode ?? "merge";
  const maxAsset = opts.maxAssetBytes ?? 2 * 1024 ** 3;
  const warnings: string[] = [];

  opts.onProgress?.({ phase: "manifest", done: 0, total: 1 });
  const head = await blobToBytes(file.slice(0, PPTDZ_HEADER_BYTES));
  const h = verifyPptdzHeader(head);
  if (h.dataStart > file.size) throw new PptdzError("corrupt");

  let manifestBytes: Uint8Array = await blobToBytes(
    file.slice(PPTDZ_HEADER_BYTES, h.dataStart),
  );
  if (h.flags & FLAG_GZIP) {
    manifestBytes = await gunzipBounded(
      manifestBytes,
      MAX_MANIFEST_INFLATED_BYTES,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes),
    );
  } catch (e) {
    throw new PptdzError("corrupt", undefined, { cause: e });
  }
  const m = manifestSchema.safeParse(json);
  if (!m.success)
    throw new PptdzError("corrupt", undefined, { cause: m.error });
  const manifest = m.data;

  // Validate the asset table before touching storage.
  const dataLen = file.size - h.dataStart;
  const ranges: { start: number; end: number }[] = [];
  const seen = new Set<string>();
  for (const a of manifest.assets) {
    if (seen.has(a.id)) throw new PptdzError("corrupt");
    seen.add(a.id);
    if (a.length !== a.size) throw new PptdzError("corrupt");
    if (a.offset + a.length > dataLen) throw new PptdzError("corrupt");
    if (!a.mime.toLowerCase().startsWith(`${a.type}/`))
      throw new PptdzError("unsupported-asset");
    if (a.length > maxAsset) throw new PptdzError("too-large");
    ranges.push({ start: a.offset, end: a.offset + a.length });
  }
  ranges.sort((x, y) => x.start - y.start);
  for (let i = 1; i < ranges.length; i++) {
    const prev = ranges[i - 1] as { end: number };
    const cur = ranges[i] as { start: number };
    if (cur.start < prev.end) throw new PptdzError("corrupt");
  }

  const parsed = parseProject(manifest.project);
  if (!parsed.ok)
    throw new PptdzError("invalid-project", undefined, { cause: parsed.error });
  warnings.push(...parsed.warnings);

  // Store assets, remapping ids in merge mode.
  const idMap = new Map<string, string>();
  let done = 0;
  for (const a of manifest.assets) {
    opts.onProgress?.({ phase: "assets", done, total: manifest.assets.length });
    const newId = mode === "merge" ? uid("as") : a.id;
    const start = h.dataStart + a.offset;
    const slice = file.slice(start, start + a.length, a.mime);
    await assets.put(slice, { name: a.name, type: a.type as AssetType }, newId);
    idMap.set(a.id, newId);
    done++;
  }
  opts.onProgress?.({ phase: "assets", done, total: manifest.assets.length });

  const project: ProjectState = {
    ...parsed.project,
    sponsors: parsed.project.sponsors.map((sp) => {
      if (!sp.logoAssetId) return sp;
      const mapped = idMap.get(sp.logoAssetId);
      if (mapped) return { ...sp, logoAssetId: mapped };
      warnings.push(`"${sp.name}" sponsorunun logosu pakette yok`);
      return { ...sp, logoAssetId: "" };
    }),
    scenes: parsed.project.scenes.map((s) => ({
      ...s,
      layers: s.layers.map((l) => {
        if ((l.kind !== "image" && l.kind !== "video") || !l.assetId) return l;
        const mapped = idMap.get(l.assetId);
        if (mapped) return { ...l, assetId: mapped };
        warnings.push(`"${l.name}" katmanının dosyası pakette yok`);
        return { ...l, assetId: "" };
      }),
    })),
  };
  return { project, importedAssets: idMap.size, warnings };
}
