import { describe, expect, it } from "vitest";

import { DOWNLOADS_CONFIG } from "./downloads-config";
import { resolveDownloads, type DownloadsConfig } from "./downloads";

const one = (url: string, extra: Partial<DownloadsConfig> = {}, site = "") =>
  resolveDownloads({ links: { windows: { url } }, ...extra }, site).find(
    (s) => s.target === "windows",
  );

describe("download links", () => {
  it("covers all five targets, nothing configured by default", () => {
    const st = resolveDownloads(DOWNLOADS_CONFIG);
    expect(st.map((s) => s.target)).toEqual([
      "windows",
      "macos",
      "linux",
      "android",
      "ios",
    ]);
    expect(st.every((s) => s.link === null && s.problem === null)).toBe(true);
  });

  it("accepts release files and store listings, with kind and format", () => {
    const file = one(
      "https://github.com/izmgamestudios/Teknodoz-Stream-Studio/releases/latest/download/Setup.msi",
    );
    expect(file?.link).toMatchObject({ kind: "file", format: "MSI" });
    const cdn = one("https://objects.githubusercontent.com/x/Studio.AppImage");
    expect(cdn?.link).toMatchObject({ kind: "file", format: "AppImage" });
    const store = one("https://play.google.com/store/apps/details?id=org.x");
    expect(store?.link).toMatchObject({ kind: "store", format: null });
  });

  it("allows the site's own host and configured extra hosts only", () => {
    expect(one("https://dl.acme.example/a.exe")?.problem).toBe("host");
    expect(
      one("https://dl.acme.example/a.exe", { extraHosts: ["dl.acme.example"] })
        ?.link?.format,
    ).toBe("EXE");
    expect(
      one(
        "https://studio.acme.example/a.dmg",
        {},
        "https://studio.acme.example",
      )?.link?.format,
    ).toBe("DMG");
    expect(
      one("https://x.acme.example/a.dmg", { extraHosts: ["*.acme.example"] })
        ?.problem,
    ).toBeNull();
    expect(
      one("https://acme.example/a.dmg", { extraHosts: ["*.acme.example"] })
        ?.problem,
    ).toBe("host");
  });

  it("rejects unsafe or malformed links", () => {
    expect(one("http://github.com/a.msi")?.problem).toBe("not-https");
    expect(one("javascript:alert(1)")?.problem).toBe("not-https");
    expect(one("not a url")?.problem).toBe("invalid");
    expect(one("https://u:p@github.com/a.msi")?.problem).toBe("credentials");
    expect(one("https://github.com.evil.example/a.msi")?.problem).toBe("host");
    expect(one("https://evilgithub.com/a.msi")?.problem).toBe("host");
    expect(one(`https://github.com/${"a".repeat(600)}`)?.problem).toBe(
      "too-long",
    );
    expect(one("https://github.com/a.msi")?.link?.url).toBe(
      "https://github.com/a.msi",
    );
  });

  it("validates the checksum and keeps label and version", () => {
    const ok = resolveDownloads({
      links: {
        macos: {
          url: "https://github.com/a/b/releases/download/v1/S.dmg",
          sha256: "A".repeat(64),
          version: "1.0.0",
          label: "İndir",
        },
        linux: { url: "https://github.com/a/b/S.AppImage", sha256: "xyz" },
      },
    });
    expect(ok.find((s) => s.target === "macos")?.link).toMatchObject({
      version: "1.0.0",
      label: "İndir",
    });
    expect(ok.find((s) => s.target === "linux")?.problem).toBe("sha256");
  });

  it("treats an empty url as not configured", () => {
    expect(one("   ")?.problem).toBeNull();
    expect(one("   ")?.link).toBeNull();
  });
});
