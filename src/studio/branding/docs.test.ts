import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { BRAND_KEYS, DEFAULT_BRAND, envNameFor } from "./brand";

const DOCS = resolve(dirname(fileURLToPath(import.meta.url)), "../../../docs");
const branding = readFileSync(resolve(DOCS, "BRANDING.md"), "utf8");

describe("docs/BRANDING.md", () => {
  it("documents every field with its field name and environment variable", () => {
    for (const k of BRAND_KEYS) {
      expect(branding, `field ${k}`).toContain(`\`${k}\``);
      expect(branding, `env ${envNameFor(k)}`).toContain(
        `\`${envNameFor(k)}\``,
      );
    }
  });

  it("states the real defaults for the visible identity fields", () => {
    expect(branding).toContain(DEFAULT_BRAND.name);
    expect(branding).toContain(DEFAULT_BRAND.badge);
    expect(branding).toContain(DEFAULT_BRAND.themeColor);
    expect(branding).toContain(DEFAULT_BRAND.icon192);
    expect(branding).toContain(DEFAULT_BRAND.ogImage);
  });
});
