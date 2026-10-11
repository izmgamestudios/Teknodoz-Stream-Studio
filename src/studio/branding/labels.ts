// src/studio/branding/labels.ts
// Field labels (tr/en) and grouping for the branding editor. Kept next to the model so a new
// Brand field cannot be added without a label (see export.test.ts).
import type { Brand } from "./brand";

export interface FieldInfo {
  tr: string;
  en: string;
  /** one short sentence on what the field changes */
  hintTr?: string;
  hintEn?: string;
}

export const BRAND_LABELS: Record<keyof Brand, FieldInfo> = {
  name: {
    tr: "Ürün adı",
    en: "Product name",
    hintTr: "Başlıklarda, paylaşım kartında ve uygulama adında.",
    hintEn: "Titles, share cards and the app name.",
  },
  shortName: {
    tr: "Kısa ad",
    en: "Short name",
    hintTr: "Uygulama simgesinin altında (≤ 12 karakter ideal).",
    hintEn: "Under the app icon (≤ 12 characters is ideal).",
  },
  productLabel: {
    tr: "Logo yanı etiket",
    en: "Label next to logo",
    hintTr: "Yan menüde logonun yanındaki kelime.",
    hintEn: "The word beside the logo in the sidebar.",
  },
  slogan: {
    tr: "Slogan",
    en: "Slogan",
    hintTr: "Yan menü başlığı; boş = varsayılan. Son kelime vurgulanır.",
    hintEn: "Sidebar headline; empty = default. The last word is highlighted.",
  },
  tagline: {
    tr: "Alt yazı",
    en: "Tagline",
    hintTr: "Sloganın altındaki açıklama; boş = varsayılan.",
    hintEn: "Text under the slogan; empty = default.",
  },
  badge: {
    tr: "Logo altı etiket",
    en: "Badge under logo",
    hintTr: "“Erken erişim” gibi; boş bırakırsan gizlenir.",
    hintEn: "Like “Early access”; leave empty to hide it.",
  },
  accent: {
    tr: "Vurgu rengi",
    en: "Accent color",
    hintTr: "Düğmeler ve vurgular; boş = yerleşik tema.",
    hintEn: "Buttons and highlights; empty = built-in theme.",
  },
  accent2: {
    tr: "İkinci vurgu",
    en: "Second accent",
    hintTr: "İkincil vurgu rengi; boş = yerleşik tema.",
    hintEn: "Secondary highlight; empty = built-in theme.",
  },
  primary: {
    tr: "Eylem rengi",
    en: "Action color",
    hintTr: "Ana eylem düğmeleri; boş = yerleşik tema.",
    hintEn: "Primary action buttons; empty = built-in theme.",
  },
  themeColor: {
    tr: "Tarayıcı teması",
    en: "Browser theme color",
    hintTr: "Adres çubuğu ve görev değiştirici rengi.",
    hintEn: "Address bar and task switcher color.",
  },
  backgroundColor: {
    tr: "Açılış arka planı",
    en: "Splash background",
    hintTr: "Yüklü uygulama açılırken görünen renk.",
    hintEn: "Shown while the installed app starts.",
  },
  radius: {
    tr: "Köşe yuvarlaklığı",
    en: "Corner radius",
    hintTr: "rem cinsinden (0 = köşeli).",
    hintEn: "In rem (0 = square).",
  },
  uiScale: {
    tr: "Arayüz ölçeği",
    en: "Interface scale",
    hintTr: "Tüm arayüzü büyütür/küçültür.",
    hintEn: "Scales the whole interface.",
  },
  logoUrl: {
    tr: "Logo görseli",
    en: "Logo image",
    hintTr: "/yol veya https adresi; boş = yerleşik yazı logosu.",
    hintEn: "/path or https URL; empty = built-in wordmark.",
  },
  iconUrl: {
    tr: "Favicon",
    en: "Favicon",
    hintTr: "Tarayıcı sekmesi simgesi.",
    hintEn: "Browser tab icon.",
  },
  icon192: {
    tr: "Uygulama simgesi 192",
    en: "App icon 192",
    hintTr: "192×192 PNG.",
    hintEn: "192×192 PNG.",
  },
  icon512: {
    tr: "Uygulama simgesi 512",
    en: "App icon 512",
    hintTr: "512×512 PNG.",
    hintEn: "512×512 PNG.",
  },
  maskableIcon: {
    tr: "Maskelenebilir simge",
    en: "Maskable icon",
    hintTr: "512×512, içerik orta %80'de (Android).",
    hintEn: "512×512, content inside the middle 80% (Android).",
  },
  appleTouchIcon: {
    tr: "Apple dokunma simgesi",
    en: "Apple touch icon",
    hintTr: "180×180 PNG (iOS ana ekran).",
    hintEn: "180×180 PNG (iOS home screen).",
  },
  ogImage: {
    tr: "Paylaşım görseli",
    en: "Share image",
    hintTr: "1200×630 önerilir (link önizlemesi).",
    hintEn: "1200×630 recommended (link preview).",
  },
  description: {
    tr: "Açıklama",
    en: "Description",
    hintTr: "Arama sonucu ve paylaşım kartı açıklaması.",
    hintEn: "Search result and share card description.",
  },
  keywords: {
    tr: "Anahtar kelimeler",
    en: "Keywords",
    hintTr: "Virgülle ayrılmış.",
    hintEn: "Comma separated.",
  },
  siteUrl: {
    tr: "Site adresi",
    en: "Site URL",
    hintTr: "https://alan.adı — mutlak paylaşım adresleri için gerekir.",
    hintEn: "https://your.domain — needed for absolute share URLs.",
  },
  twitterHandle: {
    tr: "X (Twitter) hesabı",
    en: "X (Twitter) handle",
    hintTr: "@kullanici — paylaşım kartında görünür.",
    hintEn: "@handle — shown on the share card.",
  },
  author: {
    tr: "Yazar",
    en: "Author",
    hintTr: "Sayfa meta verisinde.",
    hintEn: "In the page metadata.",
  },
  lang: {
    tr: "Sayfa dili",
    en: "Page language",
    hintTr: "tr, en, pt-BR…",
    hintEn: "tr, en, pt-BR…",
  },
  locale: {
    tr: "Yerel ayar (og:locale)",
    en: "Locale (og:locale)",
    hintTr: "tr_TR, en_US…",
    hintEn: "tr_TR, en_US…",
  },
  robots: {
    tr: "Arama motorları",
    en: "Search engines",
    hintTr: "Dizine eklensin mi?",
    hintEn: "Should the site be indexed?",
  },
};

export interface FieldGroup {
  id: string;
  tr: string;
  en: string;
  keys: readonly (keyof Brand)[];
}

export const BRAND_GROUPS: readonly FieldGroup[] = [
  {
    id: "identity",
    tr: "Kimlik",
    en: "Identity",
    keys: ["name", "shortName", "productLabel", "slogan", "tagline", "badge"],
  },
  {
    id: "colors",
    tr: "Renkler",
    en: "Colors",
    keys: ["accent", "accent2", "primary", "themeColor", "backgroundColor"],
  },
  { id: "look", tr: "Görünüm", en: "Look", keys: ["radius", "uiScale"] },
  {
    id: "images",
    tr: "Logo ve simgeler",
    en: "Logo and icons",
    keys: [
      "logoUrl",
      "iconUrl",
      "icon192",
      "icon512",
      "maskableIcon",
      "appleTouchIcon",
      "ogImage",
    ],
  },
  {
    id: "meta",
    tr: "Meta ve paylaşım",
    en: "Metadata and sharing",
    keys: [
      "description",
      "keywords",
      "siteUrl",
      "twitterHandle",
      "author",
      "lang",
      "locale",
      "robots",
    ],
  },
];

export type FieldKind =
  "text" | "textarea" | "color" | "range" | "asset" | "robots";

export const FIELD_KIND: Record<keyof Brand, FieldKind> = {
  name: "text",
  shortName: "text",
  productLabel: "text",
  slogan: "text",
  tagline: "textarea",
  badge: "text",
  accent: "color",
  accent2: "color",
  primary: "color",
  themeColor: "color",
  backgroundColor: "color",
  radius: "range",
  uiScale: "range",
  logoUrl: "asset",
  iconUrl: "asset",
  icon192: "asset",
  icon512: "asset",
  maskableIcon: "asset",
  appleTouchIcon: "asset",
  ogImage: "asset",
  description: "textarea",
  keywords: "text",
  siteUrl: "text",
  twitterHandle: "text",
  author: "text",
  lang: "text",
  locale: "text",
  robots: "robots",
};

/** Colors that may be left empty (= built-in theme). */
export const OPTIONAL_COLORS: readonly (keyof Brand)[] = [
  "accent",
  "accent2",
  "primary",
];
