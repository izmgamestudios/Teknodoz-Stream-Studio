import { describe, expect, it } from "vitest";

import { GUIDE_RESOURCES } from "./resources-config";
import {
  driveRef,
  parseStart,
  resolvePdf,
  resolveResources,
  resolveVideo,
  youtubeRef,
} from "./resources";

const pdf = (url: string, site = "") =>
  resolvePdf({ title: "Kılavuz", url }, site);
const video = (url: string) => resolveVideo({ title: "Video", url });
const FILE = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";

describe("Drive / Docs PDFs", () => {
  it("rebuilds share links into canonical view and preview URLs", () => {
    for (const url of [
      `https://drive.google.com/file/d/${FILE}/view?usp=sharing`,
      `https://drive.google.com/open?id=${FILE}`,
      `https://drive.google.com/uc?export=download&id=${FILE}`,
    ]) {
      const r = pdf(url);
      expect(r.ok && r.value.openUrl).toBe(
        `https://drive.google.com/file/d/${FILE}/view`,
      );
      expect(r.ok && r.value.embedUrl).toBe(
        `https://drive.google.com/file/d/${FILE}/preview`,
      );
    }
    const doc = pdf(`https://docs.google.com/document/d/${FILE}/edit?tab=t.0`);
    expect(doc.ok && doc.value.embedUrl).toBe(
      `https://docs.google.com/document/d/${FILE}/preview`,
    );
  });

  it("opens plain .pdf links only on GitHub or the site itself, without embedding", () => {
    const gh = pdf(
      "https://github.com/izmgamestudios/x/raw/main/docs/guide.pdf",
    );
    expect(gh.ok && gh.value.embedUrl).toBeNull();
    expect(
      pdf("https://studio.acme.example/guide.pdf", "studio.acme.example").ok,
    ).toBe(true);
    expect(pdf("https://studio.acme.example/guide.pdf").ok).toBe(false);
    expect(pdf("https://evil.example/guide.pdf")).toEqual({
      ok: false,
      problem: "host",
    });
    expect(pdf("https://github.com/x/y/blob/main/readme.md")).toEqual({
      ok: false,
      problem: "host",
    });
  });

  it("rejects unsafe or malformed input", () => {
    expect(pdf("http://drive.google.com/file/d/" + FILE)).toEqual({
      ok: false,
      problem: "not-https",
    });
    expect(pdf("javascript:alert(1)")).toEqual({
      ok: false,
      problem: "not-https",
    });
    expect(pdf("nope")).toEqual({ ok: false, problem: "invalid" });
    expect(pdf(`https://u:p@drive.google.com/file/d/${FILE}`)).toEqual({
      ok: false,
      problem: "credentials",
    });
    expect(pdf("https://drive.google.com/drive/folders/abc")).toEqual({
      ok: false,
      problem: "id",
    });
    expect(pdf("https://drive.google.com.evil.example/file/d/" + FILE)).toEqual(
      { ok: false, problem: "host" },
    );
    expect(pdf("https://drive.google.com/file/d/short")).toEqual({
      ok: false,
      problem: "id",
    });
    expect(
      resolvePdf({
        title: "  ",
        url: `https://drive.google.com/file/d/${FILE}`,
      }),
    ).toEqual({ ok: false, problem: "title" });
    expect(driveRef(new URL("https://example.com/file/d/" + FILE))).toBeNull();
  });
});

describe("YouTube videos", () => {
  const ID = "dQw4w9WgXcQ";
  it.each([
    `https://www.youtube.com/watch?v=${ID}&feature=share`,
    `https://youtu.be/${ID}?si=abc`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/live/${ID}`,
  ])("extracts the id from %s", (url) => {
    const r = video(url);
    expect(r.ok && r.value.videoId).toBe(ID);
    expect(r.ok && r.value.embedUrl).toBe(
      `https://www.youtube-nocookie.com/embed/${ID}?rel=0&modestbranding=1`,
    );
    expect(r.ok && r.value.watchUrl).toBe(
      `https://www.youtube.com/watch?v=${ID}`,
    );
  });

  it("keeps a start time", () => {
    const r = video(`https://youtu.be/${ID}?t=1m30s`);
    expect(r.ok && r.value.embedUrl).toContain("&start=90");
    expect(r.ok && r.value.watchUrl).toContain("&t=90s");
    expect(parseStart("90")).toBe(90);
    expect(parseStart("1h2m3s")).toBe(3723);
    expect(parseStart("abc")).toBe(0);
    expect(parseStart("")).toBe(0);
    expect(parseStart(null)).toBe(0);
    expect(
      youtubeRef(new URL(`https://youtu.be/${ID}?t=999999999`))?.start,
    ).toBe(86_400);
  });

  it("rejects other hosts, bad ids and odd schemes", () => {
    expect(video(`https://vimeo.com/${ID}`)).toEqual({
      ok: false,
      problem: "host",
    });
    expect(video(`https://www.youtube.com.evil.example/watch?v=${ID}`)).toEqual(
      { ok: false, problem: "host" },
    );
    expect(video("https://www.youtube.com/watch?v=short")).toEqual({
      ok: false,
      problem: "id",
    });
    expect(video("https://www.youtube.com/@teknodoz")).toEqual({
      ok: false,
      problem: "id",
    });
    expect(video(`http://youtu.be/${ID}`)).toEqual({
      ok: false,
      problem: "not-https",
    });
    expect(video(`https://youtu.be/${ID}"onload="x`).ok).toBe(false);
  });

  it("trims the duration label", () => {
    const r = resolveVideo({
      title: "V",
      url: `https://youtu.be/${ID}`,
      duration: "  4:30  ",
    });
    expect(r.ok && r.value.duration).toBe("4:30");
  });
});

describe("resolveResources", () => {
  it("collects valid entries and reports the rest by position", () => {
    const r = resolveResources({
      pdf: [
        { title: "ok", url: `https://drive.google.com/file/d/${FILE}/view` },
        { title: "bad", url: "http://x" },
      ],
      videos: [{ title: "v", url: "https://vimeo.com/1" }],
      links: [
        { title: "l", url: "https://example.org/a", note: " n " },
        { title: "", url: "https://example.org" },
      ],
    });
    expect(r.pdf).toHaveLength(1);
    expect(r.videos).toHaveLength(0);
    expect(r.links).toEqual([
      { title: "l", url: "https://example.org/a", note: "n" },
    ]);
    expect(r.issues).toEqual([
      { kind: "pdf", index: 1, problem: "not-https" },
      { kind: "video", index: 0, problem: "host" },
      { kind: "link", index: 1, problem: "title" },
    ]);
  });

  it("the shipped config is valid", () => {
    const r = resolveResources(GUIDE_RESOURCES);
    expect(r.issues).toEqual([]);
    expect(r.links.length).toBeGreaterThan(0);
  });
});
