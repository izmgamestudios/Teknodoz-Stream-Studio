// src/studio/watch/media-url.test.ts
import { describe, expect, it } from "vitest";

import {
  embedUrl,
  fileSrc,
  isAudioSource,
  isMediaSource,
  parseMediaInput,
  type MediaSource,
} from "./media-url";

describe("parseMediaInput", () => {
  it("accepts the usual YouTube shapes", () => {
    const id = "dQw4w9WgXcQ";
    for (const u of [
      `https://www.youtube.com/watch?v=${id}&t=3`,
      `https://youtu.be/${id}?si=x`,
      `https://www.youtube.com/embed/${id}`,
      `https://youtube.com/shorts/${id}`,
      `https://www.youtube.com/live/${id}`,
      `https://www.youtube-nocookie.com/embed/${id}`,
    ])
      expect(parseMediaInput(u)).toEqual({ kind: "youtube", id });
  });

  it("accepts Vimeo, https video files and own room links", () => {
    expect(parseMediaInput("https://vimeo.com/76979871")).toEqual({
      kind: "vimeo",
      id: "76979871",
    });
    expect(parseMediaInput("https://cdn.example.org/a/b.mp4?x=1")).toEqual({
      kind: "file",
      url: "https://cdn.example.org/a/b.mp4?x=1",
    });
    expect(
      parseMediaInput(
        "https://studio.example.org/r/ab3cde",
        "studio.example.org",
      ),
    ).toEqual({ kind: "room", code: "AB3CDE" });
  });

  it("accepts a YouTube channel as its live stream", () => {
    const ch = "UCX6OQ3DkcsbYNE6H8uQQuVA";
    const want = { kind: "youtube-live", channel: ch };
    for (const u of [
      ch,
      `https://www.youtube.com/channel/${ch}`,
      `https://www.youtube.com/channel/${ch}/live`,
      `https://www.youtube.com/embed/live_stream?channel=${ch}`,
    ])
      expect(parseMediaInput(u)).toEqual(want);
    expect(parseMediaInput("https://www.youtube.com/@MrBeast/live")).toBeNull();
    expect(
      parseMediaInput(`https://www.youtube.com/channel/${ch}/videos`),
    ).toBeNull();
    expect(embedUrl({ kind: "youtube-live", channel: ch })).toContain(
      `live_stream?channel=${ch}`,
    );
  });

  it("rejects everything else", () => {
    for (const u of [
      "",
      "dQw4w9WgXcQ",
      "http://youtu.be/dQw4w9WgXcQ",
      "https://evil.example/watch?v=dQw4w9WgXcQ",
      "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
      "javascript:alert(1)",
      "https://user:pw@youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=short",
      "https://cdn.example.org/a.exe",
      "https://other.example/r/AB3CDE",
    ])
      expect(parseMediaInput(u, "studio.example.org")).toBeNull();
  });
});

describe("isMediaSource / embedUrl", () => {
  it("validates stored sources and builds embeds", () => {
    expect(isMediaSource({ kind: "youtube", id: "dQw4w9WgXcQ" })).toBe(true);
    expect(isMediaSource({ kind: "youtube", id: "x" })).toBe(false);
    expect(isMediaSource({ kind: "file", url: "http://a/b.mp4" })).toBe(false);
    expect(isMediaSource(null)).toBe(false);
    expect(embedUrl({ kind: "youtube", id: "dQw4w9WgXcQ" })).toContain(
      "youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
    expect(embedUrl({ kind: "room", code: "AB3CDE" })).toBeNull();
  });
});

describe("audio and library sources", () => {
  it("accepts https audio files", () => {
    for (const ext of ["mp3", "wav", "ogg", "m4a", "aac", "flac", "opus"])
      expect(parseMediaInput(`https://cdn.example.org/p/ep1.${ext}`)).toEqual({
        kind: "audio",
        url: `https://cdn.example.org/p/ep1.${ext}`,
      });
    expect(parseMediaInput("http://cdn.example.org/a.mp3")).toBeNull();
  });

  it("validates library uploads and tells audio from video", () => {
    const up = { kind: "upload", id: "0123456789abcdef", media: "audio" };
    expect(isMediaSource(up)).toBe(true);
    expect(isMediaSource({ ...up, id: "../../etc" })).toBe(false);
    expect(isMediaSource({ ...up, media: "text" })).toBe(false);
    expect(isAudioSource(up as MediaSource)).toBe(true);
    expect(isAudioSource({ kind: "audio", url: "https://a.test/a.mp3" })).toBe(
      true,
    );
    expect(isAudioSource({ kind: "youtube", id: "dQw4w9WgXcQ" })).toBe(false);
    expect(fileSrc(up as MediaSource)).toBe("/media/0123456789abcdef");
    expect(fileSrc({ kind: "youtube", id: "dQw4w9WgXcQ" })).toBeNull();
  });
});
