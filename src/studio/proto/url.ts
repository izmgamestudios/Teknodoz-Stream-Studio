// src/studio/proto/url.ts
// Prototype URL validation. Only http(s) is ever embedded or captured.

export type UrlResult =
  | { ok: true; url: string; host: string }
  | {
      ok: false;
      reason: "empty" | "too-long" | "invalid" | "protocol" | "credentials";
    };

export const MAX_URL_LENGTH = 2048;

/** Remove control, zero-width and line-separator characters (code-point check, no regex). */
function stripInvisible(input: string): string {
  let out = "";
  for (const ch of input) {
    const c = ch.codePointAt(0) ?? 0;
    const bad =
      c <= 0x1f ||
      c === 0x7f ||
      (c >= 0x200b && c <= 0x200f) ||
      c === 0x2028 ||
      c === 0x2029 ||
      c === 0xfeff;
    if (!bad) out += ch;
  }
  return out;
}

/** Accepts bare hosts ("example.com" -> https), rejects javascript:/data:/file:/blob:/userinfo. */
export function normalizePrototypeUrl(input: string): UrlResult {
  const trimmed = stripInvisible(input).trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  if (trimmed.length > MAX_URL_LENGTH) return { ok: false, reason: "too-long" };
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed);
  const looksHostPort = /^[^/\s:]+:\d+(\/|$)/.test(trimmed); // "localhost:3000"
  let candidate = trimmed;
  if (trimmed.startsWith("//")) candidate = `https:${trimmed}`;
  else if (!hasScheme || looksHostPort) candidate = `https://${trimmed}`;
  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: "protocol" };
  }
  if (u.username || u.password) return { ok: false, reason: "credentials" };
  if (!u.hostname) return { ok: false, reason: "invalid" };
  return { ok: true, url: u.href, host: u.host };
}

/** An https page cannot frame http content (mixed content is blocked by the browser). */
export function isMixedContentBlocked(
  url: string,
  pageProtocol: string,
): boolean {
  try {
    return pageProtocol === "https:" && new URL(url).protocol === "http:";
  } catch {
    return false;
  }
}

/** Sites that are well known to forbid framing (X-Frame-Options / CSP frame-ancestors). */
const BLOCKERS = [
  "google.com",
  "youtube.com",
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "github.com",
  "linkedin.com",
  "netflix.com",
  "amazon.com",
  "reddit.com",
  "tiktok.com",
  "whatsapp.com",
  "web.whatsapp.com",
  "apple.com",
  "microsoft.com",
  "paypal.com",
];

export function likelyBlocksEmbedding(host: string): boolean {
  const h = host
    .toLowerCase()
    .replace(/:\d+$/, "")
    .replace(/^www\./, "");
  if (h === "youtube.com" || h.endsWith(".youtube.com")) return true;
  return BLOCKERS.some((b) => h === b || h.endsWith(`.${b}`));
}

/** Conservative sandbox attribute. Same-origin access is only granted for the user's own app. */
export function iframeSandbox(sameOriginAllowed: boolean): string {
  const base = [
    "allow-scripts",
    "allow-forms",
    "allow-popups",
    "allow-pointer-lock",
  ];
  if (sameOriginAllowed) base.push("allow-same-origin");
  return base.join(" ");
}

export const EMBED_HELP = {
  blocked: {
    tr: "Bu site gömülmeye izin vermiyor. Siteyi ayrı bir sekmede açıp “Sekmeyi yakala” ile paylaşın.",
    en: "This site forbids embedding. Open it in another tab and use “Capture tab”.",
  },
  mixed: {
    tr: "http:// sayfaları https:// stüdyo içinde gösterilemez. https:// adresi kullanın.",
    en: "http:// pages cannot be shown inside the https:// studio. Use an https:// URL.",
  },
} as const;
