import { describe, expect, it } from "vitest";

import {
  BRAND_KEYS,
  DEFAULT_BRAND,
  LOCAL_KEYS,
  brandFromEnv,
  brandJsonProblem,
  contrastRatio,
  envNameFor,
  isAssetUrl,
  normalizeHex,
  normalizeOrigin,
  parseBrandPatch,
  readableOn,
  resolveBrand,
} from "./brand";
import {
  absoluteUrl,
  brandCss,
  brandHeadLinks,
  canonicalUrl,
  brandHeadMeta,
  manifestFor,
  mimeOf,
  pageTitle,
  themeVars,
  titleFromMatches,
} from "./head";
import { applyThemeToDom, loadLocalBrand, saveLocalBrand } from "./local";

const parse = (patch: Record<string, unknown>, opts = {}) =>
  parseBrandPatch(patch, opts);

describe("validation", () => {
  it("the shipped defaults are themselves valid", () => {
    const r = parse({ ...DEFAULT_BRAND });
    expect(r.rejected).toEqual([]);
    expect(Object.keys(r.patch).sort()).toEqual([...BRAND_KEYS].sort());
    expect(r.patch.name).toBe(DEFAULT_BRAND.name);
  });

  it("normalises colors and refuses garbage", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex(" #12AbEf ")).toBe("#12abef");
    expect(normalizeHex("red")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
    expect(parse({ accent: "#F80" }).patch.accent).toBe("#ff8800");
    expect(parse({ accent: "" }).patch.accent).toBe("");
    expect(parse({ accent: "red;}body{display:none" }).rejected).toEqual([
      "accent",
    ]);
    expect(parse({ themeColor: "" }).rejected).toEqual(["themeColor"]); // required
  });

  it("cleans and bounds text", () => {
    expect(parse({ name: "  Acme \n Studio\u0000 " }).patch.name).toBe(
      "Acme Studio",
    );
    expect(parse({ name: "x".repeat(61) }).rejected).toEqual(["name"]);
    expect(parse({ name: "  " }).rejected).toEqual(["name"]);
    expect(parse({ badge: "" }).patch.badge).toBe("");
    expect(parse({ slogan: "y".repeat(81) }).rejected).toEqual(["slogan"]);
    expect(parse({ name: 5 }).rejected).toEqual(["name"]);
  });

  it("accepts only same-origin paths and https asset URLs", () => {
    for (const ok of [
      "",
      "/icons/a.png",
      "/brand/logo.svg",
      "https://cdn.example/x.png",
    ])
      expect(isAssetUrl(ok), ok).toBe(true);
    for (const bad of [
      "//evil.example/x.png",
      "/../x.png",
      "/a/../b.png",
      "http://x.example/a.png",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "https://u:p@x.example/a.png",
      "icons/a.png",
      `/${"a".repeat(300)}`,
    ])
      expect(isAssetUrl(bad), bad).toBe(false);
    expect(isAssetUrl("data:image/png;base64,AAAA", true)).toBe(true);
    expect(isAssetUrl("data:text/html;base64,AAAA", true)).toBe(false);
    expect(parse({ logoUrl: "data:image/png;base64,AAAA" }).rejected).toEqual([
      "logoUrl",
    ]);
    expect(
      parse({ logoUrl: "data:image/png;base64,AAAA" }, { allowData: true })
        .patch.logoUrl,
    ).toBe("data:image/png;base64,AAAA");
  });

  it("normalises the site origin, handle, language and robots", () => {
    expect(normalizeOrigin("https://Studio.Example.org/path?x=1#h")).toBe(
      "https://studio.example.org",
    );
    expect(normalizeOrigin("")).toBe("");
    expect(normalizeOrigin("ftp://x")).toBeNull();
    expect(normalizeOrigin("javascript:alert(1)")).toBeNull();
    expect(parse({ siteUrl: "https://a.example/" }).patch.siteUrl).toBe(
      "https://a.example",
    );
    expect(parse({ siteUrl: "nope" }).rejected).toEqual(["siteUrl"]);
    expect(parse({ twitterHandle: "acme" }).patch.twitterHandle).toBe("@acme");
    expect(parse({ twitterHandle: "" }).patch.twitterHandle).toBe("");
    expect(parse({ twitterHandle: "@bad handle" }).rejected).toEqual([
      "twitterHandle",
    ]);
    expect(parse({ lang: "en" }).patch.lang).toBe("en");
    expect(parse({ lang: "EN_us" }).rejected).toEqual(["lang"]);
    expect(parse({ locale: "en_US" }).patch.locale).toBe("en_US");
    expect(parse({ locale: "english" }).rejected).toEqual(["locale"]);
    expect(parse({ robots: "noindex,nofollow" }).patch.robots).toBe(
      "noindex,nofollow",
    );
    expect(parse({ robots: "all" }).rejected).toEqual(["robots"]);
  });

  it("bounds the numeric theme knobs and ignores unknown keys / bad shapes", () => {
    expect(parse({ radius: 0.2, uiScale: 1.1 }).rejected).toEqual([]);
    expect(parse({ radius: 2 }).rejected).toEqual(["radius"]);
    expect(parse({ uiScale: 0.5 }).rejected).toEqual(["uiScale"]);
    expect(parse({ radius: Number.NaN }).rejected).toEqual(["radius"]);
    expect(parse({ evil: "x", __proto__: { name: "x" } }).patch).toEqual({});
    expect(parseBrandPatch(null).patch).toEqual({});
    expect(parseBrandPatch([1, 2]).patch).toEqual({});
    expect(parseBrandPatch("x").patch).toEqual({});
  });

  it("keeps valid keys when others are rejected", () => {
    const r = parse({ name: "Acme", accent: "nope", badge: "Beta" });
    expect(r.patch).toEqual({ name: "Acme", badge: "Beta" });
    expect(r.rejected).toEqual(["accent"]);
  });

  it("local overrides are a safe subset", () => {
    expect(LOCAL_KEYS).not.toContain("description");
    expect(LOCAL_KEYS).not.toContain("siteUrl");
    expect(LOCAL_KEYS).not.toContain("ogImage");
    expect(
      parseBrandPatch(
        { name: "A", siteUrl: "https://a.example" },
        { only: LOCAL_KEYS },
      ).patch,
    ).toEqual({ name: "A" });
  });
});

describe("layers and environment", () => {
  it("later layers win and nothing leaks into the defaults", () => {
    const b = resolveBrand({ name: "File" }, { name: "Env", badge: "" });
    expect(b.name).toBe("Env");
    expect(b.badge).toBe("");
    expect(DEFAULT_BRAND.name).toBe("Teknodoz Studio");
    expect(() => {
      (DEFAULT_BRAND as { name: string }).name = "x";
    }).toThrow();
  });

  it("maps field names to BRAND_* variables", () => {
    expect(envNameFor("name")).toBe("BRAND_NAME");
    expect(envNameFor("shortName")).toBe("BRAND_SHORT_NAME");
    expect(envNameFor("siteUrl")).toBe("BRAND_SITE_URL");
    expect(envNameFor("twitterHandle")).toBe("BRAND_TWITTER_HANDLE");
    expect(envNameFor("uiScale")).toBe("BRAND_UI_SCALE");
    expect(envNameFor("icon192")).toBe("BRAND_ICON192");
    expect(envNameFor("accent2")).toBe("BRAND_ACCENT2");
    expect(envNameFor("maskableIcon")).toBe("BRAND_MASKABLE_ICON");
    expect(envNameFor("appleTouchIcon")).toBe("BRAND_APPLE_TOUCH_ICON");
    expect(envNameFor("ogImage")).toBe("BRAND_OG_IMAGE");
    const names = BRAND_KEYS.map(envNameFor);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((n) => /^BRAND_[A-Z0-9_]+$/.test(n))).toBe(true);
  });

  it("reads BRAND_JSON and single variables, singles win, bad values are reported", () => {
    const r = brandFromEnv({
      BRAND_JSON: '{"name":"From JSON","badge":"Beta","accent":"#123456"}',
      BRAND_NAME: "From var",
      BRAND_RADIUS: "0.5",
      BRAND_UI_SCALE: "9",
      BRAND_ACCENT2: undefined,
    });
    expect(r.patch).toMatchObject({
      name: "From var",
      badge: "Beta",
      accent: "#123456",
      radius: 0.5,
    });
    expect(r.rejected).toEqual(["uiScale"]);
    expect(brandFromEnv({ BRAND_JSON: "{not json" }).patch).toEqual({});
    expect(brandFromEnv({ BRAND_JSON: "[1]" }).patch).toEqual({});
    expect(brandFromEnv({}).patch).toEqual({});
  });

  it("flags an unreadable BRAND_JSON", () => {
    expect(brandJsonProblem({})).toBe(false);
    expect(brandJsonProblem({ BRAND_JSON: '{"name":"A"}' })).toBe(false);
    expect(brandJsonProblem({ BRAND_JSON: "{oops" })).toBe(true);
    expect(brandJsonProblem({ BRAND_JSON: "[1]" })).toBe(true);
    expect(brandJsonProblem({ BRAND_JSON: "5" })).toBe(true);
  });
});

describe("colors", () => {
  it("computes WCAG contrast and a readable text color", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
    expect(contrastRatio("nope", "#fff")).toBe(1);
    expect(readableOn("#ffffff")).toBe("#111111");
    expect(readableOn("#102040")).toBe("#ffffff");
  });
});

describe("head, theme and manifest", () => {
  const brand = resolveBrand({
    siteUrl: "https://a.example",
    twitterHandle: "@acme",
    slogan: "Sahneyi kur",
  });

  it("builds share metadata with absolute image URLs", () => {
    const meta = brandHeadMeta(brand);
    const find = (k: string, v: string) =>
      meta.find((m) => m[k] === v)?.["content"];
    expect(find("property", "og:image")).toBe("https://a.example/og-image.png");
    expect(find("property", "og:url")).toBe("https://a.example");
    const page = (path: string) =>
      brandHeadMeta(brand, path).find((m) => m["property"] === "og:url")?.[
        "content"
      ];
    expect(page("/download")).toBe("https://a.example/download");
    expect(page("/")).toBe("https://a.example");
    expect(page("/r/ABC123")).toBeUndefined();
    expect(canonicalUrl(DEFAULT_BRAND, "/studio")).toBeNull();
    expect(find("name", "twitter:site")).toBe("@acme");
    expect(find("name", "twitter:card")).toBe("summary_large_image");
    expect(find("property", "og:title")).toBe("Teknodoz Studio — Sahneyi kur");
    expect(meta[0]?.["title"]).toBe("Teknodoz Studio — Sahneyi kur");
    expect(meta.every((m) => !("content" in m) || m["content"] !== "")).toBe(
      true,
    );
  });

  it("falls back to relative image URLs without a site URL and drops empty tags", () => {
    const meta = brandHeadMeta(
      resolveBrand({ twitterHandle: "", ogImage: "" }),
    );
    expect(meta.some((m) => m["name"] === "twitter:site")).toBe(false);
    expect(meta.some((m) => m["property"] === "og:image")).toBe(false);
    expect(meta.find((m) => m["name"] === "twitter:card")?.["content"]).toBe(
      "summary",
    );
    expect(absoluteUrl(DEFAULT_BRAND, "/x.png")).toBe("/x.png");
    expect(absoluteUrl(brand, "https://cdn.example/x.png")).toBe(
      "https://cdn.example/x.png",
    );
  });

  it("links the manifest, icons and a canonical URL", () => {
    const links = brandHeadLinks(brand, "/studio");
    expect(links.find((l) => l["rel"] === "manifest")?.["href"]).toBe(
      "/manifest.webmanifest",
    );
    expect(links.find((l) => l["rel"] === "icon")).toMatchObject({
      href: "/favicon.ico",
      type: "image/x-icon",
    });
    expect(links.find((l) => l["rel"] === "canonical")?.["href"]).toBe(
      "https://a.example/studio",
    );
    expect(
      brandHeadLinks(brand, "/").find((l) => l["rel"] === "canonical")?.[
        "href"
      ],
    ).toBe("https://a.example");
    expect(
      brandHeadLinks(DEFAULT_BRAND, "/studio").some(
        (l) => l["rel"] === "canonical",
      ),
    ).toBe(false);
    expect(
      brandHeadLinks(brand, "/x?y=<script>").some(
        (l) => l["rel"] === "canonical",
      ),
    ).toBe(false);
    expect(
      brandHeadLinks(brand, "/guide/").find((l) => l["rel"] === "canonical")?.[
        "href"
      ],
    ).toBe("https://a.example/guide");
    // private or unknown pages are never canonical
    for (const p of [
      "/r/ABC123",
      "/chat/ABC123",
      "/settings",
      "/join",
      "/nope",
    ])
      expect(
        brandHeadLinks(brand, p).some((l) => l["rel"] === "canonical"),
        p,
      ).toBe(false);
    expect(mimeOf("/a/b.SVG?x=1")).toBe("image/svg+xml");
    expect(mimeOf("/a/b")).toBeUndefined();
  });

  it("titles pages by brand, with and without loader data", () => {
    expect(pageTitle(brand, "Stüdyo")).toBe("Stüdyo — Teknodoz Studio");
    expect(pageTitle(brand)).toBe("Teknodoz Studio");
    expect(titleFromMatches([], "Ayarlar")).toBe("Ayarlar — Teknodoz Studio");
    expect(
      titleFromMatches(
        [{ routeId: "__root__", loaderData: { ...brand, name: "Acme" } }],
        "Ayarlar",
      ),
    ).toBe("Ayarlar — Acme");
    expect(
      titleFromMatches([
        { routeId: "__root__", loaderData: { nonsense: true } },
      ]),
    ).toBe("Teknodoz Studio");
  });

  it("emits CSS only for what differs and never for unvalidated strings", () => {
    expect(brandCss(DEFAULT_BRAND)).toBe("");
    const css = brandCss(
      resolveBrand({
        accent: "#ff8800",
        primary: "#ffffff",
        radius: 0.25,
        uiScale: 1.1,
      }),
    );
    expect(css).toContain("--speaker-b:#ff8800");
    expect(css).toContain("--primary:#ffffff");
    expect(css).toContain("--primary-foreground:#111111");
    expect(css).toContain("--radius:0.25rem");
    expect(css).toContain("html{font-size:110%}");
    const evil = themeVars({
      ...DEFAULT_BRAND,
      accent: "red;}body{display:none",
      radius: Number.NaN,
      uiScale: 99,
    });
    expect(evil.vars).toEqual({});
    expect(evil.fontScalePercent).toBe(130);
  });

  it("builds an installable manifest", () => {
    const m = manifestFor(brand);
    expect(m.name).toBe("Teknodoz Studio");
    expect(m.short_name).toBe("Teknodoz");
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/studio?source=pwa");
    expect(m.icons).toEqual([
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ]);
    expect(m.shortcuts).toHaveLength(4);
    expect(m.theme_color).toBe(brand.themeColor);
    expect(
      manifestFor(resolveBrand({ icon192: "", icon512: "", maskableIcon: "" }))
        .icons,
    ).toEqual([]);
  });
});

describe("local overrides", () => {
  const mem = () => {
    const m = new Map<string, string>();
    return {
      m,
      s: {
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => void m.set(k, v),
        removeItem: (k: string) => void m.delete(k),
      },
    };
  };

  it("stores only the UI subset and survives garbage", () => {
    const { m, s } = mem();
    saveLocalBrand(
      {
        name: "Mine",
        accent: "#00ff00",
        siteUrl: "https://evil.example",
        description: "x",
      } as never,
      s,
    );
    expect(JSON.parse(m.get("tkz.brand.v1") as string)).toEqual({
      name: "Mine",
      accent: "#00ff00",
    });
    expect(loadLocalBrand(s)).toEqual({ name: "Mine", accent: "#00ff00" });
    m.set(
      "tkz.brand.v1",
      JSON.stringify({
        accent: "javascript:1",
        slogan: "ok",
        description: "hacked",
      }),
    );
    expect(loadLocalBrand(s)).toEqual({ slogan: "ok" });
    m.set("tkz.brand.v1", "{broken");
    expect(loadLocalBrand(s)).toEqual({});
    saveLocalBrand({}, s);
    expect(m.has("tkz.brand.v1")).toBe(false);
    expect(loadLocalBrand(null)).toEqual({});
  });

  it("allows an embedded logo image locally but not other data URLs", () => {
    const { s } = mem();
    saveLocalBrand({ logoUrl: "data:image/png;base64,AAAA" }, s);
    expect(loadLocalBrand(s).logoUrl).toBe("data:image/png;base64,AAAA");
    saveLocalBrand({ logoUrl: "data:text/html;base64,AAAA" }, s);
    expect(loadLocalBrand(s)).toEqual({});
  });

  it("applies and clears theme variables on the document", () => {
    const root = document.createElement("div");
    applyThemeToDom(
      resolveBrand({ accent: "#ff8800", radius: 0.25, uiScale: 1.2 }),
      root,
    );
    expect(root.style.getPropertyValue("--speaker-b")).toBe("#ff8800");
    expect(root.style.getPropertyValue("--radius")).toBe("0.25rem");
    expect(root.style.fontSize).toBe("120%");
    applyThemeToDom(DEFAULT_BRAND, root);
    expect(root.style.getPropertyValue("--speaker-b")).toBe("");
    expect(root.style.getPropertyValue("--radius")).toBe("");
    expect(root.style.fontSize).toBe("");
  });
});
