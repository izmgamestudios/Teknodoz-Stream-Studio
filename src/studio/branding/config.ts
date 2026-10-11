// src/studio/branding/config.ts
// >>> The site owner edits THIS file (or sets BRAND_* environment variables) to change the product
// identity everywhere: sidebar, share cards, <head>, web manifest, icons, theme colors. <<<
// Only the keys you list change; the rest keeps its default (see brand.ts). Invalid values are
// ignored with a warning in the server log. Environment variables win over this file:
//   BRAND_JSON='{"name":"Acme Studio"}'  or  BRAND_NAME=… BRAND_ACCENT=#22d3ee BRAND_SITE_URL=https://…
// See docs/BRANDING.md. The Settings page can export a ready-to-paste block for both.
import type { Brand } from "./brand";

export const BRAND_CONFIG: Partial<Brand> = {
  // name: "Teknodoz Studio",
  // slogan: "Yayını sahnede kur.",
  // badge: "Erken erişim",
  // accent: "#22d3ee",
  // siteUrl: "https://teknodoz-studio.ortakofis.org",
  // twitterHandle: "@infoteknodoz",
};
