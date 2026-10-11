// src/studio/community/supporters.ts
// The PROJECT's own supporters wall (sponsors, partners, collaborators, investors who chose to be
// listed) and the application kit. >>> The owner edits PROJECT_SUPPORTERS after a written
// agreement with each party; it ships EMPTY on purpose: no placeholder or invented names. <<<
//
// (Sponsors of an individual broadcast are a different thing: they live in the studio project,
// see src/studio/sponsors/.)
import { CREDITS } from "../credits";
import type { SponsorTier, SupporterKind } from "../types";

export interface ProjectSupporter {
  name: string;
  kind: SupporterKind;
  tier: SponsorTier;
  /** https website */
  url: string;
  /** optional logo file under /public/sponsors/ (e.g. "/sponsors/acme.svg") */
  logo?: string;
  /** "YYYY-MM" */
  since: string;
}

export const PROJECT_SUPPORTERS: readonly ProjectSupporter[] = [];

const LOGO = /^\/sponsors\/[A-Za-z0-9._-]{1,80}\.(png|jpe?g|webp|svg)$/;
const SINCE = /^\d{4}-(0[1-9]|1[0-2])$/;

function httpsUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** Only well-formed entries are shown (names as text, https links, same-origin logo files). */
export function validSupporters(
  list: readonly ProjectSupporter[],
): ProjectSupporter[] {
  return list.filter(
    (s) =>
      s.name.trim() !== "" &&
      s.name.length <= 80 &&
      httpsUrl(s.url) &&
      (s.logo === undefined || LOGO.test(s.logo)) &&
      SINCE.test(s.since),
  );
}

export const KIND_TITLE: Record<SupporterKind, string> = {
  sponsor: "Sponsorlar",
  partner: "İş ortakları",
  collaborator: "İş birlikçiler",
  investor: "Yatırımcılar",
};

export interface Package {
  tier: SponsorTier;
  name: string;
  benefits: readonly string[];
}

/** Draft packages: everything listed is something the project can deliver with what exists today. */
export const PACKAGES: readonly Package[] = [
  {
    tier: "supporter",
    name: "Destekçi",
    benefits: [
      "İsim ve bağlantı bu sayfadaki destekçi duvarında",
      "Sürüm notlarında teşekkür",
    ],
  },
  {
    tier: "silver",
    name: "Gümüş",
    benefits: [
      "Destekçi avantajları + logo duvarda",
      "Haftalık demo yayınlarında sponsor katmanında logo (dönüşümlü)",
      "Yayın başına ekranda kalma raporu (CSV)",
    ],
  },
  {
    tier: "gold",
    name: "Altın",
    benefits: [
      "Gümüş avantajları, daha uzun ekran süresi (×2)",
      "Yayında 10 dk ürün/hizmet tanıtımı (ortak bölüm)",
      "Duyuru kanallarında ve LinkedIn sayfasında teşekkür gönderisi",
      "Marka renkli, ortak yayın şablonu",
    ],
  },
  {
    tier: "title",
    name: "Ana sponsor",
    benefits: [
      "“Sunan: …” ibaresi yayın başlığında ve şablonda (×3 ekran süresi)",
      "Ortak yayın serisi ve öncelikli duyuru",
      "Yol haritası için görüş hakkı (karar hakkı değil: proje bağımsız kalır)",
      "Üç aylık rapor ve değerlendirme görüşmesi",
    ],
  },
];

/* ------------------------------------------------------------------ */
/* application kit                                                     */
/* ------------------------------------------------------------------ */

export type ApplicantKind = SupporterKind | "media";

export const APPLICANT_LABEL: Record<ApplicantKind, string> = {
  sponsor: "Sponsorluk",
  partner: "İş ortaklığı",
  collaborator: "İş birliği",
  investor: "Yatırım görüşmesi",
  media: "Medya / basın",
};

export interface ApplicationInput {
  kind: ApplicantKind;
  name: string;
  org: string;
  /** how to reach back (e-mail, phone or handle) */
  contact: string;
  message: string;
}

function oneLine(s: string, max: number): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    out +=
      c <= 0x1f || c === 0x7f || (c >= 0x200b && c <= 0x200f) || c === 0xfeff
        ? " "
        : ch;
  }
  return out.replace(/\s+/g, " ").trim().slice(0, max);
}

function multiLine(s: string, max: number): string {
  return s
    .replace(/\r\n?/g, "\n")
    .split("")
    .filter((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      return (
        ch === "\n" ||
        (c > 0x1f &&
          c !== 0x7f &&
          !(c >= 0x200b && c <= 0x200f) &&
          c !== 0xfeff)
      );
    })
    .join("")
    .trim()
    .slice(0, max);
}

/** Digits of the contact phone for wa.me (no "+", no spaces). */
export function contactWhatsAppNumber(): string {
  return CREDITS.phoneHref.replace(/\D/g, "");
}

export function applicationText(a: ApplicationInput): {
  subject: string;
  body: string;
} {
  const who = oneLine(a.org, 80) || oneLine(a.name, 80) || "—";
  const subject = `[Teknodoz] ${APPLICANT_LABEL[a.kind]} — ${who}`;
  const body = [
    `Merhaba Hüseyin,`,
    ``,
    `Konu: ${APPLICANT_LABEL[a.kind]}`,
    `Ad: ${oneLine(a.name, 80) || "—"}`,
    `Kurum: ${oneLine(a.org, 80) || "—"}`,
    `İletişim: ${oneLine(a.contact, 120) || "—"}`,
    ``,
    multiLine(a.message, 1200) || "(mesaj yok)",
  ].join("\n");
  return { subject, body };
}

export function applicationLinks(a: ApplicationInput): {
  mailto: string;
  whatsapp: string;
} {
  const { subject, body } = applicationText(a);
  const q = encodeURIComponent;
  return {
    mailto: `mailto:${CREDITS.email}?subject=${q(subject)}&body=${q(body)}`,
    whatsapp: `https://wa.me/${contactWhatsAppNumber()}?text=${q(`${subject}\n\n${body}`.slice(0, 1500))}`,
  };
}
