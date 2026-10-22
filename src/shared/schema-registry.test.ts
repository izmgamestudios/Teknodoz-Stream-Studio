// src/shared/schema-registry.test.ts
import { describe, expect, it } from "vitest";

import {
  ENTITY_TYPES,
  PLANE,
  PUBLIC_TYPES,
  exposedFields,
  fieldsFor,
  secretFields,
  slugify,
  zodFor,
  zodForImport,
} from "./schema-registry";

describe("registry", () => {
  it("every type has a plane, base fields and unique keys", () => {
    for (const t of ENTITY_TYPES) {
      expect(PLANE[t]).toMatch(/local|catalog/);
      const keys = fieldsFor(t).map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys).toEqual(
        expect.arrayContaining(["title", "slug", "summary", "visibility"]),
      );
    }
    expect(PUBLIC_TYPES).toEqual(["story", "video", "podcast"]);
  });

  it("secret fields are excluded by construction and rejected on input", () => {
    expect(secretFields("live_event").sort()).toEqual([
      "rtmp_url",
      "stream_key",
    ]);
    expect(secretFields("room")).toEqual([
      "join_code",
      "guest_email",
      "guest_phone",
    ]);
    for (const t of ENTITY_TYPES)
      for (const key of secretFields(t))
        expect(exposedFields(t).some((f) => f.key === key)).toBe(false);
    const bad = zodFor("live_event").safeParse({
      title: "x",
      stream_key: "abc",
    });
    expect(bad.success).toBe(false);
  });
});

describe("zod", () => {
  const ok = { title: "Röportaj", slug: "roportaj", locale: "tr", tags: ["a"] };

  it("accepts a valid video and checks urls, slug, duration and faq", () => {
    expect(
      zodFor("video").safeParse({
        ...ok,
        media_url: "https://x.org/a.mp4",
        duration_sec: 90,
      }).success,
    ).toBe(true);
    expect(
      zodFor("video").safeParse({ ...ok, media_url: "javascript:alert(1)" })
        .success,
    ).toBe(false);
    expect(
      zodFor("video").safeParse({ ...ok, media_url: "https://u:p@x.org/a" })
        .success,
    ).toBe(false);
    expect(zodFor("video").safeParse({ ...ok, slug: "Bad Slug" }).success).toBe(
      false,
    );
    expect(zodFor("video").safeParse({ ...ok, duration_sec: -1 }).success).toBe(
      false,
    );
    expect(
      zodFor("video").safeParse({ ...ok, faq: [{ q: "Soru?", a: "Cevap." }] })
        .success,
    ).toBe(true);
    expect(
      zodFor("video").safeParse({ ...ok, faq: [{ q: "", a: "x" }] }).success,
    ).toBe(false);
    expect(zodFor("video").safeParse({ ...ok, unknown: 1 }).success).toBe(
      false,
    );
    expect(zodFor("video").safeParse({ slug: "x" }).success).toBe(false); // title required
  });

  it("import cannot set public or protected", () => {
    expect(
      zodForImport("story").safeParse({ ...ok, visibility: "draft" }).success,
    ).toBe(true);
    expect(
      zodForImport("story").safeParse({ ...ok, visibility: "private" }).success,
    ).toBe(true);
    expect(
      zodForImport("story").safeParse({ ...ok, visibility: "public" }).success,
    ).toBe(false);
    expect(
      zodForImport("story").safeParse({ ...ok, visibility: "protected" })
        .success,
    ).toBe(false);
    expect(
      zodFor("story").safeParse({ ...ok, visibility: "public" }).success,
    ).toBe(true);
  });
});

describe("slugify", () => {
  it("transliterates and trims", () => {
    expect(slugify("Çağrı Merkezi: Işık & Ümit!")).toBe(
      "cagri-merkezi-isik-umit",
    );
    expect(slugify("Größe Überraschung")).toBe("grosse-uberraschung");
    expect(slugify("¡Mañana!")).toBe("manana");
    expect(slugify("  ---  ")).toBe("item");
    expect(slugify("a".repeat(200)).length).toBeLessThanOrEqual(80);
  });
});
