import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultShortcuts } from "../defaults";
import {
  clearPrefsCookie,
  PREFS_COOKIE_MAX_AGE_SECONDS,
  PREFS_COOKIE_MAX_LENGTH,
  PREFS_COOKIE_NAME,
  readPrefsCookie,
  serializePrefsCookie,
  writePrefsCookie,
  type PrefsCookieData,
} from "./prefs-cookie";

function prefs(overrides: Partial<PrefsCookieData> = {}): PrefsCookieData {
  return { shortcuts: defaultShortcuts(), lang: "tr", ...overrides };
}

/** Plant a raw cookie value (already encoded) the way a browser would hold it. */
function plantRaw(encodedValue: string): void {
  document.cookie = `${PREFS_COOKIE_NAME}=${encodedValue}; Path=/`;
}

function plantJson(json: unknown): void {
  plantRaw(encodeURIComponent(JSON.stringify(json)));
}

beforeEach(() => {
  clearPrefsCookie();
});

afterEach(() => {
  clearPrefsCookie();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("serializePrefsCookie", () => {
  it("builds a Strict, 365-day, root-path cookie without Secure on http", () => {
    const cookie = serializePrefsCookie(prefs(), false);
    expect(cookie).toBeDefined();
    expect(cookie?.startsWith(`${PREFS_COOKIE_NAME}=`)).toBe(true);
    expect(cookie).toContain(`Max-Age=${PREFS_COOKIE_MAX_AGE_SECONDS}`);
    expect(PREFS_COOKIE_MAX_AGE_SECONDS).toBe(365 * 24 * 60 * 60);
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Secure");
  });

  it("adds Secure on https", () => {
    expect(serializePrefsCookie(prefs(), true)).toContain("; Secure");
  });

  it("stays under 3.5 KB and keeps the value free of cookie-breaking characters", () => {
    const cookie = serializePrefsCookie(prefs(), true) ?? "";
    expect(cookie.length).toBeLessThan(PREFS_COOKIE_MAX_LENGTH);
    expect(PREFS_COOKIE_MAX_LENGTH).toBeLessThanOrEqual(3500);
    const value = cookie.slice(cookie.indexOf("=") + 1, cookie.indexOf(";"));
    expect(value).not.toMatch(/[;,\s"\\]/);
  });

  it("stores ONLY shortcuts and language", () => {
    const cookie = serializePrefsCookie(prefs({ lang: "en" }), false) ?? "";
    const value = cookie.slice(cookie.indexOf("=") + 1, cookie.indexOf(";"));
    const json = JSON.parse(decodeURIComponent(value)) as Record<
      string,
      unknown
    >;
    expect(Object.keys(json).sort()).toEqual(["l", "s", "v"]);
    expect(json["l"]).toBe("en");
    expect(json["s"]).toEqual(defaultShortcuts());
  });

  it("strips extra fields a caller might pass in (e.g. a whole AppSettings)", () => {
    const withExtras = {
      ...prefs(),
      output: { width: 1920, videoBitrate: 12_000_000 },
      secret: "nope",
    };
    const cookie = serializePrefsCookie(withExtras, false) ?? "";
    expect(decodeURIComponent(cookie)).not.toContain("videoBitrate");
    expect(decodeURIComponent(cookie)).not.toContain("secret");
  });

  it("repairs invalid values instead of writing junk", () => {
    const junk = {
      shortcuts: {
        ...defaultShortcuts(),
        "marker.add": "Ctrl+",
        "scene.next": "shift + x",
      },
      lang: "klingon",
    } as unknown as PrefsCookieData;
    const cookie = serializePrefsCookie(junk, false) ?? "";
    const value = cookie.slice(cookie.indexOf("=") + 1, cookie.indexOf(";"));
    const json = JSON.parse(decodeURIComponent(value)) as {
      s: Record<string, string>;
      l: string;
    };
    expect(json.l).toBe("tr");
    expect(json.s["marker.add"]).toBe("m");
    expect(json.s["scene.next"]).toBe("Shift+X");
  });
});

describe("writePrefsCookie / readPrefsCookie", () => {
  it("round-trips shortcuts and language", () => {
    const shortcuts = {
      ...defaultShortcuts(),
      "marker.add": "Ctrl+Alt+K",
      "scene.next": "",
    };
    expect(writePrefsCookie({ shortcuts, lang: "en" })).toBe(true);
    expect(readPrefsCookie()).toEqual({ shortcuts, lang: "en" });
  });

  it("accepts a whole AppSettings object structurally", () => {
    const settings = {
      output: { width: 1 },
      shortcuts: defaultShortcuts(),
      lang: "en" as const,
    };
    expect(writePrefsCookie(settings)).toBe(true);
    expect(readPrefsCookie()?.lang).toBe("en");
    expect(document.cookie).not.toContain("output");
  });

  it("overwrites the previous value", () => {
    writePrefsCookie(prefs({ lang: "tr" }));
    writePrefsCookie(prefs({ lang: "en" }));
    expect(readPrefsCookie()?.lang).toBe("en");
    expect(
      document.cookie.split(";").filter((p) => p.includes(PREFS_COOKIE_NAME)),
    ).toHaveLength(1);
  });

  it("returns undefined when there is no cookie", () => {
    expect(readPrefsCookie()).toBeUndefined();
  });

  it("finds the cookie among others", () => {
    document.cookie = "a=1; Path=/";
    writePrefsCookie(prefs({ lang: "en" }));
    document.cookie = "z=2; Path=/";
    expect(readPrefsCookie()?.lang).toBe("en");
    document.cookie = "a=; Max-Age=0; Path=/";
    document.cookie = "z=; Max-Age=0; Path=/";
  });

  it("ignores cookies whose name merely contains ours", () => {
    document.cookie = `x${PREFS_COOKIE_NAME}=${encodeURIComponent(JSON.stringify({ l: "en" }))}; Path=/`;
    expect(readPrefsCookie()).toBeUndefined();
    document.cookie = `x${PREFS_COOKIE_NAME}=; Max-Age=0; Path=/`;
  });

  it("clearPrefsCookie removes it", () => {
    writePrefsCookie(prefs());
    expect(readPrefsCookie()).toBeDefined();
    clearPrefsCookie();
    expect(readPrefsCookie()).toBeUndefined();
  });

  it("repairs partially invalid content", () => {
    plantJson({
      v: 1,
      s: { "marker.add": "shift + q", "scene.next": 42 },
      l: "fr",
    });
    const read = readPrefsCookie();
    expect(read?.lang).toBe("tr");
    expect(read?.shortcuts["marker.add"]).toBe("Shift+Q");
    expect(read?.shortcuts["scene.next"]).toBe("]");
    expect(read?.shortcuts["record.toggle"]).toBe("Shift+R");
  });

  it("treats an empty object as 'all defaults' rather than as corrupt", () => {
    plantJson({});
    expect(readPrefsCookie()).toEqual({
      shortcuts: defaultShortcuts(),
      lang: "tr",
    });
  });

  it.each([
    ["broken percent-encoding", "%E0%A4%A"],
    ["not JSON", encodeURIComponent("hello world")],
    ["a JSON array", encodeURIComponent("[1,2,3]")],
    ["a JSON string", encodeURIComponent('"hi"')],
    ["JSON null", encodeURIComponent("null")],
    ["an empty value", ""],
  ])("returns undefined for %s", (_label, raw) => {
    plantRaw(raw);
    expect(readPrefsCookie()).toBeUndefined();
  });

  it("ignores oversized values without decoding them", () => {
    plantRaw("a".repeat(9000));
    expect(readPrefsCookie()).toBeUndefined();
  });

  it("does not choke on prototype-pollution style payloads", () => {
    plantRaw(
      encodeURIComponent(
        '{"__proto__":{"polluted":true},"s":{"__proto__":{"x":1}},"l":"en"}',
      ),
    );
    const read = readPrefsCookie();
    expect(read?.lang).toBe("en");
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.keys(read?.shortcuts ?? {}).sort()).toEqual(
      Object.keys(defaultShortcuts()).sort(),
    );
  });

  it("returns undefined when reading document.cookie throws", () => {
    vi.spyOn(document, "cookie", "get").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(readPrefsCookie()).toBeUndefined();
  });

  it("returns false when writing document.cookie throws", () => {
    vi.spyOn(document, "cookie", "set").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(writePrefsCookie(prefs())).toBe(false);
    expect(() => clearPrefsCookie()).not.toThrow();
  });

  it("marks the cookie Secure when the page is served over https", () => {
    const written: string[] = [];
    vi.spyOn(document, "cookie", "set").mockImplementation((value: string) => {
      written.push(value);
    });
    vi.stubGlobal("location", { protocol: "https:" });
    expect(writePrefsCookie(prefs())).toBe(true);
    expect(written).toHaveLength(1);
    expect(written[0]).toContain("; Secure");
    expect(written[0]).toContain("SameSite=Strict");
  });

  it("does not mark the cookie Secure over plain http", () => {
    const written: string[] = [];
    vi.spyOn(document, "cookie", "set").mockImplementation((value: string) => {
      written.push(value);
    });
    vi.stubGlobal("location", { protocol: "http:" });
    expect(writePrefsCookie(prefs())).toBe(true);
    expect(written[0]).not.toContain("Secure");
  });
});
