import { describe, expect, it } from "vitest";

import {
  CANONICAL_CATEGORIES,
  canonicalCategory,
  categoryOptions,
  compareCategories,
} from "./categories";

describe("editorial categories", () => {
  it("has the eleven news topics in order", () => {
    expect(CANONICAL_CATEGORIES).toHaveLength(11);
    expect(CANONICAL_CATEGORIES[0]).toBe("Eğitim & Gelişim");
    expect(CANONICAL_CATEGORIES[10]).toBe("Kültür Sanat");
  });
  it("normalises case, diacritics and the ampersand", () => {
    expect(canonicalCategory("kadin ve ilham")).toBe("Kadın & İlham");
    expect(canonicalCategory("  SAĞLIK & İYİ YAŞAM ")).toBe(
      "Sağlık & İyi Yaşam",
    );
    expect(canonicalCategory("gida&surdurulebilirlik")).toBe(
      "Gıda & Sürdürülebilirlik",
    );
    expect(canonicalCategory("kultur sanat")).toBe("Kültür Sanat");
  });
  it("keeps the plain and the combined topic apart", () => {
    expect(canonicalCategory("eğitim")).toBe("Eğitim");
    expect(canonicalCategory("Eğitim ve Gelişim")).toBe("Eğitim & Gelişim");
    expect(canonicalCategory("sağlık")).toBe("Sağlık");
  });
  it("keeps unknown names as typed and empty as empty", () => {
    expect(canonicalCategory(" Belgesel ")).toBe("Belgesel");
    expect(canonicalCategory("   ")).toBe("");
  });
  it("orders editorial topics first, then others alphabetically", () => {
    const o = categoryOptions(["Belgesel", "Haber", "Çözüm Hikayeleri", ""]);
    expect(o.slice(0, 11)).toEqual([...CANONICAL_CATEGORIES]);
    expect(o.slice(11)).toEqual(["Belgesel", "Haber"]);
    expect(compareCategories("Kültür Sanat", "Aaa")).toBeLessThan(0);
  });
});
