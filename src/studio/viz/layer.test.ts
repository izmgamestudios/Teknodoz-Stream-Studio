import { describe, expect, it } from "vitest";

import { createLayer } from "../defaults";
import { layerSchema } from "../project/schema";
import { TEMPLATES } from "../templates/catalog";
import { buildTemplateScene } from "../templates/build";

describe("audioviz layer", () => {
  it("is created with sensible defaults and passes the project schema", () => {
    const l = createLayer("audioviz");
    expect(l).toMatchObject({
      kind: "audioviz",
      sources: ["voices"],
      style: "mirror",
    });
    expect(layerSchema.safeParse(l).success).toBe(true);
  });
  it("rejects garbage in a saved project", () => {
    const l = { ...createLayer("audioviz"), style: "disco", bars: 5000 };
    expect(layerSchema.safeParse(l).success).toBe(false);
  });
});

describe("podcast templates", () => {
  const pods = TEMPLATES.filter((t) => t.group === "podcast");
  it("ships audio-only, video and vertical podcast layouts", () => {
    expect(pods.map((t) => t.id)).toEqual(
      expect.arrayContaining([
        "pod-wave",
        "pod-bars",
        "pod-video2",
        "pod-cam-ring",
        "v-pod",
      ]),
    );
    expect(pods.find((t) => t.id === "v-pod")?.format).toBe("9:16");
  });
  it.each(pods.map((t) => t.id))(
    "%s builds a valid scene with a voices visualiser",
    (id) => {
      const def = TEMPLATES.find((t) => t.id === id)!;
      const scene = buildTemplateScene(def);
      const viz = scene.layers.filter((l) => l.kind === "audioviz");
      expect(viz).toHaveLength(1);
      expect(viz[0]).toMatchObject({ sources: ["voices"] });
      for (const l of scene.layers)
        expect(layerSchema.safeParse(l).success, `${id}:${l.name}`).toBe(true);
    },
  );
  it("the video podcast has camera and guest slots next to the visualiser", () => {
    const scene = buildTemplateScene(
      TEMPLATES.find((t) => t.id === "pod-video2")!,
    );
    const kinds = scene.layers.map((l) => l.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(["webcam", "guest", "audioviz"]),
    );
  });
});
