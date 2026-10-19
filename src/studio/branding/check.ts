// src/studio/branding/check.ts
// Advisory checks for the branding editor. Never blocks anything; only tells the owner what will
// look off (low contrast, relative share URLs, over-long descriptions…).
import { contrastRatio, type Brand } from "./brand";

export type BrandWarning =
  | "accent-contrast"
  | "no-site-url"
  | "no-og-image"
  | "description-long"
  | "description-short"
  | "short-name-long"
  | "noindex";

export function checkBrand(b: Brand): BrandWarning[] {
  const out: BrandWarning[] = [];
  if (b.accent && contrastRatio(b.accent, b.backgroundColor) < 3)
    out.push("accent-contrast");
  if (!b.siteUrl) out.push("no-site-url");
  if (!b.ogImage) out.push("no-og-image");
  if (b.description.length > 160) out.push("description-long");
  else if (b.description.length < 50) out.push("description-short");
  if (b.shortName.length > 12) out.push("short-name-long");
  if (b.robots.startsWith("noindex")) out.push("noindex");
  return out;
}

export const WARNING_TEXT: Record<BrandWarning, { tr: string; en: string }> = {
  "accent-contrast": {
    tr: "Vurgu rengi koyu arka planda zor okunur (kontrast < 3:1).",
    en: "The accent color is hard to read on the dark background (contrast < 3:1).",
  },
  "no-site-url": {
    tr: "Site adresi boş: paylaşım görseli ve canonical adresler göreli kalır, bazı platformlar önizleme göstermez.",
    en: "Site URL is empty: share image and canonical URLs stay relative and some platforms show no preview.",
  },
  "no-og-image": {
    tr: "Paylaşım görseli yok: bağlantılar görselsiz paylaşılır.",
    en: "No share image: links are shared without a picture.",
  },
  "description-long": {
    tr: "Açıklama 160 karakterden uzun: arama sonuçlarında kesilir.",
    en: "The description is over 160 characters and is cut off in search results.",
  },
  "description-short": {
    tr: "Açıklama 50 karakterden kısa: paylaşım kartı boş görünebilir.",
    en: "The description is under 50 characters; the share card may look empty.",
  },
  "short-name-long": {
    tr: "Kısa ad 12 karakterden uzun: uygulama simgesinin altında kesilir.",
    en: "The short name is over 12 characters and is truncated under the app icon.",
  },
  noindex: {
    tr: "Arama motorları kapalı: site Google gibi motorlarda görünmez.",
    en: "Search engines are off: the site will not appear on Google and similar.",
  },
};
