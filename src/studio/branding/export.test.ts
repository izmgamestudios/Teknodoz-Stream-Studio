import { describe, expect, it } from "vitest";

import { BRAND_KEYS, DEFAULT_BRAND, resolveBrand, type Brand } from "./brand";
import {
  diffBrand,
  exportBrand,
  importBrand,
  parseEnvText,
  patchFromDefaults,
  toConfigTs,
  toEnv,
  toJson,
} from "./export";
import { BRAND_GROUPS, BRAND_LABELS, FIELD_KIND } from "./labels";

const sample: Partial<Brand> = {
  name: "Acme Studio",
  slogan: "Yayını sahnede kur",
  badge: "",
  accent: "#ff8800",
  radius: 0.25,
  uiScale: 1.1,
  siteUrl: "https://acme.example",
  description: 'It\'s $HOME `quoted` "double" \\ slash',
};

describe("export formats", () => {
  it("lists only what differs from the defaults, in field order", () => {
    const next = resolveBrand({ name: "X", accent: "#ff8800" });
    expect(patchFromDefaults(next)).toEqual({ name: "X", accent: "#ff8800" });
    expect(Object.keys(patchFromDefaults(next))).toEqual(["name", "accent"]);
    expect(diffBrand(next, next)).toEqual({});
  });

  it("writes JSON, env lines and a config.ts", () => {
    expect(JSON.parse(toJson(sample))).toEqual(sample);
    expect(toJson({ name: "A" }, false)).toBe('{"name":"A"}');
    const env = toEnv({ name: "Acme", radius: 0.5, description: "it's" });
    expect(env).toBe(
      [
        "BRAND_NAME='Acme'",
        "BRAND_RADIUS=0.5",
        'BRAND_DESCRIPTION="it\'s"',
      ].join("\n"),
    );
    const ts = toConfigTs({ name: "Acme", radius: 0.5 });
    expect(ts).toContain('import type { Brand } from "./brand";');
    expect(ts).toContain('  name: "Acme",');
    expect(ts).toContain("  radius: 0.5,");
    expect(toConfigTs({})).toContain("BRAND_CONFIG: Partial<Brand> = {};");
    expect(exportBrand({ name: "A" }, "json")).toContain('"name": "A"');
    expect(exportBrand({ name: "A" }, "env")).toBe("BRAND_NAME='A'");
    expect(exportBrand({ name: "A" }, "config")).toContain("BRAND_CONFIG");
  });
});

describe("import", () => {
  it("round-trips every format, including awkward characters", () => {
    for (const format of ["json", "env"] as const) {
      const r = importBrand(exportBrand(sample, format));
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.rejected).toEqual([]);
      expect(r.patch).toEqual(sample);
    }
  });

  it("reads env text with comments, export and a BRAND_JSON line", () => {
    expect(
      parseEnvText(
        "# comment\n\nexport BRAND_NAME=Plain\r\nOTHER=1\nBRAND_BADGE=''",
      ),
    ).toEqual({ BRAND_NAME: "Plain", OTHER: "1", BRAND_BADGE: "" });
    const r = importBrand('BRAND_JSON=\'{"name":"From JSON"}\'');
    expect(r.ok && r.patch).toEqual({ name: "From JSON" });
  });

  it("reports rejected keys and refuses unrelated text", () => {
    const r = importBrand('{"name":"A","accent":"nope","evil":1}');
    expect(r.ok && r.patch).toEqual({ name: "A" });
    expect(r.ok && r.rejected).toEqual(["accent"]);
    expect(importBrand("").ok).toBe(false);
    expect(importBrand("{broken").ok).toBe(false);
    expect(importBrand("hello world").ok).toBe(false);
    expect(importBrand("PATH=/usr/bin").ok).toBe(false);
  });
});

describe("editor metadata", () => {
  it("labels, groups and kinds cover every brand field exactly once", () => {
    expect(Object.keys(BRAND_LABELS).sort()).toEqual([...BRAND_KEYS].sort());
    expect(Object.keys(FIELD_KIND).sort()).toEqual([...BRAND_KEYS].sort());
    const grouped = BRAND_GROUPS.flatMap((g) => [...g.keys]);
    expect(grouped.sort()).toEqual([...BRAND_KEYS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
    for (const k of BRAND_KEYS) {
      expect(BRAND_LABELS[k].tr.length).toBeGreaterThan(0);
      expect(BRAND_LABELS[k].en.length).toBeGreaterThan(0);
    }
    expect(DEFAULT_BRAND.name).toBeTruthy();
  });
});
