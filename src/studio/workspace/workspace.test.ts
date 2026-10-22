// src/studio/workspace/workspace.test.ts
import { describe, expect, it } from "vitest";

import { addTemplate, TPL_KEY } from "../../classic/studio/saved-templates";
import { emptyScene } from "../../classic/studio/types";
import { SCHEMA_VERSION } from "../../shared/schema-registry";
import { defaultProject } from "../defaults";
import { SCRIPT_KEY } from "../sync/shared";
import { MY_TEMPLATES_KEY, makeMyTemplate } from "../templates/mine";
import {
  applyWorkspace,
  collectWorkspace,
  parseWorkspace,
  workspaceFingerprint,
  type KeyValueStore,
} from "./workspace";

const memory = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
};

function seeded() {
  const s = memory();
  s.setItem(
    SCRIPT_KEY,
    JSON.stringify({ text: "Merhaba\nDünya", at: 1000, from: "main" }),
  );
  const scene = defaultProject().scenes[0]!;
  const t = makeMyTemplate("Açılış", scene, { w: 1920, h: 1080 }, 5000)!;
  s.setItem(MY_TEMPLATES_KEY, JSON.stringify([t]));
  s.setItem(
    TPL_KEY,
    JSON.stringify(
      addTemplate([], "Haber", { ...emptyScene(), layout: "full" }).list,
    ),
  );
  return s;
}

describe("local workspace", () => {
  it("export then import into an empty browser reproduces identical data", () => {
    const a = seeded();
    const file = collectWorkspace(a);
    expect(file.items.map((i) => i.type).sort()).toEqual([
      "classic_template",
      "prompter_script",
      "studio_scene",
    ]);
    const text = JSON.stringify(file);
    const parsed = parseWorkspace(text);
    expect(parsed.ok).toBe(true);
    const b = memory();
    if (parsed.ok)
      expect(applyWorkspace(b, parsed.file, "replace")).toEqual({
        imported: 3,
        skipped: 0,
      });
    expect(workspaceFingerprint(collectWorkspace(b))).toBe(
      workspaceFingerprint(file),
    );
  });

  it("merge keeps newer local script and other local templates", () => {
    const a = seeded();
    const file = collectWorkspace(a);
    const b = memory();
    b.setItem(
      SCRIPT_KEY,
      JSON.stringify({ text: "Yeni", at: 9999, from: "classic" }),
    );
    b.setItem(
      TPL_KEY,
      JSON.stringify(addTemplate([], "Yerel", emptyScene()).list),
    );
    applyWorkspace(b, file, "merge");
    const out = collectWorkspace(b);
    expect(out.items.find((i) => i.type === "prompter_script")?.title).toBe(
      "Yeni",
    );
    expect(
      out.items
        .filter((i) => i.type === "classic_template")
        .map((i) => i.title)
        .sort(),
    ).toEqual(["Haber", "Yerel"]);
  });

  it("rejects bad files and skips invalid items", () => {
    expect(parseWorkspace("{nope")).toEqual({ ok: false, error: "not-json" });
    expect(parseWorkspace("{}")).toEqual({ ok: false, error: "invalid" });
    expect(
      parseWorkspace(
        JSON.stringify({
          schemaVersion: SCHEMA_VERSION + 1,
          type: "workspace",
          exportedAt: "",
          items: [],
        }),
      ),
    ).toEqual({ ok: false, error: "newer-version" });
    const r = parseWorkspace(
      JSON.stringify({
        schemaVersion: 1,
        type: "workspace",
        exportedAt: "x",
        items: [
          { type: "classic_template", id: "1", title: "x", data: { id: "1" } },
          { type: "studio_scene", id: "2", title: "y", data: "junk" },
          {
            type: "prompter_script",
            id: "script",
            title: "z",
            data: { text: 5 },
          },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    const s = memory();
    if (r.ok)
      expect(applyWorkspace(s, r.file)).toEqual({ imported: 0, skipped: 3 });
  });
});
