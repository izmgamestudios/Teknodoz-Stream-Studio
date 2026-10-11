// src/studio/community/share.ts
// "Announce my stream" helpers: official share-intent URLs (no API keys, no server, nothing is
// posted without the user pressing the platform's own Share button) and the announcement text.

export type ShareTarget =
  "whatsapp" | "telegram" | "linkedin" | "facebook" | "x" | "email";

export const SHARE_TARGETS: readonly {
  id: ShareTarget;
  name: string;
  icon: string;
  /** what the platform's share dialog can carry */
  carries: "text+url" | "url-only";
}[] = [
  { id: "whatsapp", name: "WhatsApp", icon: "🟢", carries: "text+url" },
  { id: "telegram", name: "Telegram", icon: "✈️", carries: "text+url" },
  { id: "linkedin", name: "LinkedIn", icon: "💼", carries: "url-only" },
  { id: "facebook", name: "Facebook", icon: "📘", carries: "url-only" },
  { id: "x", name: "X", icon: "✖️", carries: "text+url" },
  { id: "email", name: "E-posta", icon: "✉️", carries: "text+url" },
];

export interface ShareInput {
  /** the link being announced (http/https only) */
  url: string;
  /** the full announcement text (may already contain the link) */
  text: string;
  /** e-mail subject / short title */
  title?: string;
}

const MAX_TEXT = 1000;

export function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s.trim());
    return (
      (u.protocol === "https:" || u.protocol === "http:") &&
      !u.username &&
      !u.password
    );
  } catch {
    return false;
  }
}

const q = encodeURIComponent;

/** Build the share-intent URL for `target`, or null when the link is not a plain http(s) URL. */
export function shareUrl(
  target: ShareTarget,
  input: ShareInput,
): string | null {
  if (!isHttpUrl(input.url)) return null;
  const url = new URL(input.url.trim()).toString();
  const text = input.text.trim().slice(0, MAX_TEXT);
  switch (target) {
    case "whatsapp":
      return `https://wa.me/?text=${q(text)}`;
    case "telegram":
      return `https://t.me/share/url?url=${q(url)}&text=${q(text)}`;
    case "linkedin":
      return `https://www.linkedin.com/sharing/share-offsite/?url=${q(url)}`;
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${q(url)}`;
    case "x":
      return `https://twitter.com/intent/tweet?text=${q(text.slice(0, 250))}&url=${q(url)}`;
    case "email":
      return `mailto:?subject=${q((input.title ?? "Canlı yayın").slice(0, 150))}&body=${q(text)}`;
  }
}

/* ------------------------------------------------------------------ */
/* text                                                                */
/* ------------------------------------------------------------------ */

export type AnnounceLang = "tr" | "en";

export interface AnnounceInput {
  title: string;
  /** `datetime-local` value (`YYYY-MM-DDTHH:mm`) or "" for "now" */
  when?: string;
  url: string;
  lang: AnnounceLang;
  /** space/comma separated words, `#` optional */
  hashtags?: string;
}

/** Control / zero-width characters become spaces; whitespace collapses; length is capped. */
function clean(s: string, max: number): string {
  let out = "";
  for (const ch of s) {
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
  return out.replace(/\s+/g, " ").trim().slice(0, max);
}

export function parseHashtags(raw: string): string[] {
  const out: string[] = [];
  for (const w of raw.split(/[\s,]+/)) {
    const t = w.replace(/^#+/, "");
    if (/^[\p{L}\p{N}_]{1,40}$/u.test(t) && !out.includes(`#${t}`))
      out.push(`#${t}`);
    if (out.length >= 6) break;
  }
  return out;
}

export function formatWhen(value: string, lang: AnnounceLang): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return "";
  const [y, mo, da, h, mi] = [m[1], m[2], m[3], m[4], m[5]].map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const d = new Date(y, mo - 1, da, h, mi);
  // Date silently rolls 31 Feb over to March: only accept values that round-trip
  if (
    d.getFullYear() !== y ||
    d.getMonth() !== mo - 1 ||
    d.getDate() !== da ||
    d.getHours() !== h ||
    d.getMinutes() !== mi
  )
    return "";
  return new Intl.DateTimeFormat(lang === "tr" ? "tr-TR" : "en-GB", {
    dateStyle: "full",
    timeStyle: "short",
  }).format(d);
}

export function announcementText(a: AnnounceInput): string {
  const title =
    clean(a.title, 140) || (a.lang === "tr" ? "Canlı yayın" : "Live stream");
  const when = a.when ? formatWhen(a.when, a.lang) : "";
  const tags = parseHashtags(a.hashtags ?? "").join(" ");
  const lines =
    a.lang === "tr"
      ? [
          `🔴 CANLI YAYIN: ${title}`,
          when ? `🗓 ${when}` : "🗓 Şimdi canlıyız!",
          `▶ İzle / katıl: ${a.url.trim()}`,
        ]
      : [
          `🔴 LIVE: ${title}`,
          when ? `🗓 ${when}` : "🗓 We are live now!",
          `▶ Watch / join: ${a.url.trim()}`,
        ];
  if (tags) lines.push(tags);
  return lines.join("\n");
}
