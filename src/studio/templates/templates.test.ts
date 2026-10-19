import { describe, expect, it, vi } from "vitest";

import { defaultProject } from "../defaults";
import { layerSchema, LIMITS } from "../project/schema";
import { parseProject } from "../project/schema";
import { createProjectStore } from "../project/store";
import type { AssetStore } from "../types";
import { LOGICAL_H, LOGICAL_W } from "../types";
import { backdropAssetId, ensureBackdrop, glowAt } from "./backdrop";
import {
  TEMPLATE_IMAGE_MAX_BYTES,
  checkTemplateImage,
  loadRemembered,
  saveRemembered,
} from "./uploads";
import {
  buildTemplateScene,
  cleanText,
  emptyGuestSlots,
  normalizeHex,
  resolveOptions,
} from "./build";
import { TEMPLATES, getTemplate } from "./catalog";

describe("catalog", () => {
  it("ships the requested layouts with unique ids", () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const want of [
      "news",
      "solo",
      "mobile",
      "desktop",
      "duo",
      "quad",
      "tutorial",
      "dual-screen",
    ])
      expect(ids).toContain(want);
    expect(getTemplate("nope")).toBeUndefined();
  });

  it.each(TEMPLATES.map((t) => [t.id, t] as const))(
    "%s: panels stay on the stage and do not overlap",
    (_id, def) => {
      for (const p of def.panels) {
        expect(p.rect.x).toBeGreaterThanOrEqual(0);
        expect(p.rect.y).toBeGreaterThanOrEqual(0);
        expect(p.rect.x + p.rect.w).toBeLessThanOrEqual(
          def.stage?.w ?? LOGICAL_W,
        );
        expect(p.rect.y + p.rect.h).toBeLessThanOrEqual(
          def.stage?.h ?? LOGICAL_H,
        );
      }
      for (const [i, a] of def.panels.entries())
        for (const b of def.panels.slice(i + 1)) {
          const overlap =
            a.rect.x < b.rect.x + b.rect.w &&
            b.rect.x < a.rect.x + a.rect.w &&
            a.rect.y < b.rect.y + b.rect.h &&
            b.rect.y < a.rect.y + a.rect.h;
          expect(overlap, `${a.id} x ${b.id}`).toBe(false);
        }
    },
  );
});

describe("buildTemplateScene", () => {
  it.each(TEMPLATES.map((t) => [t.id, t] as const))(
    "%s builds a schema-valid scene inside the layer limit",
    (_id, def) => {
      const scene = buildTemplateScene(def, {}, "tpl-bg-1d4ed8");
      expect(scene.layers.length).toBeGreaterThan(0);
      expect(scene.layers.length).toBeLessThan(LIMITS.layersPerScene);
      for (const l of scene.layers)
        expect(layerSchema.safeParse(l).success, l.name).toBe(true);
      const ids = scene.layers.map((l) => l.id);
      expect(new Set(ids).size).toBe(ids.length);
      // the whole scene is a valid project
      const project = { ...defaultProject(), scenes: [scene] };
      project.activeSceneId = scene.id;
      expect(parseProject(project).ok).toBe(true);
    },
  );

  it("news: presenter + footage panel, red tag, banner and ticker (reference layout)", () => {
    const def = getTemplate("news")!;
    const scene = buildTemplateScene(def, {}, "bg");
    const names = scene.layers.map((l) => l.name);
    expect(scene.layers[0]?.kind).toBe("image");
    expect(names).toEqual(
      expect.arrayContaining([
        "Sunucu",
        "Haber görüntüsü",
        "Etiket (kırmızı)",
        "Alt bant",
        "Kayan yazı",
      ]),
    );
    const banner = scene.layers.find((l) => l.name === "Alt bant");
    expect(banner?.kind === "text" && banner.text).toBe("BREAKING NEWS");
    const tag = scene.layers.find((l) => l.name === "Etiket (kırmızı)");
    expect(tag?.kind === "text" && tag.background).toBe("#e11d2e");
    const ticker = scene.layers.find((l) => l.name === "Kayan yazı");
    expect(ticker?.kind === "text" && ticker.style).toBe("ticker");
    // frames are stroke-only so the video shows through
    const frame = scene.layers.find((l) => l.name === "Sunucu (çerçeve)");
    expect(frame?.kind === "shape" && [frame.fill, frame.strokeWidth]).toEqual([
      "transparent",
      8,
    ]);
    // media sits below its frame, frames below the lower third
    const idx = (n: string) => names.indexOf(n);
    expect(idx("Sunucu")).toBeLessThan(idx("Sunucu (çerçeve)"));
    expect(idx("Sunucu (çerçeve)")).toBeLessThan(idx("Alt bant"));
    // the lower-third banner never collides with the ticker bar
    const b = banner!.transform;
    expect(b.y + b.h).toBeLessThanOrEqual(ticker!.transform.y);
  });

  it("top-title layouts get a name plate instead of an orphaned red tag", () => {
    for (const id of ["tutorial", "dual-screen"]) {
      const scene = buildTemplateScene(getTemplate(id)!);
      const names = scene.layers.map((l) => l.name);
      expect(names).toContain("Başlık şeridi");
      expect(names).toContain("Alt bant");
      expect(names).not.toContain("Etiket (kırmızı)");
    }
    const noTag = buildTemplateScene(getTemplate("tutorial")!, { tag: "" });
    expect(noTag.layers.some((l) => l.name === "Alt bant")).toBe(false);
  });

  it("uses a flat fallback when no backdrop asset could be made", () => {
    const scene = buildTemplateScene(getTemplate("duo")!);
    expect(scene.layers[0]?.kind).toBe("shape");
    expect(scene.layers[0]?.name).toBe("Arka plan");
  });

  it("skips the backdrop for full-bleed layouts and the tag when empty", () => {
    const solo = buildTemplateScene(getTemplate("solo")!, { tag: "" });
    expect(solo.layers.some((l) => l.name === "Arka plan")).toBe(false);
    expect(solo.layers.some((l) => l.name.startsWith("Etiket"))).toBe(false);
  });

  it("guest panels start empty and are reported as free slots", () => {
    const quad = buildTemplateScene(getTemplate("quad")!);
    expect(emptyGuestSlots(quad)).toHaveLength(3);
    const duo = buildTemplateScene(getTemplate("duo")!);
    expect(emptyGuestSlots(duo)).toHaveLength(1);
  });

  it("applies and sanitizes user options", () => {
    const def = getTemplate("news")!;
    const o = resolveOptions(def, {
      accent: "javascript:alert(1)",
      title: "  Son   dakika \n haber  ".repeat(50),
      ticker: "x".repeat(5000),
    });
    expect(o.accent).toBe(def.defaults.accent);
    expect(o.title.length).toBeLessThanOrEqual(300);
    expect(o.title).not.toMatch(/\s{2}/);
    expect(o.ticker).toHaveLength(300);
    expect(normalizeHex("#ABCDEF", "#000000")).toBe("#abcdef");
    expect(normalizeHex("red", "#000000")).toBe("#000000");
    expect(cleanText("  a \t b ")).toBe("a b");
  });
});

describe("store integration", () => {
  it("insertScene adds after the active scene and activates it", () => {
    const store = createProjectStore(defaultProject());
    const before = store.getState().scenes.length;
    const scene = buildTemplateScene(getTemplate("quad")!);
    const id = store.insertScene({ ...scene, hotkey: "9" })!;
    const st = store.getState();
    expect(st.scenes).toHaveLength(before + 1);
    expect(st.activeSceneId).toBe(id);
    expect(st.scenes[1]?.id).toBe(id);
    expect(st.scenes[1]?.hotkey).toBeUndefined();
    expect(st.scenes[1]?.layers.length).toBe(scene.layers.length);
    // layer ids are re-issued so the same template can be applied twice
    const again = store.insertScene(scene)!;
    const a = store.getState().scenes.find((s) => s.id === id)!;
    const b = store.getState().scenes.find((s) => s.id === again)!;
    expect(a.layers[0]?.id).not.toBe(b.layers[0]?.id);
    expect(store.undo()).toBe(true);
    expect(store.getState().scenes.some((s) => s.id === again)).toBe(false);
  });

  it("replaceSceneLayers swaps layers but keeps id, hotkey and transition", () => {
    const store = createProjectStore(defaultProject());
    const target = store.getState().scenes[0]!;
    const scene = buildTemplateScene(getTemplate("tutorial")!);
    expect(store.replaceSceneLayers(target.id, scene.layers, scene.name)).toBe(
      true,
    );
    const next = store.getState().scenes[0]!;
    expect(next.id).toBe(target.id);
    expect(next.hotkey).toBe(target.hotkey);
    expect(next.transition).toEqual(target.transition);
    expect(next.name).toBe(scene.name);
    expect(next.layers.length).toBe(scene.layers.length);
    expect(store.replaceSceneLayers("missing", scene.layers)).toBe(false);
  });
});

describe("backdrop", () => {
  it("has a stable per-color asset id and a glow that stays in 0..1", () => {
    expect(backdropAssetId("#1D4ED8")).toBe("tpl-bg-1d4ed8");
    for (const [x, y] of [
      [0, 0],
      [1700, 100],
      [100, 1000],
      [960, 540],
    ] as const) {
      const g = glowAt(x, y, LOGICAL_W, LOGICAL_H);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
    }
    expect(glowAt(1690, 108, LOGICAL_W, LOGICAL_H)).toBeGreaterThan(
      glowAt(960, 1000, LOGICAL_W, LOGICAL_H),
    );
  });

  it("reuses an existing asset and degrades to undefined without canvas", async () => {
    const puts: string[] = [];
    const assets = {
      get: async (id: string) =>
        id === "tpl-bg-aaaaaa" ? ({ id } as never) : undefined,
      put: async (_b: Blob, _m: unknown, id?: string) => {
        puts.push(id ?? "");
        return {} as never;
      },
    } as unknown as AssetStore;
    expect(await ensureBackdrop(assets, "#aaaaaa")).toBe("tpl-bg-aaaaaa");
    // jsdom has no 2d canvas -> graceful fallback, nothing stored
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(await ensureBackdrop(assets, "#bbbbbb")).toBeUndefined();
    expect(puts).toEqual([]);
  });
});

describe("logo and custom background", () => {
  const overlap = (
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number },
  ) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  it.each(TEMPLATES.map((t) => [t.id, t] as const))(
    "%s: the logo slot is on stage and does not cover text bars",
    (id, def) => {
      const r = def.logo;
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      const SW = def.stage?.w ?? LOGICAL_W;
      const SH = def.stage?.h ?? LOGICAL_H;
      expect(r.x + r.w).toBeLessThanOrEqual(SW);
      expect(r.y + r.h).toBeLessThanOrEqual(SH);
      if (def.lowerThird)
        expect(overlap(r, { ...def.lowerThird, h: 164 }), "lower third").toBe(
          false,
        );
      if (def.ticker)
        expect(overlap(r, { x: 0, y: SH - 90, w: SW, h: 90 }), "ticker").toBe(
          false,
        );
      // only the full-bleed layouts (solo, quad) may put the logo over video
      if (!["solo", "quad", "radio", "v-solo", "sq-solo"].includes(id))
        for (const p of def.panels)
          expect(overlap(r, p.rect), p.id).toBe(false);
    },
  );

  it("adds the logo layer just below the ticker and a cover background", () => {
    const def = getTemplate("news")!;
    const scene = buildTemplateScene(def, {
      logoAssetId: "logo_abc",
      backgroundAssetId: "bg_xyz",
    });
    const names = scene.layers.map((l) => l.name);
    const logo = scene.layers.find((l) => l.name === "Logo");
    expect(logo).toMatchObject({
      kind: "image",
      assetId: "logo_abc",
      fit: "contain",
    });
    expect(logo?.transform).toMatchObject({
      x: def.logo.x,
      y: def.logo.y,
      w: def.logo.w,
      h: def.logo.h,
    });
    expect(names.indexOf("Logo")).toBeLessThan(names.indexOf("Kayan yazı"));
    const bg = scene.layers[0];
    expect(bg).toMatchObject({
      kind: "image",
      assetId: "bg_xyz",
      fit: "cover",
      name: "Arka plan (özel)",
    });
    for (const l of scene.layers)
      expect(layerSchema.safeParse(l).success, l.name).toBe(true);
    // a custom background wins over the generated one
    const both = buildTemplateScene(
      def,
      { backgroundAssetId: "bg_xyz" },
      "tpl-bg-1d4ed8",
    );
    expect(
      both.layers.filter(
        (l) => l.kind === "image" && l.assetId === "tpl-bg-1d4ed8",
      ),
    ).toHaveLength(0);
  });

  it("ignores malformed asset ids and templates without backdrop keep the camera full-bleed", () => {
    const def = getTemplate("news")!;
    const o = resolveOptions(def, {
      logoAssetId: "../../etc",
      backgroundAssetId: "a b",
    });
    expect(o.logoAssetId).toBeUndefined();
    expect(o.backgroundAssetId).toBeUndefined();
    const solo = buildTemplateScene(getTemplate("solo")!, {
      backgroundAssetId: "bg_xyz",
    });
    expect(
      solo.layers.some((l) => l.kind === "image" && l.assetId === "bg_xyz"),
    ).toBe(false);
  });

  it("validates upload types and sizes", () => {
    expect(checkTemplateImage({ type: "image/png", size: 1000 })).toBeNull();
    expect(checkTemplateImage({ type: "image/svg+xml", size: 1000 })).toBe(
      "type",
    );
    expect(checkTemplateImage({ type: "application/pdf", size: 1000 })).toBe(
      "type",
    );
    expect(checkTemplateImage({ type: "image/jpeg", size: 0 })).toBe("size");
    expect(
      checkTemplateImage({
        type: "image/jpeg",
        size: TEMPLATE_IMAGE_MAX_BYTES + 1,
      }),
    ).toBe("size");
  });

  it("remembers only well-formed asset ids", () => {
    const m = new Map<string, string>();
    const st = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    };
    expect(loadRemembered(st)).toEqual({});
    saveRemembered({ logoAssetId: "ly_ab12", backgroundAssetId: "bg-1" }, st);
    expect(loadRemembered(st)).toEqual({
      logoAssetId: "ly_ab12",
      backgroundAssetId: "bg-1",
    });
    m.set(
      "tkz.templates.images.v1",
      JSON.stringify({ logoAssetId: "x/../y", backgroundAssetId: 5 }),
    );
    expect(loadRemembered(st)).toEqual({});
    m.set("tkz.templates.images.v1", "{not json");
    expect(loadRemembered(st)).toEqual({});
  });
});
