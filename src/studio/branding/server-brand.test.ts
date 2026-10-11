import { afterEach, describe, expect, it, vi } from "vitest";

import { serverBrand } from "./server-brand";

afterEach(() => vi.restoreAllMocks());

describe("serverBrand", () => {
  it("layers the environment over the defaults", () => {
    const b = serverBrand({ BRAND_NAME: "Acme", BRAND_ACCENT: "#ff8800" });
    expect(b.name).toBe("Acme");
    expect(b.accent).toBe("#ff8800");
    expect(b.badge).toBe("Erken erişim");
  });

  it("warns once about invalid values and still returns a usable brand", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const b = serverBrand({ BRAND_ACCENT: "nope", BRAND_JSON: "{oops" });
    expect(b.accent).toBe("");
    expect(b.name).toBe("Teknodoz Studio");
    serverBrand({ BRAND_ACCENT: "nope" });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
