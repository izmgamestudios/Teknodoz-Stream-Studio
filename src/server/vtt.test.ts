// src/server/vtt.test.ts
import { describe, expect, it } from "vitest";

import { cueCount, normalizeVtt, shiftVtt } from "./vtt";

describe("normalizeVtt", () => {
  it("passes valid WebVTT through (cleaned)", () => {
    const out = normalizeVtt(
      "﻿WEBVTT\r\n\r\n00:00:01.000 --> 00:00:02.500\r\nMerhaba\r\n",
    );
    expect(out).toBe("WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nMerhaba\n");
  });

  it("converts SRT (commas, ids, short hours)", () => {
    const srt =
      "1\n00:00:01,000 --> 00:00:02,000\nİlk satır\n\n2\n00:01,500 --> 00:03,000\nİkinci\n";
    const out = normalizeVtt(srt)!;
    expect(out).toContain("00:00:01.000 --> 00:00:02.000\nİlk satır");
    expect(out).toContain("00:00:01.500 --> 00:00:03.000\nİkinci");
    expect(out).not.toMatch(/^\d+$/m);
    expect(cueCount(out)).toBe(2);
  });

  it("rejects non-subtitles, empty and oversized input", () => {
    expect(normalizeVtt("just some text")).toBeNull();
    expect(normalizeVtt("   ")).toBeNull();
    expect(normalizeVtt("WEBVTT\n\nno cues here")).toBeNull();
    expect(normalizeVtt("x".repeat(3 * 1024 * 1024))).toBeNull();
  });

  it("neutralises '-->' and <script in cue text", () => {
    const out = normalizeVtt(
      "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\na --> b <script>x</script>\n",
    )!;
    expect(out).not.toMatch(/a --> b/);
    expect(out.toLowerCase()).not.toContain("<script");
    expect(cueCount(out)).toBe(1);
  });
});

describe("shiftVtt", () => {
  const v =
    "WEBVTT\n\n00:00:10.000 --> 00:00:12.000\nBir\n\n00:00:01.000 --> 00:00:02.000\nİki\n";
  it("shifts cues and drops those that end before zero", () => {
    const out = shiftVtt(v, -5000);
    expect(out).toContain("00:00:05.000 --> 00:00:07.000\nBir");
    expect(out).not.toContain("İki");
    expect(shiftVtt(v, 3000)).toContain("00:00:13.000 --> 00:00:15.000");
  });
});

import { vttToSrt } from "./vtt";
import { downloadDisposition } from "./media";

describe("vttToSrt", () => {
  it("numbers cues, uses commas, drops settings, notes and voice tags", () => {
    const vtt = [
      "WEBVTT",
      "",
      "NOTE bu bir not",
      "",
      "intro",
      "00:00:01.000 --> 00:00:02.500 align:start position:0%",
      "<v Ayşe>Merhaba <i>dünya</i></v>",
      "",
      "1:05.250 --> 1:07.000",
      "<c.yellow>İkinci</c>",
      "satır",
      "",
      "00:02:00.000 --> 00:02:01.000",
      "",
    ].join("\n");
    expect(vttToSrt(vtt)).toBe(
      "1\n00:00:01,000 --> 00:00:02,500\nMerhaba <i>dünya</i>\n\n2\n00:01:05,250 --> 00:01:07,000\nİkinci\nsatır\n",
    );
  });
  it("returns an empty string when there are no cues", () => {
    expect(vttToSrt("WEBVTT\n\nNOTE x\n")).toBe("");
  });
});

describe("downloadDisposition", () => {
  it("keeps Turkish names via filename*, ASCII fallback, always the extension", () => {
    const d = downloadDisposition("Çağrı Merkezi", "mp4");
    expect(d).toContain(
      'filename="_a_r_ Merkezi.mp4"'.replace("_a_r_", "_a_r_"),
    );
    expect(d).toContain("filename*=UTF-8''%C3%87a%C4%9Fr%C4%B1%20Merkezi.mp4");
  });
  it("strips path separators, quotes and control characters", () => {
    const d = downloadDisposition('../../etc/pa"ss\r\nwd', "wav");
    expect(d).not.toMatch(/[\r\n/\\]/);
    expect(d).toContain(".wav");
    expect(downloadDisposition("   ", "srt")).toContain("download.srt");
    expect(downloadDisposition("a.srt", "srt")).toContain('filename="a.srt"');
  });
});
