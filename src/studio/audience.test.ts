// src/studio/audience.test.ts
import { beforeEach, describe, expect, it } from "vitest";

import { getAudience, parseAudience, setAudience } from "./audience";

describe("audience", () => {
  beforeEach(() => localStorage.clear());

  it("parses only known values", () => {
    expect(parseAudience("viewer")).toBe("viewer");
    expect(parseAudience("creator")).toBe("creator");
    expect(parseAudience("admin")).toBeNull();
    expect(parseAudience(null)).toBeNull();
  });

  it("persists the choice", () => {
    expect(getAudience()).toBeNull();
    setAudience("viewer");
    expect(getAudience()).toBe("viewer");
    setAudience("creator");
    expect(localStorage.getItem("studio.audience.v1")).toBe("creator");
  });
});
