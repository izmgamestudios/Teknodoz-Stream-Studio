import { describe, expect, it } from "vitest";

import {
  PLATFORM_IDS,
  detectBrowser,
  detectPlatform,
  installSteps,
} from "./platform";

const UA = {
  win: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  ipad: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iosChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1",
  android:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  samsung:
    "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  linux:
    "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0",
  cros: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
} as const;

describe("detectPlatform", () => {
  it.each([
    ["win", 0, "windows"],
    ["edge", 0, "windows"],
    ["mac", 0, "macos"],
    ["ipad", 5, "ios"], // iPadOS pretends to be a Mac
    ["iphone", 5, "ios"],
    ["iosChrome", 5, "ios"],
    ["android", 5, "android"],
    ["samsung", 5, "android"], // "Linux; Android" must not be Linux
    ["linux", 0, "linux"],
    ["cros", 0, "other"],
  ] as const)("%s -> %s", (key, touch, want) => {
    expect(detectPlatform(UA[key], touch)).toBe(want);
  });

  it("unknown agents are 'other'", () => {
    expect(detectPlatform("")).toBe("other");
    expect(detectPlatform("curl/8.0")).toBe("other");
  });
});

describe("detectBrowser", () => {
  it.each([
    ["win", "chrome"],
    ["edge", "edge"],
    ["mac", "safari"],
    ["iphone", "safari"],
    ["iosChrome", "chrome"],
    ["android", "chrome"],
    ["samsung", "samsung"],
    ["linux", "firefox"],
  ] as const)("%s -> %s", (key, want) => {
    expect(detectBrowser(UA[key])).toBe(want);
  });
});

describe("installSteps", () => {
  it("has bilingual, non-empty steps for every platform and browser", () => {
    for (const p of [...PLATFORM_IDS, "other"] as const)
      for (const b of [
        "edge",
        "chrome",
        "firefox",
        "safari",
        "samsung",
        "other",
      ] as const) {
        const s = installSteps(p, b);
        expect(s.tr.length).toBeGreaterThan(0);
        expect(s.tr.length).toBe(s.en.length);
      }
  });

  it("is specific where it matters", () => {
    expect(installSteps("ios", "safari").en.join(" ")).toContain(
      "Add to Home Screen",
    );
    expect(installSteps("macos", "safari").en.join(" ")).toContain(
      "Add to Dock",
    );
    expect(installSteps("windows", "firefox").en.join(" ")).toContain(
      "cannot install",
    );
    expect(installSteps("android", "firefox").en.join(" ")).toContain(
      "Install",
    );
    expect(installSteps("windows", "chrome").en.join(" ")).toContain("Install");
  });
});
