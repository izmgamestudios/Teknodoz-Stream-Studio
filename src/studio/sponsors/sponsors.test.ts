import { describe, expect, it, vi } from "vitest";

import { createLayer, defaultProject } from "../defaults";
import { exportPptdz, importPptdz } from "../project/pptdz";
import {
  MAX_SPONSORS,
  layerSchema,
  parseProject,
  sponsorSchema,
} from "../project/schema";
import { assetIdsInProject, createProjectStore } from "../project/store";
import { createMemoryAssetStore } from "../storage";
import type { Sponsor } from "../types";
import {
  TIER_WEIGHT,
  drawSponsors,
  pickRotation,
  sortForAir,
  type SponsorItem,
} from "./draw";
import { SponsorExposure } from "./exposure";
import { fmtDuration, sponsorReportCsv } from "./report";

const sp = (over: Partial<Omit<Sponsor, "id">> = {}): Omit<Sponsor, "id"> => ({
  name: "Acme",
  kind: "sponsor",
  tier: "gold",
  url: "https://acme.example",
  tagline: "Her yayına güç",
  logoAssetId: "",
  onAir: true,
  ...over,
});

describe("rotation", () => {
  it("gives heavier tiers longer slots and is a pure function of time", () => {
    const w = [TIER_WEIGHT.title, TIER_WEIGHT.gold, TIER_WEIGHT.silver]; // 3,2,1
    const at = (t: number) => pickRotation(w, t, 1000)?.index;
    expect([at(0), at(2999), at(3000), at(4999), at(5000), at(5999)]).toEqual([
      0, 0, 1, 1, 2, 2,
    ]);
    expect(at(6000)).toBe(0); // cycle = 6 s
    expect(at(6000 * 1000 + 3500)).toBe(1);
    expect(pickRotation(w, -500, 1000)?.index).toBe(2); // negative time wraps
    const p = pickRotation(w, 1500, 1000);
    expect(p?.progress).toBeCloseTo(0.5, 5);
  });
  it("handles empty input and bad dwell", () => {
    expect(pickRotation([], 0, 1000)).toBeNull();
    expect(pickRotation([1], 0, 0)).toBeNull();
    expect(pickRotation([1], 123, 1000)).toMatchObject({ index: 0 });
  });
  it("orders by tier, keeping the given order inside a tier", () => {
    const items = [
      { id: "a", tier: "silver" as const },
      { id: "b", tier: "title" as const },
      { id: "c", tier: "silver" as const },
      { id: "d", tier: "gold" as const },
    ];
    expect(sortForAir(items).map((i) => i.id)).toEqual(["b", "d", "a", "c"]);
  });
});

function fakeCtx() {
  const calls: string[] = [];
  let saves = 0;
  const target: Record<string, unknown> = {
    measureText: (s: string) => ({ width: s.length * 10 }),
    save: () => void saves++,
    restore: () => void saves--,
    globalAlpha: 1,
  };
  const ctx = new Proxy(target, {
    get(t, k: string) {
      return k in t
        ? t[k]
        : (...a: unknown[]) => void calls.push(`${k}(${a.join(",")})`);
    },
    set(t, k: string, v) {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, balanced: () => saves === 0 };
}

const box = { x: 0, y: 0, w: 560, h: 150 };
const item = (
  id: string,
  tier: SponsorItem["tier"],
  logo = false,
): SponsorItem => ({
  id,
  name: `Sponsor ${id}`,
  tagline: "slogan",
  kind: "sponsor",
  tier,
  logo: logo
    ? { source: {} as CanvasImageSource, width: 200, height: 100 }
    : null,
});

describe("drawSponsors", () => {
  const layer = createLayer("sponsor", {
    transform: { x: 0, y: 0, w: 560, h: 150, rotation: 0 },
  });
  it("draws one sponsor at a time in rotate mode and reports which", () => {
    const { ctx, calls, balanced } = fakeCtx();
    const items = [item("a", "title", true), item("b", "silver")];
    const shown = drawSponsors(ctx, layer, box, 1000, items);
    expect(shown).toEqual(["a"]);
    expect(calls.some((c) => c.startsWith("drawImage"))).toBe(true);
    expect(
      calls
        .filter((c) => c.startsWith("fillText"))
        .some((c) => c.includes("Sponsor a")),
    ).toBe(true);
    // title slot = 3 × 6 s dwell; then the silver sponsor, which has no logo (text only)
    const c2 = fakeCtx();
    expect(drawSponsors(c2.ctx, layer, box, 18_000 + 100, items)).toEqual([
      "b",
    ]);
    expect(c2.calls.some((c) => c.startsWith("drawImage"))).toBe(false);
    expect(balanced()).toBe(true);
  });
  it("shows everybody in strip mode", () => {
    const { ctx, calls } = fakeCtx();
    const strip = createLayer("sponsor", {
      mode: "strip",
      transform: layer.transform,
    });
    const shown = drawSponsors(ctx, strip, box, 0, [
      item("a", "gold", true),
      item("b", "silver", true),
      item("c", "supporter"),
    ]);
    expect(shown).toEqual(["a", "b", "c"]);
    expect(calls.filter((c) => c.startsWith("drawImage"))).toHaveLength(2);
  });
  it("draws nothing without sponsors or on a degenerate box", () => {
    const { ctx, calls } = fakeCtx();
    expect(drawSponsors(ctx, layer, box, 0, [])).toEqual([]);
    expect(
      drawSponsors(ctx, layer, { ...box, w: 0 }, 0, [item("a", "gold")]),
    ).toEqual([]);
    expect(calls).toEqual([]);
  });
  it("the layer defaults are schema-valid", () => {
    expect(layerSchema.safeParse(layer).success).toBe(true);
    expect(layerSchema.safeParse({ ...layer, dwellMs: 10 }).success).toBe(
      false,
    );
  });
});

describe("SponsorExposure", () => {
  it("counts only on-air frames and ignores gaps (pauses, scene switches)", () => {
    const e = new SponsorExposure();
    e.record(["a"], 0);
    e.record(["a"], 16); // not on air: nothing counted
    expect(e.snapshot().totalMs).toEqual({});
    e.setOnAir(true, 1_000_000);
    e.record(["a", "b"], 100);
    e.record(["a", "b"], 116);
    e.record(["a"], 132);
    e.record(["a"], 5_000); // big gap: skipped
    e.record(["a"], 5_016);
    const s = e.snapshot();
    expect(s.totalMs).toEqual({ a: 48, b: 16 });
    expect(s.sessionMs).toEqual({ a: 48, b: 16 });
    expect(s.sessionStartedAt).toBe(1_000_000);
    expect(e.takeDirty()).toBe(true);
    expect(e.takeDirty()).toBe(false);
  });
  it("starts a fresh session per on-air period but keeps the all-time total", () => {
    const e = new SponsorExposure();
    e.setOnAir(true, 10);
    e.record(["a"], 0);
    e.record(["a"], 100);
    e.setOnAir(false);
    e.setOnAir(true, 20);
    e.record(["a"], 200);
    e.record(["a"], 250);
    const s = e.snapshot();
    expect(s.sessionMs["a"]).toBe(50);
    expect(s.totalMs["a"]).toBe(150);
    expect(s.sessionStartedAt).toBe(20);
  });
  it("restores defensively, prunes removed sponsors and clears", () => {
    const e = new SponsorExposure();
    e.restore({
      totalMs: { a: 5, b: -1, c: "x" },
      sessionMs: { a: 2 },
      sessionStartedAt: "nope",
    });
    expect(e.snapshot()).toEqual({
      totalMs: { a: 5 },
      sessionMs: { a: 2 },
      sessionStartedAt: null,
    });
    e.restore("garbage");
    expect(e.snapshot().totalMs).toEqual({ a: 5 });
    e.prune(new Set(["z"]));
    expect(e.snapshot().totalMs).toEqual({});
    e.clear();
    expect(e.snapshot().sessionStartedAt).toBeNull();
  });
});

describe("report", () => {
  it("lists every sponsor and neutralises spreadsheet formulas", () => {
    const sponsors: Sponsor[] = [
      { id: "s1", ...sp({ name: '=HYPERLINK("x")', tier: "title" }) },
      {
        id: "s2",
        ...sp({ name: "Beta, Ltd.", kind: "partner", tier: "silver" }),
      },
    ];
    const csv = sponsorReportCsv(sponsors, {
      totalMs: { s1: 3_723_000 },
      sessionMs: { s1: 125_400 },
      sessionStartedAt: Date.UTC(2026, 10, 5, 17, 30),
    });
    const lines = csv
      .replace(/^\ufeff/, "")
      .trim()
      .split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("'=HYPERLINK");
    expect(lines[1]).toContain(",125,02:05,3723,1:02:03,");
    expect(lines[1]).toContain("2026-11-05T17:30:00.000Z");
    expect(lines[2]).toContain('"Beta, Ltd."');
    expect(lines[2]).toContain(",0,00:00,0,00:00,");
    expect(csv.startsWith("\ufeff")).toBe(true);
    expect(fmtDuration(59.6)).toBe("01:00");
  });
});

describe("project integration", () => {
  it("store: add / update / reorder / remove with validation and undo", () => {
    vi.useFakeTimers();
    const store = createProjectStore(defaultProject());
    const a = store.addSponsor(sp({ name: "A" }))!;
    const b = store.addSponsor(sp({ name: "B", tier: "title" }))!;
    expect(store.getState().sponsors.map((s) => s.name)).toEqual(["A", "B"]);
    expect(store.addSponsor(sp({ name: "   " }))).toBeUndefined(); // blank name
    expect(
      store.addSponsor(sp({ url: "javascript:alert(1)" })),
    ).toBeUndefined();
    expect(store.updateSponsor(a, { url: "ftp://x" })).toBe(false);
    expect(store.updateSponsor(a, { tier: "silver", onAir: false })).toBe(true);
    expect(store.getState().sponsors[0]).toMatchObject({
      id: a,
      tier: "silver",
      onAir: false,
    });
    store.moveSponsor(1, 0);
    expect(store.getState().sponsors[0]?.id).toBe(b);
    expect(store.removeSponsor("nope")).toBe(false);
    expect(store.removeSponsor(a)).toBe(true);
    expect(store.undo()).toBe(true);
    expect(store.getState().sponsors).toHaveLength(2);
    for (let i = 0; i < MAX_SPONSORS; i++)
      store.addSponsor(sp({ name: `S${i}` }));
    expect(store.getState().sponsors).toHaveLength(MAX_SPONSORS);
    expect(store.addSponsor(sp())).toBeUndefined();
    vi.useRealTimers();
  });

  it("logos count as project assets", () => {
    const p = defaultProject();
    p.sponsors = [{ id: "s", ...sp({ logoAssetId: "logo_1" }) }];
    expect(assetIdsInProject(p)).toContain("logo_1");
  });

  it("parseProject repairs: drops bad sponsors, de-duplicates ids, defaults old files to none", () => {
    const base = defaultProject();
    const good = { id: "x", ...sp() };
    const raw = {
      ...base,
      sponsors: [
        good,
        { ...good },
        { ...good, id: "y", url: "javascript:1" },
        42,
        { ...good, id: "z", kind: "alien" },
      ],
    };
    const r = parseProject(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.project.sponsors).toHaveLength(2);
    expect(new Set(r.project.sponsors.map((s) => s.id)).size).toBe(2);
    expect(r.warnings.filter((w) => w.includes("sponsor"))).toHaveLength(3);
    const old = parseProject({ ...base, sponsors: undefined });
    expect(old.ok && old.project.sponsors).toEqual([]);
    expect(sponsorSchema.safeParse(good).success).toBe(true);
  });

  it(".pptdz carries sponsor logos and remaps their ids", async () => {
    const src = createMemoryAssetStore();
    const logo = await src.put(
      new Blob([new Uint8Array([9, 8, 7])], { type: "image/png" }),
      { name: "l.png", type: "image" },
    );
    const project = defaultProject();
    project.sponsors = [
      { id: "s1", ...sp({ logoAssetId: logo.id }) },
      { id: "s2", ...sp({ name: "Ghost", logoAssetId: "missing" }) },
    ];
    const { blob, missingAssets } = await exportPptdz(project, src);
    expect(missingAssets).toEqual(["missing"]);
    const dst = createMemoryAssetStore();
    const res = await importPptdz(blob, dst, { mode: "merge" });
    const s1 = res.project.sponsors.find((s) => s.id === "s1")!;
    expect(s1.logoAssetId).not.toBe("");
    expect((await dst.get(s1.logoAssetId))?.name).toBe("l.png");
    expect(res.project.sponsors.find((s) => s.id === "s2")?.logoAssetId).toBe(
      "",
    );
    expect(res.warnings.some((w) => w.includes("Ghost"))).toBe(true);
  });
});
