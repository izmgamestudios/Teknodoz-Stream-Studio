// src/studio/branding/head.ts
// Pure builders that turn a validated Brand into: <head> meta + links (SSR), theme CSS, the web
// app manifest and a per-page title. Nothing here reads the environment.
import { DEFAULT_BRAND, normalizeHex, readableOn, type Brand } from "./brand";

export interface MetaTag {
  [key: string]: string;
}

/** Absolute URL for share cards: needs siteUrl, otherwise the relative path is returned. */
export function absoluteUrl(brand: Brand, pathOrUrl: string): string {
  if (!pathOrUrl) return "";
  if (/^https:\/\//.test(pathOrUrl)) return pathOrUrl;
  return brand.siteUrl ? `${brand.siteUrl}${pathOrUrl}` : pathOrUrl;
}

/** "Page — Brand name" */
export function pageTitle(brand: Brand, page?: string): string {
  return page ? `${page} — ${brand.name}` : brand.name;
}

const KNOWN_ROUTE_ID = "__root__";

/**
 * Title helper for child routes: `head: ({ matches }) => ({ meta: [{ title: titleFromMatches(matches, "Prompter") }] })`.
 * Falls back to the default brand when the root loader data is not there (tests, error pages).
 */
export function titleFromMatches(
  matches: readonly { routeId?: string; loaderData?: unknown }[],
  page?: string,
): string {
  const root = matches.find((m) => m.routeId === KNOWN_ROUTE_ID)?.loaderData;
  const brand = isBrand(root) ? root : DEFAULT_BRAND;
  return pageTitle(brand, page);
}

function isBrand(v: unknown): v is Brand {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Brand).name === "string" &&
    typeof (v as Brand).themeColor === "string"
  );
}

/** Pages worth sharing / indexing; private pages (`/r/KOD`, `/chat/KOD`, `/settings`…) get no canonical URL. */
export const PUBLIC_PATHS: readonly string[] = [
  "/",
  "/studio",
  "/community",
  "/guide",
  "/download",
];

/**
 * Absolute URL of a public page: the site origin plus `pathname`. Without a `pathname` it is the site
 * root; for a non-public path or without `siteUrl` there is none.
 */
export function canonicalUrl(brand: Brand, pathname?: string): string | null {
  if (!brand.siteUrl) return null;
  if (pathname === undefined) return brand.siteUrl;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (!PUBLIC_PATHS.includes(path)) return null;
  return `${brand.siteUrl}${path === "/" ? "" : path}`;
}

export function brandHeadMeta(brand: Brand, pathname?: string): MetaTag[] {
  const title = brand.slogan ? `${brand.name} — ${brand.slogan}` : brand.name;
  const image = absoluteUrl(brand, brand.ogImage);
  const meta: MetaTag[] = [
    { title },
    { name: "description", content: brand.description },
    { name: "keywords", content: brand.keywords },
    { name: "author", content: brand.author },
    { name: "application-name", content: brand.name },
    { name: "theme-color", content: brand.themeColor },
    { name: "robots", content: brand.robots },
    { name: "apple-mobile-web-app-capable", content: "yes" },
    { name: "mobile-web-app-capable", content: "yes" },
    { name: "apple-mobile-web-app-title", content: brand.shortName },
    {
      name: "apple-mobile-web-app-status-bar-style",
      content: "black-translucent",
    },
    { property: "og:site_name", content: brand.name },
    { property: "og:type", content: "website" },
    { property: "og:title", content: title },
    { property: "og:description", content: brand.description },
    { property: "og:locale", content: brand.locale },
    {
      name: "twitter:card",
      content: image ? "summary_large_image" : "summary",
    },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: brand.description },
  ];
  const url = canonicalUrl(brand, pathname);
  if (url) meta.push({ property: "og:url", content: url });
  if (image) {
    meta.push(
      { property: "og:image", content: image },
      { property: "og:image:alt", content: brand.name },
      { name: "twitter:image", content: image },
    );
  }
  if (brand.twitterHandle) {
    meta.push(
      { name: "twitter:site", content: brand.twitterHandle },
      { name: "twitter:creator", content: brand.twitterHandle },
    );
  }
  return meta.filter((m) => !("content" in m) || m["content"] !== "");
}

export interface LinkTag {
  [key: string]: string;
}

const MIME: Record<string, string> = {
  png: "image/png",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

export function mimeOf(url: string): string | undefined {
  const ext = url.split(/[?#]/)[0]?.split(".").pop()?.toLowerCase();
  return ext ? MIME[ext] : undefined;
}

export function brandHeadLinks(brand: Brand, pathname?: string): LinkTag[] {
  const links: LinkTag[] = [{ rel: "manifest", href: "/manifest.webmanifest" }];
  if (brand.iconUrl) {
    const type = mimeOf(brand.iconUrl);
    links.push({ rel: "icon", href: brand.iconUrl, ...(type ? { type } : {}) });
  }
  if (brand.appleTouchIcon)
    links.push({ rel: "apple-touch-icon", href: brand.appleTouchIcon });
  const canonical =
    pathname === undefined ? null : canonicalUrl(brand, pathname);
  if (canonical) links.push({ rel: "canonical", href: canonical });
  return links;
}

/* ------------------------------------------------------------------ */
/* theme                                                               */
/* ------------------------------------------------------------------ */

export interface ThemeVars {
  /** CSS custom properties on :root */
  vars: Record<string, string>;
  /** html font-size in percent, null = leave */
  fontScalePercent: number | null;
}

/** Only values that differ from the built-in theme are emitted. */
export function themeVars(brand: Brand): ThemeVars {
  const vars: Record<string, string> = {};
  // defence in depth: only well-formed colors / finite numbers can ever reach the stylesheet
  const accent = normalizeHex(brand.accent);
  const accent2 = normalizeHex(brand.accent2);
  const primary = normalizeHex(brand.primary);
  if (accent) vars["--speaker-b"] = accent;
  if (accent2) vars["--speaker-a"] = accent2;
  if (primary) {
    vars["--primary"] = primary;
    vars["--primary-solid"] = primary; // solid fills follow the brand color
    vars["--primary-foreground"] = readableOn(primary);
  }
  if (Number.isFinite(brand.radius) && brand.radius !== DEFAULT_BRAND.radius)
    vars["--radius"] = `${Math.min(1.5, Math.max(0, brand.radius))}rem`;
  const scale =
    Number.isFinite(brand.uiScale) && brand.uiScale !== DEFAULT_BRAND.uiScale
      ? Math.round(Math.min(1.3, Math.max(0.85, brand.uiScale)) * 1000) / 10
      : null;
  return { vars, fontScalePercent: scale };
}

/** `<style>` body for SSR. Safe by construction: only validated hex colors and numbers. */
export function brandCss(brand: Brand): string {
  const t = themeVars(brand);
  const decl = Object.entries(t.vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
  const parts: string[] = [];
  if (decl) parts.push(`:root{${decl}}`);
  if (t.fontScalePercent !== null)
    parts.push(`html{font-size:${t.fontScalePercent}%}`);
  return parts.join("\n");
}

/* ------------------------------------------------------------------ */
/* manifest                                                            */
/* ------------------------------------------------------------------ */

interface ManifestIcon {
  src: string;
  sizes?: string;
  type?: string;
  purpose?: string;
}

export interface WebManifest {
  id: string;
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  display: string;
  display_override: string[];
  orientation: string;
  background_color: string;
  theme_color: string;
  lang: string;
  dir: string;
  categories: string[];
  icons: ManifestIcon[];
  shortcuts: {
    name: string;
    short_name: string;
    url: string;
    icons: { src: string; sizes: string }[];
  }[];
}

export function manifestFor(brand: Brand): WebManifest {
  const icons: ManifestIcon[] = [];
  const add = (src: string, sizes: string | undefined, purpose?: string) => {
    if (!src) return;
    const type = mimeOf(src);
    icons.push({
      src,
      ...(sizes ? { sizes } : {}),
      ...(type ? { type } : {}),
      ...(purpose ? { purpose } : {}),
    });
  };
  add(brand.icon192, "192x192");
  add(brand.icon512, "512x512");
  add(brand.maskableIcon, "512x512", "maskable");
  const shortcut = (name: string, url: string) => ({
    name,
    short_name: name,
    url,
    icons: brand.icon192 ? [{ src: brand.icon192, sizes: "192x192" }] : [],
  });
  return {
    id: "/",
    name: brand.name,
    short_name: brand.shortName,
    description: brand.description,
    start_url: "/studio?source=pwa",
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone", "minimal-ui"],
    orientation: "any",
    background_color: brand.backgroundColor,
    theme_color: brand.themeColor,
    lang: brand.lang,
    dir: "ltr",
    categories: ["video", "productivity", "multimedia"],
    icons,
    shortcuts: [
      shortcut("Prompter", "/"),
      shortcut("Stüdyo", "/studio"),
      shortcut("Oda", "/room"),
      shortcut("Canlı yayın", "/live"),
    ],
  };
}
