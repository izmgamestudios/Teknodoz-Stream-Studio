import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { FAQ, GUIDE } from "./content";
import { guideToMarkdown } from "./markdown";
import { resolveResources } from "./resources";
import { GUIDE_RESOURCES } from "./resources-config";
import { guideShortcuts, prettyCombo } from "./shortcuts";

const DOCS = resolve(dirname(fileURLToPath(import.meta.url)), "../../../docs");
const res = resolveResources(GUIDE_RESOURCES);

describe("guide content", () => {
  it("has unique ids and parallel Turkish / English text", () => {
    const ids = [...GUIDE.map((s) => s.id), ...FAQ.map((f) => f.id)];
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of GUIDE) {
      expect(s.tr.steps.length, s.id).toBe(s.en.steps.length);
      expect(s.tr.steps.length, s.id).toBeGreaterThan(0);
      expect((s.tr.tips ?? []).length, s.id).toBe((s.en.tips ?? []).length);
      for (const l of ["tr", "en"] as const) {
        expect(s[l].title.length).toBeGreaterThan(2);
        expect(s[l].summary.length).toBeGreaterThan(10);
      }
    }
    for (const f of FAQ)
      for (const l of ["tr", "en"] as const) {
        expect(f[l].q.length).toBeGreaterThan(5);
        expect(f[l].a.length).toBeGreaterThan(20);
      }
  });

  it("shows the real default shortcuts", () => {
    expect(prettyCombo("ArrowUp")).toBe("↑");
    expect(prettyCombo("Shift+R")).toBe("Shift+R");
    expect(prettyCombo("m")).toBe("M");
    const rows = guideShortcuts("en");
    expect(rows.find((r) => r.keys === "Shift+R")?.label).toMatch(/record/i);
    expect(rows.find((r) => r.keys === "Space")).toBeDefined();
    expect(rows.at(-1)?.keys).toBe("1–9");
    expect(guideShortcuts("tr").length).toBe(rows.length);
  });

  it("renders every section, anchor and FAQ entry", () => {
    for (const lang of ["tr", "en"] as const) {
      const md = guideToMarkdown(lang, res);
      for (const s of GUIDE) {
        expect(md).toContain(`<a name="${s.id}"></a>`);
        expect(md).toContain(`(#${s.id})`);
        expect(md).toContain(s[lang].title);
      }
      for (const f of FAQ) expect(md).toContain(`### ${f[lang].q}`);
      expect(md).toContain("| `Shift+R` |");
    }
  });
});

describe("GitHub docs are in sync with the guide", () => {
  const files = { tr: "USER-GUIDE.md", en: "USER-GUIDE.en.md" } as const;
  for (const lang of ["tr", "en"] as const) {
    it(`docs/${files[lang]}`, () => {
      const want = guideToMarkdown(lang, res);
      const path = resolve(DOCS, files[lang]);
      if (process.env["UPDATE_DOCS"] === "1") writeFileSync(path, want);
      expect(
        readFileSync(path, "utf8"),
        "run: UPDATE_DOCS=1 npx vitest run src/studio/guide",
      ).toBe(want);
    });
  }
});
