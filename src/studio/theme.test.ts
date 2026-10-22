// src/studio/theme.test.ts
import { beforeEach, describe, expect, it } from "vitest";

import { getTheme, parseTheme, resolveTheme, setTheme } from "./theme";

describe("theme", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset["theme"];
  });

  it("parses unknown values as system", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("purple")).toBe("system");
    expect(parseTheme(null)).toBe("system");
  });

  it("resolves system from the OS preference", () => {
    expect(resolveTheme("system", true)).toBe("light");
    expect(resolveTheme("system", false)).toBe("dark");
    expect(resolveTheme("dark", true)).toBe("dark");
  });

  it("persists the choice and sets data-theme", () => {
    setTheme("light");
    expect(getTheme()).toBe("light");
    expect(document.documentElement.dataset["theme"]).toBe("light");
    setTheme("system");
    expect(localStorage.getItem("studio.theme.v1")).toBeNull();
  });
});
