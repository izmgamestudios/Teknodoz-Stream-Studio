import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Marker } from "../types";
import {
  DownloadError,
  buildBundleFiles,
  downloadBlob,
  downloadRecordingBundle,
  safeFilename,
  timestampName,
} from "./download";
import type { RecordingResult } from "./recorder";

function readText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (): void => resolve(String(reader.result));
    reader.onerror = (): void => reject(reader.error);
    reader.readAsText(blob);
  });
}

function makeResult(over: Partial<RecordingResult> = {}): RecordingResult {
  const markers: Marker[] = [
    { t: 0, label: "Giriş" },
    { t: 20_000, label: "Demo" },
    { t: 40_000, label: "Son" },
  ];
  return {
    blob: new Blob([new Uint8Array(10)], { type: "video/webm" }),
    mimeType: "video/webm",
    ext: "webm",
    durationMs: 60_000,
    markers,
    startedAt: 1_700_000_000_000,
    ...over,
  };
}

describe("safeFilename", () => {
  it("replaces reserved characters and path separators", () => {
    expect(safeFilename("Sunum: Ürün/Tanıtım")).toBe("Sunum- Ürün-Tanıtım");
    expect(safeFilename("C:\\Windows\\System32")).toBe("C-Windows-System32");
    expect(safeFilename('a<b>c"d|e?f*g')).toBe("a-b-c-d-e-f-g");
  });

  it("defuses path traversal", () => {
    const out = safeFilename("../../etc/passwd");
    expect(out).toBe("etc-passwd");
    expect(out).not.toMatch(/[/\\]/);
  });

  it("strips leading dots / hyphens and trailing dots / spaces", () => {
    expect(safeFilename("  .hidden  ")).toBe("hidden");
    expect(safeFilename("name. . .")).toBe("name");
    expect(safeFilename("--flag")).toBe("flag");
  });

  it("prefixes Windows reserved device names", () => {
    expect(safeFilename("CON")).toBe("_CON");
    expect(safeFilename("con.txt")).toBe("_con.txt");
    expect(safeFilename("COM1")).toBe("_COM1");
    expect(safeFilename("lpt9.log")).toBe("_lpt9.log");
    expect(safeFilename("nul ")).toBe("_nul");
    expect(safeFilename("console")).toBe("console");
    expect(safeFilename("com10")).toBe("com10");
  });

  it("falls back for empty or unusable input", () => {
    expect(safeFilename("")).toBe("kayit");
    expect(safeFilename("   ")).toBe("kayit");
    expect(safeFilename("***")).toBe("kayit");
    expect(safeFilename(undefined as unknown as string)).toBe("kayit");
    expect(safeFilename("???", "yedek")).toBe("yedek");
    expect(safeFilename("", "")).toBe("kayit");
    expect(safeFilename("", "CON")).toBe("_CON");
  });

  it("removes control and bidi-override characters and collapses whitespace", () => {
    const rlo = String.fromCharCode(0x202e);
    const zwsp = String.fromCharCode(0x200b);
    expect(safeFilename(`evil${rlo}gpj.exe`)).toBe("evilgpj.exe");
    expect(safeFilename(`a${String.fromCharCode(1)}b${zwsp}c`)).toBe("abc");
    expect(safeFilename("a\n\tb   c")).toBe("a b c");
  });

  it("normalises to NFC and keeps Turkish letters", () => {
    const decomposed = String.fromCharCode(0x65, 0x301);
    expect(safeFilename(decomposed)).toBe(String.fromCharCode(0xe9));
    expect(safeFilename("Çalışma Öğüt İğne ğüşiöç")).toBe(
      "Çalışma Öğüt İğne ğüşiöç",
    );
  });

  it("bounds the length and keeps a short extension", () => {
    const out = safeFilename(`${"a".repeat(300)}.mp4`);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.endsWith(".mp4")).toBe(true);
    expect(safeFilename("b".repeat(300))).toHaveLength(120);
  });

  it("never splits a surrogate pair when truncating", () => {
    const out = safeFilename("a" + "😀".repeat(100));
    // every code unit must belong to a complete pair or be ASCII
    expect(Array.from(out).every((c) => c === "a" || c === "😀")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(120);
  });

  it("is idempotent", () => {
    const once = safeFilename("Sunum: Ürün/Tanıtım?.mp4");
    expect(safeFilename(once)).toBe(once);
  });
});

describe("timestampName", () => {
  it("formats local time as YYYYMMDD-HHmmss", () => {
    expect(timestampName("teknodoz", new Date(2026, 9, 10, 21, 5, 9))).toBe(
      "teknodoz-20261010-210509",
    );
    expect(timestampName("x", new Date(2026, 0, 2, 3, 4, 5))).toBe(
      "x-20260102-030405",
    );
  });

  it("sanitises the prefix and has a default", () => {
    expect(timestampName("my:rec", new Date(2026, 0, 1, 0, 0, 0))).toBe(
      "my-rec-20260101-000000",
    );
    expect(timestampName("", new Date(2026, 0, 1, 0, 0, 0))).toBe(
      "teknodoz-20260101-000000",
    );
    expect(timestampName()).toMatch(/^teknodoz-\d{8}-\d{6}$/);
  });

  it("survives an invalid date", () => {
    expect(timestampName("p", new Date(Number.NaN))).toMatch(/^p-\d{8}-\d{6}$/);
  });
});

describe("downloadBlob", () => {
  type Click = { href: string; download: string; connected: boolean };
  let clicks: Click[];
  let urlCounter: number;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;

  beforeEach(() => {
    clicks = [];
    urlCounter = 0;
    URL.createObjectURL = vi.fn(() => `blob:fake-${++urlCounter}`);
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push({
        href: this.href,
        download: this.download,
        connected: this.isConnected,
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  it("clicks a hidden anchor with the sanitised name and removes it afterwards", () => {
    downloadBlob(new Blob(["x"]), "a/b?.mp4");
    expect(clicks).toEqual([
      { href: "blob:fake-1", download: "a-b-.mp4", connected: true },
    ]);
    expect(document.querySelectorAll("a[download]")).toHaveLength(0);
  });

  it("revokes the object URL only after the delay", () => {
    vi.useFakeTimers();
    downloadBlob(new Blob(["x"]), "a.txt", { revokeDelayMs: 5000 });
    vi.advanceTimersByTime(4999);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake-1");
  });

  it("uses a generous default revoke delay", () => {
    vi.useFakeTimers();
    downloadBlob(new Blob(["x"]), "a.txt");
    vi.advanceTimersByTime(29_000);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("rejects values that are not blobs", () => {
    expect(() => downloadBlob("nope" as unknown as Blob, "a.txt")).toThrowError(
      expect.objectContaining({ code: "invalid-blob" }),
    );
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("throws a typed error without a DOM (SSR) instead of crashing", () => {
    vi.stubGlobal("document", undefined);
    let caught: unknown;
    try {
      downloadBlob(new Blob(["x"]), "a.txt");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(DownloadError);
    expect((caught as DownloadError).code).toBe("unsupported");
  });

  it("throws unsupported when createObjectURL is missing", () => {
    (URL as { createObjectURL?: unknown }).createObjectURL = undefined;
    expect(() => downloadBlob(new Blob(["x"]), "a.txt")).toThrowError(
      expect.objectContaining({ code: "unsupported" }),
    );
  });

  it("wraps click failures, revokes the URL and cleans up", () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => downloadBlob(new Blob(["x"]), "a.txt")).toThrowError(
      expect.objectContaining({ code: "failed" }),
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake-1");
    expect(document.querySelectorAll("a")).toHaveLength(0);
  });

  describe("downloadRecordingBundle", () => {
    it("staggers the downloads and reports the names", async () => {
      vi.useFakeTimers();
      const at: number[] = [];
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
        function (this: HTMLAnchorElement) {
          clicks.push({
            href: this.href,
            download: this.download,
            connected: true,
          });
          at.push(Date.now());
        },
      );
      const t0 = Date.now();
      const p = downloadRecordingBundle(makeResult(), "rec");
      await vi.advanceTimersByTimeAsync(2000);
      const names = await p;
      expect(names).toEqual(["rec.webm", "rec-chapters.txt", "rec.srt"]);
      expect(clicks.map((c) => c.download)).toEqual(names);
      expect(at.map((t) => t - t0)).toEqual([0, 250, 500]);
    });

    it("supports a custom stagger", async () => {
      vi.useFakeTimers();
      const at: number[] = [];
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
        at.push(Date.now());
      });
      const t0 = Date.now();
      const p = downloadRecordingBundle(makeResult(), "rec", {
        staggerMs: 1000,
      });
      await vi.advanceTimersByTimeAsync(5000);
      await p;
      expect(at.map((t) => t - t0)).toEqual([0, 1000, 2000]);
    });

    it("downloads only the video when there are no markers", async () => {
      const names = await downloadRecordingBundle(
        makeResult({ markers: [] }),
        "solo",
      );
      expect(names).toEqual(["solo.webm"]);
    });

    it("uses a timestamp name when no base name is given", async () => {
      const names = await downloadRecordingBundle(makeResult({ markers: [] }));
      expect(names[0]).toMatch(/^teknodoz-\d{8}-\d{6}\.webm$/);
    });

    it("propagates DownloadError (e.g. SSR)", async () => {
      vi.stubGlobal("document", undefined);
      await expect(
        downloadRecordingBundle(makeResult()),
      ).rejects.toBeInstanceOf(DownloadError);
    });
  });
});

describe("buildBundleFiles", () => {
  it("returns video, chapters.txt and .srt sharing one base name", async () => {
    const result = makeResult();
    const files = buildBundleFiles(result, "oturum");
    expect(files.map((f) => f.name)).toEqual([
      "oturum.webm",
      "oturum-chapters.txt",
      "oturum.srt",
    ]);
    expect(files[0]?.blob).toBe(result.blob);
    expect(files[1]?.blob.type).toBe("text/plain;charset=utf-8");
    expect(files[2]?.blob.type).toBe("application/x-subrip;charset=utf-8");
    expect(await readText(files[1]!.blob)).toBe(
      "0:00 Giriş\n0:20 Demo\n0:40 Son\n",
    );
    const srt = await readText(files[2]!.blob);
    expect(
      srt.startsWith(
        "1\r\n00:00:00,000 --> 00:00:20,000\r\nGiriş\r\n\r\n2\r\n",
      ),
    ).toBe(true);
    expect(srt.endsWith("3\r\n00:00:40,000 --> 00:01:00,000\r\nSon\r\n")).toBe(
      true,
    );
  });

  it("uses the container extension of the recording", () => {
    const files = buildBundleFiles(makeResult({ ext: "mp4" }), "x");
    expect(files[0]?.name).toBe("x.mp4");
  });

  it("sanitises the base name", () => {
    const files = buildBundleFiles(makeResult(), "Sunum: 1/2");
    expect(files.map((f) => f.name)).toEqual([
      "Sunum- 1-2.webm",
      "Sunum- 1-2-chapters.txt",
      "Sunum- 1-2.srt",
    ]);
  });

  it("defaults to a timestamped base name", () => {
    const files = buildBundleFiles(makeResult());
    expect(files[0]?.name).toMatch(/^teknodoz-\d{8}-\d{6}\.webm$/);
  });

  it("skips chapter files without markers unless asked", async () => {
    const empty = makeResult({ markers: [] });
    expect(buildBundleFiles(empty, "a")).toHaveLength(1);
    const forced = buildBundleFiles(empty, "a", { includeEmptyChapters: true });
    expect(forced.map((f) => f.name)).toEqual([
      "a.webm",
      "a-chapters.txt",
      "a.srt",
    ]);
    expect(await readText(forced[1]!.blob)).toBe("0:00 Başlangıç\n");
  });

  it("omits an empty .srt (zero-length recording)", () => {
    const files = buildBundleFiles(makeResult({ durationMs: 0 }), "z");
    expect(files.map((f) => f.name)).toEqual(["z.webm", "z-chapters.txt"]);
  });

  it("forwards chapter options", async () => {
    const files = buildBundleFiles(
      makeResult({
        markers: [{ t: 30_000, label: "Demo" }],
        durationMs: 90_000,
      }),
      "o",
      { introLabel: "Intro" },
    );
    expect(await readText(files[1]!.blob)).toBe("0:00 Intro\n0:30 Demo\n");
  });
});
