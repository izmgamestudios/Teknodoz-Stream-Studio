// src/studio/branding/brand.ts
// The product identity: name, logo, slogan, "early access" badge, theme colors, share/meta data and
// icons. ONE validated model feeds the SSR <head>, the web manifest, the CSS theme variables and
// the sidebar. Layers (lowest wins first): DEFAULT_BRAND < config.ts (owner, in git) < environment
// (BRAND_*) < this browser's local overrides (UI-only fields, see local.ts).
//
// Pure module: no browser or Node APIs, safe for SSR and for every deployment target.
import { z } from "zod";

export interface Brand {
  /** full name, used in titles, share cards and the manifest */
  name: string;
  /** short name under app icons (≤ 12 chars is ideal) */
  shortName: string;
  /** word next to the logo in the sidebar ("STUDIO") */
  productLabel: string;
  /** sidebar headline; empty = the translated default */
  slogan: string;
  /** sidebar sub text; empty = the translated default */
  tagline: string;
  /** small label under the logo ("Erken erişim"); empty hides it */
  badge: string;
  /** accent color (buttons, highlights); empty = built-in theme */
  accent: string;
  /** second highlight color; empty = built-in theme */
  accent2: string;
  /** action / recording color; empty = built-in theme */
  primary: string;
  /** browser UI color (address bar, task switcher) */
  themeColor: string;
  /** splash / manifest background */
  backgroundColor: string;
  /** corner radius in rem */
  radius: number;
  /** interface scale (1 = 100 %) */
  uiScale: number;
  /** custom logo image ("" = built-in wordmark): /path, https URL, or (local only) data: URL */
  logoUrl: string;
  iconUrl: string;
  icon192: string;
  icon512: string;
  maskableIcon: string;
  appleTouchIcon: string;
  /** share image, 1200×630 recommended */
  ogImage: string;
  description: string;
  keywords: string;
  /** public origin, e.g. https://studio.example.org (needed for absolute share URLs) */
  siteUrl: string;
  /** e.g. @infoteknodoz */
  twitterHandle: string;
  author: string;
  /** html lang / manifest lang */
  lang: string;
  /** og:locale, e.g. tr_TR */
  locale: string;
  robots:
    "index,follow" | "noindex,nofollow" | "index,nofollow" | "noindex,follow";
}

export const DEFAULT_BRAND: Brand = Object.freeze({
  name: "Teknodoz Studio",
  shortName: "Teknodoz",
  productLabel: "STUDIO",
  slogan: "",
  tagline: "",
  badge: "Erken erişim",
  accent: "",
  accent2: "",
  primary: "",
  themeColor: "#12141a",
  backgroundColor: "#12141a",
  radius: 0.75,
  uiScale: 1,
  logoUrl: "",
  iconUrl: "/favicon.ico",
  icon192: "/icons/icon-192.png",
  icon512: "/icons/icon-512.png",
  maskableIcon: "/icons/icon-maskable-512.png",
  appleTouchIcon: "/icons/apple-touch-icon.png",
  ogImage: "/og-image.png",
  description:
    "Ücretsiz ve açık kaynak, tarayıcıda çalışan prompter, canlı yayın, prototip yayını ve konuk stüdyosu.",
  keywords: "prompter, canlı yayın, stüdyo, açık kaynak, WebRTC, RTMP",
  siteUrl: "",
  twitterHandle: "@infoteknodoz",
  author: "Hüseyin Bayer · Teknodoz",
  lang: "tr",
  locale: "tr_TR",
  robots: "index,follow",
});

export const BRAND_KEYS = Object.keys(DEFAULT_BRAND) as (keyof Brand)[];

/** What a visitor may override in their own browser (the rest only matters for crawlers/installs). */
export const LOCAL_KEYS = [
  "name",
  "shortName",
  "productLabel",
  "slogan",
  "tagline",
  "badge",
  "accent",
  "accent2",
  "primary",
  "radius",
  "uiScale",
  "logoUrl",
] as const satisfies readonly (keyof Brand)[];

/* ------------------------------------------------------------------ */
/* validation                                                          */
/* ------------------------------------------------------------------ */

/** Control / zero-width characters become spaces, whitespace collapses. Plain text only. */
export function cleanText(raw: string): string {
  let out = "";
  for (const ch of raw) {
    const c = ch.codePointAt(0) ?? 0;
    const bad =
      c <= 0x1f ||
      c === 0x7f ||
      (c >= 0x200b && c <= 0x200f) ||
      c === 0x2028 ||
      c === 0x2029 ||
      c === 0xfeff;
    out += bad ? " " : ch;
  }
  return out.replace(/\s+/g, " ").trim();
}

const text = (max: number, min = 0) =>
  z
    .string()
    .transform(cleanText)
    .refine((s) => s.length >= min && s.length <= max, "length");

/** `#rgb` / `#rrggbb` -> `#rrggbb` lower case. */
export function normalizeHex(v: string): string | null {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(v.trim());
  if (!m) return null;
  const h = (m[1] as string).toLowerCase();
  return `#${h.length === 3 ? [...h].map((c) => c + c).join("") : h}`;
}

const color = (allowEmpty: boolean) =>
  z
    .string()
    .transform((v) => (v.trim() === "" ? "" : (normalizeHex(v) ?? "!")))
    .refine((v) => v !== "!" && (allowEmpty || v !== ""), "color");

const PATH_URL = /^\/(?!\/)[A-Za-z0-9._~%+\-/]{0,200}$/;
const DATA_IMG =
  /^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/;

export const MAX_DATA_URL = 300_000;

/** "" | same-origin path | https URL (| data: image when `allowData`). */
export function isAssetUrl(v: string, allowData = false): boolean {
  if (v === "") return true;
  if (allowData && v.length <= MAX_DATA_URL && DATA_IMG.test(v)) return true;
  if (v.length > 300) return false;
  if (v.startsWith("/"))
    return PATH_URL.test(v) && !v.split("/").includes("..");
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
}

const assetUrl = (allowData: boolean) =>
  z
    .string()
    .refine((v) => isAssetUrl(v.trim(), allowData), "url")
    .transform((v) => v.trim());

/** `https://host[:port]` without path, query or trailing slash; "" allowed. */
export function normalizeOrigin(v: string): string | null {
  const s = v.trim();
  if (s === "") return "";
  try {
    const u = new URL(s);
    if (
      (u.protocol !== "https:" && u.protocol !== "http:") ||
      u.username ||
      u.password
    )
      return null;
    return u.origin;
  } catch {
    return null;
  }
}

function fields(allowData: boolean) {
  return {
    name: text(60, 1),
    shortName: text(24, 1),
    productLabel: text(24),
    slogan: text(80),
    tagline: text(200),
    badge: text(24),
    accent: color(true),
    accent2: color(true),
    primary: color(true),
    themeColor: color(false),
    backgroundColor: color(false),
    radius: z.number().min(0).max(1.5),
    uiScale: z.number().min(0.85).max(1.3),
    logoUrl: assetUrl(allowData),
    iconUrl: assetUrl(false),
    icon192: assetUrl(false),
    icon512: assetUrl(false),
    maskableIcon: assetUrl(false),
    appleTouchIcon: assetUrl(false),
    ogImage: assetUrl(false),
    description: text(300),
    keywords: text(200),
    siteUrl: z
      .string()
      .transform((v) => normalizeOrigin(v) ?? "!")
      .refine((v) => v !== "!", "origin"),
    twitterHandle: z
      .string()
      .transform((v) => v.trim().replace(/^@?/, "@"))
      .refine((v) => v === "@" || /^@[A-Za-z0-9_]{1,15}$/.test(v), "handle")
      .transform((v) => (v === "@" ? "" : v)),
    author: text(80),
    lang: z
      .string()
      .trim()
      .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/),
    locale: z
      .string()
      .trim()
      .regex(/^[a-z]{2,3}_[A-Z]{2}$/),
    robots: z.enum([
      "index,follow",
      "noindex,nofollow",
      "index,nofollow",
      "noindex,follow",
    ]),
  } satisfies Record<keyof Brand, z.ZodType<unknown, z.ZodTypeDef, unknown>>;
}

export interface ParsedBrand {
  patch: Partial<Brand>;
  /** keys whose value was refused */
  rejected: (keyof Brand)[];
}

/**
 * Validate an untrusted partial brand (config file, env, imported JSON, localStorage). Valid keys
 * are kept (normalised), invalid ones are dropped and reported; unknown keys are ignored.
 */
export function parseBrandPatch(
  raw: unknown,
  opts: { allowData?: boolean; only?: readonly (keyof Brand)[] } = {},
): ParsedBrand {
  const out: Record<string, unknown> = {};
  const rejected: (keyof Brand)[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return { patch: {}, rejected };
  const schema = fields(opts.allowData === true);
  const r = raw as Record<string, unknown>;
  for (const key of opts.only ?? BRAND_KEYS) {
    if (!Object.hasOwn(r, key) || r[key] === undefined) continue;
    const parsed = (
      schema[key] as z.ZodType<unknown, z.ZodTypeDef, unknown>
    ).safeParse(r[key]);
    if (parsed.success) out[key] = parsed.data;
    else rejected.push(key);
  }
  return { patch: out as Partial<Brand>, rejected };
}

/** Merge layers left to right (later wins) onto the defaults. */
export function resolveBrand(...layers: Partial<Brand>[]): Brand {
  return Object.assign({}, DEFAULT_BRAND, ...layers) as Brand;
}

/* ------------------------------------------------------------------ */
/* environment                                                         */
/* ------------------------------------------------------------------ */

/** `shortName` -> `BRAND_SHORT_NAME`, `icon192` -> `BRAND_ICON192` */
export function envNameFor(key: keyof Brand): string {
  return `BRAND_${key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase()}`;
}

/** True when BRAND_JSON is set but is not a JSON object (so it was ignored). */
export function brandJsonProblem(
  env: Record<string, string | undefined>,
): boolean {
  const json = env["BRAND_JSON"];
  if (!json) return false;
  try {
    const j: unknown = JSON.parse(json);
    return typeof j !== "object" || j === null || Array.isArray(j);
  } catch {
    return true;
  }
}

/**
 * `BRAND_JSON` (partial object) plus one variable per field (`BRAND_ACCENT`, `BRAND_SITE_URL`…).
 * Single variables win over the JSON.
 */
export function brandFromEnv(
  env: Record<string, string | undefined>,
): ParsedBrand {
  const raw: Record<string, unknown> = {};
  const json = env["BRAND_JSON"];
  if (json) {
    try {
      const j: unknown = JSON.parse(json);
      if (typeof j === "object" && j !== null && !Array.isArray(j))
        Object.assign(raw, j);
    } catch {
      // see brandJsonProblem(): the caller warns about an unreadable BRAND_JSON
    }
  }
  for (const key of BRAND_KEYS) {
    const v = env[envNameFor(key)];
    if (v === undefined) continue;
    raw[key] = key === "radius" || key === "uiScale" ? Number(v) : v;
  }
  return parseBrandPatch(raw);
}

/* ------------------------------------------------------------------ */
/* color helpers                                                       */
/* ------------------------------------------------------------------ */

export function hexToRgb(hex: string): [number, number, number] | null {
  const n = normalizeHex(hex);
  if (!n) return null;
  const v = Number.parseInt(n.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG contrast ratio of two hex colors (1..21); 1 when a color is invalid. */
export function contrastRatio(a: string, b: string): number {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return 1;
  const [hi, lo] = [luminance(ra), luminance(rb)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

/** Black or white, whichever reads better on `bg`. */
export function readableOn(bg: string): "#ffffff" | "#111111" {
  return contrastRatio(bg, "#ffffff") >= contrastRatio(bg, "#111111")
    ? "#ffffff"
    : "#111111";
}
