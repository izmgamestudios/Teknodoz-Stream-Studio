import { describe, expect, it } from "vitest";

import { resolveBrand } from "./brand";
import { WARNING_TEXT, checkBrand } from "./check";

describe("brand checks", () => {
  it("flags the default brand only for the missing site URL", () => {
    expect(checkBrand(resolveBrand())).toEqual(["no-site-url"]);
  });

  it("is quiet for a complete brand", () => {
    expect(
      checkBrand(
        resolveBrand({
          siteUrl: "https://a.example",
          accent: "#22d3ee",
          description:
            "Ücretsiz ve açık kaynak, tarayıcıda çalışan canlı yayın ve konuk stüdyosu.",
        }),
      ),
    ).toEqual([]);
  });

  it("reports contrast, length and index problems", () => {
    const w = checkBrand(
      resolveBrand({
        accent: "#15171c",
        ogImage: "",
        description: "x".repeat(200),
        shortName: "A very long name",
        robots: "noindex,nofollow",
      }),
    );
    expect(w).toEqual(
      expect.arrayContaining([
        "accent-contrast",
        "no-og-image",
        "description-long",
        "short-name-long",
        "noindex",
      ]),
    );
    expect(checkBrand(resolveBrand({ description: "kısa" }))).toContain(
      "description-short",
    );
  });

  it("has a Turkish and English sentence for every warning", () => {
    for (const w of Object.values(WARNING_TEXT)) {
      expect(w.tr.length).toBeGreaterThan(10);
      expect(w.en.length).toBeGreaterThan(10);
    }
  });
});
