// src/server/seo/site.ts
// Public-site identity for the SEO surface: origin, publisher, logo, policy switches.
// Env: SITE_URL (public origin), PUBLISHER_NAME, PUBLISHER_URL, PUBLISHER_LOGO,
//      AI_CRAWLERS=allow|block (default allow), EMBED_ORIGINS (CSP frame-ancestors, default *).
import type { Brand } from "../../studio/branding/brand";

export interface SiteConfig {
  /** no trailing slash */
  origin: string;
  siteName: string;
  publisherName: string;
  publisherUrl: string;
  /** absolute URL */
  logoUrl: string;
  ogImage: string;
  aiCrawlers: "allow" | "block";
  embedOrigins: string;
  twitter: string;
}

const clean = (u: string): string => u.trim().replace(/\/+$/, "");

export function siteFromEnv(
  brand: Brand,
  env: Record<string, string | undefined>,
): SiteConfig {
  const origin =
    clean(env["SITE_URL"] ?? "") ||
    clean(brand.siteUrl) ||
    "http://localhost:3000";
  const abs = (p: string, fallback: string): string => {
    const v = p || fallback;
    return /^https?:\/\//.test(v)
      ? v
      : `${origin}${v.startsWith("/") ? "" : "/"}${v}`;
  };
  return {
    origin,
    siteName: brand.name,
    publisherName:
      (env["PUBLISHER_NAME"] ?? "").trim() || brand.author || brand.name,
    publisherUrl: clean(env["PUBLISHER_URL"] ?? "") || origin,
    logoUrl: abs(
      (env["PUBLISHER_LOGO"] ?? "").trim() || brand.icon512,
      "/icons/icon-512.png",
    ),
    ogImage: abs(brand.ogImage, "/og-image.png"),
    aiCrawlers:
      (env["AI_CRAWLERS"] ?? "").trim().toLowerCase() === "block"
        ? "block"
        : "allow",
    embedOrigins: (env["EMBED_ORIGINS"] ?? "").trim() || "*",
    twitter: brand.twitterHandle,
  };
}

/** Absolute URL for a path or an already absolute http(s) URL; "" for anything else (javascript:, data:, …). */
export function absUrl(site: SiteConfig, v: unknown): string {
  if (typeof v !== "string" || v === "") return "";
  if (/^https?:\/\/[^\s]+$/.test(v)) return v;
  if (/^\/(?!\/)[^\s]*$/.test(v)) return `${site.origin}${v}`;
  return "";
}
