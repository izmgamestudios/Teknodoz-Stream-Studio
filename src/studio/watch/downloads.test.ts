import { describe, expect, it } from "vitest";

import {
  captionDownloadUrl,
  cleanOf,
  downloadName,
  fileDownloadUrl,
  lineage,
  rawOf,
  subtitledOf,
} from "./downloads";
import type { MediaRecord } from "./media-client";

const rec = (id: string, o: Partial<MediaRecord> = {}): MediaRecord => ({
  id,
  kind: "video",
  mime: "video/mp4",
  file: `${id}.mp4`,
  size: 1,
  title: id,
  filename: `${id}.mp4`,
  durationMs: 1000,
  width: 1,
  height: 1,
  chapters: [],
  captions: [],
  hasPoster: false,
  origin: "upload",
  parentId: null,
  createdAt: "2026-10-22T10:00:00.000Z",
  ...o,
});

const raw = rec("a");
const cut = rec("b", {
  origin: "edit",
  parentId: "a",
  createdAt: "2026-10-22T11:00:00.000Z",
});
const burned = rec("c", {
  origin: "edit",
  parentId: "b",
  burnedLang: "tr",
  createdAt: "2026-10-22T12:00:00.000Z",
});
const all = [raw, cut, burned];

describe("download flavours", () => {
  it("follows the parent chain to the raw recording", () => {
    expect(lineage(burned, all).map((r) => r.id)).toEqual(["c", "b", "a"]);
    expect(rawOf(burned, all).id).toBe("a");
    expect(rawOf(raw, all).id).toBe("a");
  });
  it("the clean version of a burned copy is its un-burned parent", () => {
    expect(cleanOf(burned, all).id).toBe("b");
    expect(cleanOf(cut, all).id).toBe("b");
  });
  it("finds the subtitled copy of an item, or null", () => {
    expect(subtitledOf(cut, all, "tr")?.id).toBe("c");
    expect(subtitledOf(burned, all, "tr")?.id).toBe("c");
    expect(subtitledOf(cut, all, "en")).toBeNull();
    expect(subtitledOf(raw, all, "tr")).toBeNull();
  });
  it("survives a broken or cyclic chain", () => {
    const x = rec("x", { parentId: "y" });
    const y = rec("y", { parentId: "x" });
    expect(lineage(x, [x, y])).toHaveLength(2);
    expect(rawOf(rec("z", { parentId: "missing" }), [])).toMatchObject({
      id: "z",
    });
  });
  it("builds readable names and download urls", () => {
    expect(downloadName("Çağrı (düzenlendi)", "clean")).toBe(
      "Çağrı-altyazisiz",
    );
    expect(downloadName("Röportaj", "subtitled", "tr")).toBe(
      "Röportaj-altyazili-tr",
    );
    expect(downloadName("  ")).toBe("kayit");
    expect(fileDownloadUrl("abc", "Çağrı Merkezi-ham")).toBe(
      "/media/abc?dl=%C3%87a%C4%9Fr%C4%B1%20Merkezi-ham",
    );
    expect(captionDownloadUrl("abc", "tr", "srt", "x")).toBe(
      "/media/abc/captions/tr.srt?dl=x",
    );
  });
});
