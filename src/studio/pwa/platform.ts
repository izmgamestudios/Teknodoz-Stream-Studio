// src/studio/pwa/platform.ts
// Which device / browser is this? Pure functions (the caller passes the user agent), so they are
// unit-tested and safe on the server.

export type PlatformId =
  "windows" | "macos" | "linux" | "android" | "ios" | "other";
export type BrowserId =
  "edge" | "chrome" | "firefox" | "safari" | "samsung" | "other";

export const PLATFORM_IDS = [
  "windows",
  "macos",
  "linux",
  "android",
  "ios",
] as const satisfies readonly PlatformId[];
export type DownloadTarget = (typeof PLATFORM_IDS)[number];

export function detectPlatform(ua: string, maxTouchPoints = 0): PlatformId {
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  // iPadOS 13+ announces itself as a Mac, but a Mac has no touch screen
  if (/macintosh|mac os x/i.test(ua))
    return maxTouchPoints > 1 ? "ios" : "macos";
  if (/windows/i.test(ua)) return "windows";
  if (/cros/i.test(ua)) return "other";
  if (/linux|x11/i.test(ua)) return "linux";
  return "other";
}

export function detectBrowser(ua: string): BrowserId {
  if (/edg(e|a|ios)?\//i.test(ua)) return "edge";
  if (/samsungbrowser/i.test(ua)) return "samsung";
  if (/firefox|fxios/i.test(ua)) return "firefox";
  if (/chrome|chromium|crios/i.test(ua)) return "chrome";
  if (/safari/i.test(ua)) return "safari";
  return "other";
}

export const PLATFORM_NAMES: Record<PlatformId, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
  android: "Android",
  ios: "iOS / iPadOS",
  other: "—",
};

export const PLATFORM_ICONS: Record<PlatformId, string> = {
  windows: "🪟",
  macos: "🍎",
  linux: "🐧",
  android: "🤖",
  ios: "📱",
  other: "💻",
};

type Steps = { tr: readonly string[]; en: readonly string[] };

/** "Install it as an app" steps for the web app, per platform (and browser where it differs). */
export function installSteps(platform: PlatformId, browser: BrowserId): Steps {
  if (platform === "ios")
    return {
      tr: [
        "Siteyi Safari'de aç (en sorunsuz yol; iOS 16.4'ten beri diğer tarayıcılar da Paylaş menüsünden ekleyebilir).",
        "Paylaş düğmesine (kare ve ok) dokun.",
        "“Ana Ekrana Ekle”yi seç, adı onayla.",
      ],
      en: [
        "Open the site in Safari (the most reliable way; since iOS 16.4 other browsers can add it from their Share menu too).",
        "Tap the Share button (square with an arrow).",
        "Choose “Add to Home Screen” and confirm the name.",
      ],
    };
  if (platform === "android")
    return browser === "firefox"
      ? {
          tr: ["Firefox menüsünü (⋮) aç.", "“Yükle” seçeneğine dokun."],
          en: ["Open the Firefox menu (⋮).", "Tap “Install”."],
        }
      : {
          tr: [
            "Siteyi Chrome, Edge veya Samsung Internet'te aç.",
            "Menüden (⋮) “Uygulamayı yükle” ya da “Ana ekrana ekle”yi seç.",
          ],
          en: [
            "Open the site in Chrome, Edge or Samsung Internet.",
            "From the menu (⋮) pick “Install app” or “Add to Home screen”.",
          ],
        };
  if (platform === "macos" && browser === "safari")
    return {
      tr: [
        "Safari 17 veya üstünde siteyi aç.",
        "Dosya → “Dock'a Ekle…” seçeneğini kullan.",
      ],
      en: [
        "Open the site in Safari 17 or newer.",
        "Use File → “Add to Dock…”.",
      ],
    };
  if (browser === "firefox")
    return {
      tr: [
        "Firefox masaüstünde web uygulaması yükleme yok; site yine de tam çalışır.",
        "Uygulama olarak kullanmak için Chrome veya Edge ile aç.",
      ],
      en: [
        "Desktop Firefox cannot install web apps; the site still works fully.",
        "To use it as an app, open it in Chrome or Edge.",
      ],
    };
  return {
    tr: [
      "Siteyi Chrome veya Edge ile aç.",
      "Adres çubuğunun sağındaki “Yükle” simgesine (⊕ / bilgisayar+ok) tıkla ya da menü → “Uygulamayı yükle”.",
      "Uygulama kendi penceresinde açılır; masaüstüne/başlat menüsüne kısayol ekler.",
    ],
    en: [
      "Open the site in Chrome or Edge.",
      "Click the “Install” icon at the right of the address bar, or menu → “Install app”.",
      "The app opens in its own window and adds a shortcut to your desktop / start menu.",
    ],
  };
}
