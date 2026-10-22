import { act, renderHook } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, defaultShortcuts } from "../defaults";
import type { AppSettings } from "../types";
import {
  clearPrefsCookie,
  getServerSettingsSnapshot,
  getSettingsSnapshot,
  loadSettings,
  OUTPUT_LIMITS,
  parseSettings,
  PREFS_COOKIE_NAME,
  readPrefsCookie,
  reloadSettings,
  resetSettings,
  saveSettings,
  SETTINGS_STORAGE_KEY,
  subscribeSettings,
} from "./settings";

function store(raw: unknown): void {
  localStorage.setItem(
    SETTINGS_STORAGE_KEY,
    typeof raw === "string" ? raw : JSON.stringify(raw),
  );
}

function stored(): Record<string, unknown> {
  return JSON.parse(
    localStorage.getItem(SETTINGS_STORAGE_KEY) ?? "null",
  ) as Record<string, unknown>;
}

function withOutput(patch: Record<string, unknown>): unknown {
  return { output: patch };
}

beforeEach(() => {
  localStorage.clear();
  clearPrefsCookie();
  resetSettings();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  clearPrefsCookie();
});

describe("loadSettings", () => {
  it("returns the defaults when nothing is stored", () => {
    expect(loadSettings()).toEqual(defaultSettings());
  });

  it("returns a fresh object each time", () => {
    const a = loadSettings();
    a.output.width = 640;
    a.shortcuts["marker.add"] = "z";
    expect(loadSettings()).toEqual(defaultSettings());
    expect(loadSettings()).not.toBe(loadSettings());
  });

  it("round-trips a complete settings object", () => {
    const custom: AppSettings = {
      output: {
        width: 1280,
        height: 720,
        fps: 30,
        videoBitrate: 6_000_000,
        audioBitrate: 128_000,
        container: "webm",
        usePublicStun: false,
      },
      shortcuts: { ...defaultShortcuts(), "marker.add": "Ctrl+Alt+K" },
      lang: "en",
    };
    store(custom);
    expect(loadSettings()).toEqual(custom);
  });

  it("merges a partial object over the defaults (new fields get defaults)", () => {
    store({ lang: "en" });
    expect(loadSettings()).toEqual({ ...defaultSettings(), lang: "en" });

    store(withOutput({ fps: 30 }));
    const loaded = loadSettings();
    expect(loaded.output.fps).toBe(30);
    expect(loaded.output.width).toBe(1920);
    expect(loaded.output.usePublicStun).toBe(true);
    expect(loaded.shortcuts).toEqual(defaultShortcuts());

    store({ shortcuts: { "marker.add": "q" } });
    expect(loadSettings().shortcuts).toEqual({
      ...defaultShortcuts(),
      "marker.add": "q",
    });
  });

  it("drops unknown fields", () => {
    store({
      foo: 1,
      output: { extra: true, fps: 24 },
      shortcuts: { "nope.action": "x" },
    });
    const loaded = loadSettings() as unknown as Record<string, unknown>;
    expect(Object.keys(loaded).sort()).toEqual(["lang", "output", "shortcuts"]);
    expect(Object.keys(loaded["output"] as object).sort()).toEqual(
      Object.keys(defaultSettings().output).sort(),
    );
    expect(Object.keys(loaded["shortcuts"] as object).sort()).toEqual(
      Object.keys(defaultShortcuts()).sort(),
    );
  });

  it("repairs invalid values field by field without discarding the rest", () => {
    store({
      lang: "fr",
      output: {
        width: "abc",
        height: 720,
        fps: null,
        videoBitrate: {},
        audioBitrate: [],
        container: "gif",
        usePublicStun: "yes",
      },
      shortcuts: {
        "record.toggle": 5,
        "marker.add": "Ctrl+",
        "prompter.toggle": "shift + q",
        "prompter.speedUp": "",
        "scene.next": null,
      },
    });
    const loaded = loadSettings();
    const defaults = defaultSettings();
    expect(loaded.lang).toBe("tr");
    expect(loaded.output.width).toBe(defaults.output.width);
    expect(loaded.output.height).toBe(720);
    expect(loaded.output.fps).toBe(defaults.output.fps);
    expect(loaded.output.videoBitrate).toBe(defaults.output.videoBitrate);
    expect(loaded.output.audioBitrate).toBe(defaults.output.audioBitrate);
    expect(loaded.output.container).toBe("auto");
    expect(loaded.output.usePublicStun).toBe(true);
    expect(loaded.shortcuts["record.toggle"]).toBe("Shift+R");
    expect(loaded.shortcuts["marker.add"]).toBe("m");
    expect(loaded.shortcuts["prompter.toggle"]).toBe("Shift+Q");
    expect(loaded.shortcuts["prompter.speedUp"]).toBe("");
    expect(loaded.shortcuts["scene.next"]).toBe("]");
  });

  it.each([
    ["syntactically invalid JSON", "{not json"],
    ["a JSON array", "[1,2]"],
    ["JSON null", "null"],
    ["a JSON number", "42"],
    ["a JSON string", '"hi"'],
    ["an empty string", ""],
    [
      "an oversized blob",
      JSON.stringify({ lang: "en", pad: "x".repeat(70_000) }),
    ],
  ])("falls back to defaults for %s", (_label, raw) => {
    store(raw);
    expect(loadSettings()).toEqual(defaultSettings());
  });

  it("does not let __proto__ keys leak into the result", () => {
    store(
      '{"__proto__":{"polluted":1},"output":{"__proto__":{"polluted":2},"fps":30}}',
    );
    const loaded = loadSettings();
    expect(loaded.output.fps).toBe(30);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(
      (loaded.output as unknown as Record<string, unknown>)["polluted"],
    ).toBeUndefined();
  });
});

describe("clamping", () => {
  const cases: Array<
    [string, Record<string, unknown>, Record<string, number>]
  > = [
    ["width too large", { width: 100_000 }, { width: OUTPUT_LIMITS.width.max }],
    ["width too small", { width: 10 }, { width: OUTPUT_LIMITS.width.min }],
    ["negative width", { width: -1920 }, { width: OUTPUT_LIMITS.width.min }],
    ["odd width snaps to even", { width: 1921 }, { width: 1922 }],
    ["fractional width rounds", { width: 1280.4 }, { width: 1280 }],
    [
      "height too large",
      { height: 5000 },
      { height: OUTPUT_LIMITS.height.max },
    ],
    ["height too small", { height: 0 }, { height: OUTPUT_LIMITS.height.min }],
    ["odd height snaps to even", { height: 721 }, { height: 722 }],
    ["fps too high", { fps: 1000 }, { fps: OUTPUT_LIMITS.fps.max }],
    ["fps zero", { fps: 0 }, { fps: OUTPUT_LIMITS.fps.min }],
    ["fractional fps rounds", { fps: 29.7 }, { fps: 30 }],
    [
      "video bitrate too small",
      { videoBitrate: 1 },
      { videoBitrate: OUTPUT_LIMITS.videoBitrate.min },
    ],
    [
      "video bitrate too large",
      { videoBitrate: 1e12 },
      { videoBitrate: OUTPUT_LIMITS.videoBitrate.max },
    ],
    [
      "audio bitrate too small",
      { audioBitrate: 1 },
      { audioBitrate: OUTPUT_LIMITS.audioBitrate.min },
    ],
    [
      "audio bitrate too large",
      { audioBitrate: 9e9 },
      { audioBitrate: OUTPUT_LIMITS.audioBitrate.max },
    ],
    [
      "numeric strings are accepted",
      { fps: "30", width: " 1280 " },
      { fps: 30, width: 1280 },
    ],
    [
      "in-range values pass through",
      { width: 3840, height: 2160, fps: 60 },
      { width: 3840, height: 2160, fps: 60 },
    ],
    ["exact limits survive", { fps: 5, width: 7680 }, { fps: 5, width: 7680 }],
  ];

  it.each(cases)("%s", (_label, input, expected) => {
    store(withOutput(input));
    const output = loadSettings().output as unknown as Record<string, number>;
    for (const [key, value] of Object.entries(expected))
      expect(output[key]).toBe(value);
  });

  it("falls back to defaults for non-finite and non-numeric numbers", () => {
    const defaults = defaultSettings().output;
    const parsed = parseSettings({
      output: {
        width: Number.POSITIVE_INFINITY,
        height: Number.NaN,
        fps: "fast",
        videoBitrate: "",
        audioBitrate: "1e999",
      },
    });
    expect(parsed.output.width).toBe(defaults.width);
    expect(parsed.output.height).toBe(defaults.height);
    expect(parsed.output.fps).toBe(defaults.fps);
    expect(parsed.output.videoBitrate).toBe(defaults.videoBitrate);
    expect(parsed.output.audioBitrate).toBe(defaults.audioBitrate);
  });

  it("always yields even, in-range dimensions", () => {
    for (const w of [-5, 0, 319, 321, 1919, 1921, 7681, 99_999]) {
      const width = parseSettings(withOutput({ width: w })).output.width;
      expect(width % 2).toBe(0);
      expect(width).toBeGreaterThanOrEqual(OUTPUT_LIMITS.width.min);
      expect(width).toBeLessThanOrEqual(OUTPUT_LIMITS.width.max);
    }
  });
});

describe("documented output ranges (literal values, not derived from the constants)", () => {
  it("pins the limits", () => {
    expect(OUTPUT_LIMITS).toEqual({
      width: { min: 320, max: 7680 },
      height: { min: 240, max: 4320 },
      fps: { min: 5, max: 120 },
      videoBitrate: { min: 250_000, max: 100_000_000 },
      audioBitrate: { min: 32_000, max: 512_000 },
    });
  });

  it("clamps absurdly high values to the upper bounds", () => {
    const high = parseSettings({
      output: {
        width: 1e9,
        height: 1e9,
        fps: 1e9,
        videoBitrate: 1e15,
        audioBitrate: 1e15,
      },
    }).output;
    expect(high).toMatchObject({
      width: 7680,
      height: 4320,
      fps: 120,
      videoBitrate: 100_000_000,
      audioBitrate: 512_000,
    });
  });

  it("clamps absurdly low values to the lower bounds", () => {
    const low = parseSettings({
      output: {
        width: -1e9,
        height: -1e9,
        fps: -1e9,
        videoBitrate: -1e15,
        audioBitrate: -1e15,
      },
    }).output;
    expect(low).toMatchObject({
      width: 320,
      height: 240,
      fps: 5,
      videoBitrate: 250_000,
      audioBitrate: 32_000,
    });
  });

  it("keeps the standard presets untouched", () => {
    for (const [width, height, fps] of [
      [1920, 1080, 60],
      [1920, 1080, 30],
      [1280, 720, 60],
      [3840, 2160, 30],
      [854, 480, 24],
    ] as const) {
      expect(
        parseSettings({ output: { width, height, fps } }).output,
      ).toMatchObject({
        width,
        height,
        fps,
      });
    }
  });
});

describe("parseSettings", () => {
  it("never throws and always returns complete settings", () => {
    for (const junk of [
      undefined,
      null,
      0,
      "x",
      [],
      [[]],
      true,
      () => 1,
      Symbol("s"),
    ]) {
      expect(parseSettings(junk)).toEqual(defaultSettings());
    }
  });
});

describe("saveSettings", () => {
  it("persists to localStorage and returns the stored settings", () => {
    const next = { ...defaultSettings(), lang: "en" as const };
    const result = saveSettings(next);
    expect(result).toEqual(next);
    expect(stored()).toEqual(next);
    expect(loadSettings()).toEqual(next);
  });

  it("repairs and clamps what it stores", () => {
    const bad = defaultSettings();
    bad.output.width = 99_999;
    bad.output.fps = 0;
    bad.shortcuts["marker.add"] = "shift + z";
    const result = saveSettings(bad);
    expect(result.output.width).toBe(OUTPUT_LIMITS.width.max);
    expect(result.output.fps).toBe(OUTPUT_LIMITS.fps.min);
    expect(result.shortcuts["marker.add"]).toBe("Shift+Z");
    expect((stored()["output"] as { width: number }).width).toBe(
      OUTPUT_LIMITS.width.max,
    );
  });

  it("survives garbage input", () => {
    expect(() => saveSettings(null as unknown as AppSettings)).not.toThrow();
    expect(saveSettings("nope" as unknown as AppSettings)).toEqual(
      defaultSettings(),
    );
  });

  it("does not keep a reference to the caller's object", () => {
    const next = defaultSettings();
    saveSettings(next);
    next.output.width = 640;
    next.shortcuts["marker.add"] = "z";
    expect(getSettingsSnapshot()).toEqual(defaultSettings());
    expect(loadSettings()).toEqual(defaultSettings());
  });

  it("mirrors ONLY shortcuts and language to the cookie", () => {
    const next: AppSettings = {
      ...defaultSettings(),
      lang: "en",
      shortcuts: { ...defaultShortcuts(), "marker.add": "Ctrl+Alt+K" },
    };
    next.output.videoBitrate = 8_000_000;
    saveSettings(next);

    expect(readPrefsCookie()).toEqual({
      shortcuts: next.shortcuts,
      lang: "en",
    });
    const raw = document.cookie;
    expect(raw).toContain(`${PREFS_COOKIE_NAME}=`);
    expect(raw.length).toBeLessThan(3500);
    const decoded = decodeURIComponent(raw);
    for (const forbidden of [
      "width",
      "height",
      "fps",
      "videoBitrate",
      "audioBitrate",
      "container",
      "STUN",
    ]) {
      expect(decoded).not.toContain(forbidden);
    }
  });

  it("still saves to the cookie and the snapshot when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    const next = { ...defaultSettings(), lang: "en" as const };
    expect(() => saveSettings(next)).not.toThrow();
    expect(getSettingsSnapshot().lang).toBe("en");
    expect(readPrefsCookie()?.lang).toBe("en");
  });

  it("still works when the localStorage getter itself throws", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    const next = { ...defaultSettings(), lang: "en" as const };
    expect(() => saveSettings(next)).not.toThrow();
    expect(() => loadSettings()).not.toThrow();
    expect(() => resetSettings()).not.toThrow();
    expect(getSettingsSnapshot()).toBeDefined();
  });
});

describe("cookie fallback", () => {
  it("is used when localStorage is empty", () => {
    const custom: AppSettings = {
      ...defaultSettings(),
      lang: "en",
      shortcuts: {
        ...defaultShortcuts(),
        "marker.add": "Ctrl+Alt+K",
        "scene.next": "n",
      },
    };
    saveSettings(custom);
    localStorage.clear();
    const loaded = loadSettings();
    expect(loaded.lang).toBe("en");
    expect(loaded.shortcuts).toEqual(custom.shortcuts);
    expect(loaded.output).toEqual(defaultSettings().output);
  });

  it("is used when localStorage is blocked", () => {
    const custom: AppSettings = { ...defaultSettings(), lang: "en" };
    custom.shortcuts = { ...defaultShortcuts(), "record.toggle": "F9" };
    saveSettings(custom);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    const loaded = loadSettings();
    expect(loaded.lang).toBe("en");
    expect(loaded.shortcuts["record.toggle"]).toBe("F9");
  });

  it("is used when the localStorage getter throws", () => {
    saveSettings({ ...defaultSettings(), lang: "en" });
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(loadSettings().lang).toBe("en");
  });

  it("is ignored when localStorage has data", () => {
    saveSettings({ ...defaultSettings(), lang: "en" });
    store({ lang: "tr" });
    expect(loadSettings().lang).toBe("tr");
  });

  it("is ignored when the cookie is corrupt", () => {
    document.cookie = `${PREFS_COOKIE_NAME}=%E0%A4%A; Path=/`;
    expect(loadSettings()).toEqual(defaultSettings());
  });
});

describe("resetSettings", () => {
  it("clears localStorage and the cookie and returns the defaults", () => {
    saveSettings({ ...defaultSettings(), lang: "en" });
    const result = resetSettings();
    expect(result).toEqual(defaultSettings());
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBeNull();
    expect(readPrefsCookie()).toBeUndefined();
    expect(loadSettings()).toEqual(defaultSettings());
    expect(getSettingsSnapshot()).toEqual(defaultSettings());
  });

  it("notifies subscribers only when something changed", () => {
    saveSettings({ ...defaultSettings(), lang: "en" });
    const cb = vi.fn();
    const unsubscribe = subscribeSettings(cb);
    resetSettings();
    expect(cb).toHaveBeenCalledTimes(1);
    resetSettings();
    expect(cb).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});

describe("external store (useSyncExternalStore contract)", () => {
  it("returns a referentially stable snapshot until the settings change", () => {
    const a = getSettingsSnapshot();
    expect(getSettingsSnapshot()).toBe(a);
    expect(getSettingsSnapshot()).toBe(a);
    saveSettings({ ...defaultSettings(), lang: "en" });
    const b = getSettingsSnapshot();
    expect(b).not.toBe(a);
    expect(b.lang).toBe("en");
    expect(getSettingsSnapshot()).toBe(b);
  });

  it("keeps identity and does not notify when the saved content is identical", () => {
    saveSettings({ ...defaultSettings(), lang: "en" });
    const before = getSettingsSnapshot();
    const cb = vi.fn();
    const unsubscribe = subscribeSettings(cb);
    saveSettings({ ...defaultSettings(), lang: "en" });
    expect(getSettingsSnapshot()).toBe(before);
    expect(cb).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("hands out a deeply frozen snapshot", () => {
    const snap = getSettingsSnapshot();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.output)).toBe(true);
    expect(Object.isFrozen(snap.shortcuts)).toBe(true);
    expect(() => {
      (snap.output as { width: number }).width = 1;
    }).toThrow(TypeError);
  });

  it("notifies subscribers on save and stops after unsubscribe (idempotent)", () => {
    const cb = vi.fn();
    const unsubscribe = subscribeSettings(cb);
    saveSettings({ ...defaultSettings(), lang: "en" });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(getSettingsSnapshot().lang).toBe("en");
    unsubscribe();
    unsubscribe();
    saveSettings({ ...defaultSettings(), lang: "tr" });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("treats the same callback subscribed twice as two subscriptions", () => {
    const cb = vi.fn();
    const first = subscribeSettings(cb);
    const second = subscribeSettings(cb);
    saveSettings({ ...defaultSettings(), lang: "en" });
    expect(cb).toHaveBeenCalledTimes(2);
    first();
    saveSettings({ ...defaultSettings(), lang: "tr" });
    expect(cb).toHaveBeenCalledTimes(3);
    second();
  });

  it("isolates a throwing subscriber from the others", () => {
    const bad = vi.fn(() => {
      throw new Error("boom");
    });
    const good = vi.fn();
    const u1 = subscribeSettings(bad);
    const u2 = subscribeSettings(good);
    expect(() =>
      saveSettings({ ...defaultSettings(), lang: "en" }),
    ).not.toThrow();
    expect(bad).toHaveBeenCalled();
    expect(good).toHaveBeenCalled();
    u1();
    u2();
  });

  it("reloads when another tab changes localStorage (storage event)", () => {
    const cb = vi.fn();
    const unsubscribe = subscribeSettings(cb);
    store({ lang: "en" });
    window.dispatchEvent(
      new StorageEvent("storage", { key: SETTINGS_STORAGE_KEY }),
    );
    expect(getSettingsSnapshot().lang).toBe("en");
    expect(cb).toHaveBeenCalledTimes(1);

    // Unrelated keys are ignored.
    store({ lang: "tr" });
    window.dispatchEvent(
      new StorageEvent("storage", { key: "something-else" }),
    );
    expect(getSettingsSnapshot().lang).toBe("en");
    expect(cb).toHaveBeenCalledTimes(1);

    // key === null means localStorage.clear() elsewhere.
    localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(getSettingsSnapshot()).toEqual(defaultSettings());
    expect(cb).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("stops listening for storage events once the last subscriber leaves", () => {
    const unsubscribe = subscribeSettings(() => {});
    unsubscribe();
    store({ lang: "en" });
    window.dispatchEvent(
      new StorageEvent("storage", { key: SETTINGS_STORAGE_KEY }),
    );
    expect(getSettingsSnapshot().lang).toBe("tr");
  });

  it("reloadSettings picks up external edits and returns the snapshot", () => {
    store({ lang: "en" });
    const snap = reloadSettings();
    expect(snap.lang).toBe("en");
    expect(snap).toBe(getSettingsSnapshot());
  });

  it("serves the defaults on the server, with a stable identity", () => {
    const server = getServerSettingsSnapshot();
    expect(server).toEqual(defaultSettings());
    expect(getServerSettingsSnapshot()).toBe(server);
    saveSettings({ ...defaultSettings(), lang: "en" });
    expect(getServerSettingsSnapshot()).toBe(server);
    expect(getServerSettingsSnapshot().lang).toBe("tr");
  });

  it("drives React's useSyncExternalStore without tearing or loops", () => {
    const { result } = renderHook(() =>
      useSyncExternalStore(
        subscribeSettings,
        getSettingsSnapshot,
        getServerSettingsSnapshot,
      ),
    );
    expect(result.current.lang).toBe("tr");
    const first = result.current;
    act(() => {
      saveSettings({ ...defaultSettings(), lang: "en" });
    });
    expect(result.current.lang).toBe("en");
    expect(result.current).not.toBe(first);
    const second = result.current;
    act(() => {
      saveSettings({ ...defaultSettings(), lang: "en" });
    });
    expect(result.current).toBe(second);
    act(() => {
      resetSettings();
    });
    expect(result.current.lang).toBe("tr");
  });
});

describe("supported languages", () => {
  it("accepts tr, en, de and es", () => {
    for (const lang of ["tr", "en", "de", "es"] as const)
      expect(parseSettings({ lang }).lang).toBe(lang);
  });
});
