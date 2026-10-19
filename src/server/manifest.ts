// src/server/manifest.ts
// `/manifest.webmanifest`: the PWA manifest, generated from the server-side brand so a rename or a
// new accent colour (config.ts / BRAND_* env) reaches installed apps without a rebuild.
import type { Brand } from "../studio/branding/brand";
import { manifestFor } from "../studio/branding/head";
import { serverBrand } from "../studio/branding/server-brand";

export const MANIFEST_PATH = "/manifest.webmanifest";

export function handleManifest(
  request: Request,
  brand: () => Brand = serverBrand,
): Response | null {
  if (new URL(request.url).pathname !== MANIFEST_PATH) return null;
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
  const body = JSON.stringify(manifestFor(brand()));
  return new Response(request.method === "HEAD" ? null : body, {
    headers: {
      "content-type": "application/manifest+json; charset=utf-8",
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}
