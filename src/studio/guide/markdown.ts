// src/studio/guide/markdown.ts
// Renders the guide as Markdown for GitHub (docs/USER-GUIDE.md, docs/USER-GUIDE.en.md). Pure.
// content.test.ts checks the committed files against this output.
import type { ContentLang as Lang } from "../i18n/messages";
import { FAQ, GUIDE } from "./content";
import type { ResolvedResources } from "./resources";
import { guideShortcuts } from "./shortcuts";

const T = {
  tr: {
    title: "Teknodoz Studio — Kullanım kılavuzu",
    generated:
      "Bu dosya `src/studio/guide/content.ts` içeriğinden üretilir ve uygulamadaki **/guide** sayfasıyla aynıdır. Elle düzenlemeyin: kaynağı değiştirip `UPDATE_DOCS=1 npx vitest run src/studio/guide` çalıştırın.",
    toc: "İçindekiler",
    resources: "PDF, video ve bağlantılar",
    pdf: "PDF kılavuz",
    videos: "Videolar",
    links: "Bağlantılar",
    shortcuts: "Klavye kısayolları",
    shortcutsNote: "Kısayollar Ayarlar sayfasından değiştirilebilir.",
    key: "Tuş",
    action: "İşlem",
    faq: "Sık sorulan sorular",
    more: "Daha fazlası",
    other: "English version",
    otherFile: "USER-GUIDE.en.md",
    tip: "İpucu",
  },
  en: {
    title: "Teknodoz Studio — User guide",
    generated:
      "This file is generated from `src/studio/guide/content.ts` and matches the in-app **/guide** page. Do not edit it by hand: change the source and run `UPDATE_DOCS=1 npx vitest run src/studio/guide`.",
    toc: "Contents",
    resources: "PDF, videos and links",
    pdf: "PDF guide",
    videos: "Videos",
    links: "Links",
    shortcuts: "Keyboard shortcuts",
    shortcutsNote: "Shortcuts can be changed on the Settings page.",
    key: "Key",
    action: "Action",
    faq: "Frequently asked questions",
    more: "More",
    other: "Türkçe sürüm",
    otherFile: "USER-GUIDE.md",
    tip: "Tip",
  },
} as const;

const DOCS: readonly [string, Record<Lang, string>][] = [
  [
    "ROOM.md",
    {
      tr: "Oda modu, sohbet ve güvenlik modeli",
      en: "Room mode, chat and the security model",
    },
  ],
  ["LIVE.md", { tr: "Canlı yayın köprüsü kurulumu", en: "Live bridge setup" }],
  [
    "COMMUNITY.md",
    {
      tr: "Topluluk kanalları kurulum rehberi",
      en: "Community channel setup guide",
    },
  ],
  [
    "BRANDING.md",
    { tr: "Marka ve görünüm özelleştirme", en: "Brand and look customization" },
  ],
  [
    "DOWNLOADS.md",
    {
      tr: "Uygulama olarak yükleme ve yerel kurulum dosyaları",
      en: "Installing as an app and native installers",
    },
  ],
  [
    "DEVICE-TESTING.md",
    {
      tr: "Cihaz ve tarayıcı test rehberi",
      en: "Device and browser test guide",
    },
  ],
  ["KAYNAKCA.md", { tr: "Kaynakça", en: "Bibliography" }],
];

const esc = (s: string) => s.replace(/\|/g, "\\|");

export function guideToMarkdown(lang: Lang, res: ResolvedResources): string {
  const t = T[lang];
  const out: string[] = [];
  out.push(
    `# ${t.title}`,
    "",
    `> ${t.generated}`,
    "",
    `[${t.other}](${t.otherFile})`,
    "",
  );

  out.push(`## ${t.toc}`, "");
  for (const s of GUIDE) out.push(`- [${s.icon} ${s[lang].title}](#${s.id})`);
  out.push(`- [${t.shortcuts}](#shortcuts)`, `- [${t.faq}](#faq)`);
  if (res.pdf.length + res.videos.length + res.links.length > 0)
    out.push(`- [${t.resources}](#resources)`);
  out.push(`- [${t.more}](#more)`, "");

  for (const s of GUIDE) {
    const x = s[lang];
    out.push(
      `<a name="${s.id}"></a>`,
      "",
      `## ${s.icon} ${x.title}`,
      "",
      x.summary,
      "",
    );
    x.steps.forEach((step, i) => out.push(`${i + 1}. ${step}`));
    out.push("");
    for (const tip of x.tips ?? []) out.push(`> 💡 **${t.tip}:** ${tip}`, "");
  }

  out.push(
    `<a name="shortcuts"></a>`,
    "",
    `## ⌨️ ${t.shortcuts}`,
    "",
    `| ${t.key} | ${t.action} |`,
    "| --- | --- |",
  );
  for (const k of guideShortcuts(lang))
    out.push(`| \`${k.keys}\` | ${esc(k.label)} |`);
  out.push("", t.shortcutsNote, "");

  out.push(`<a name="faq"></a>`, "", `## ❓ ${t.faq}`, "");
  for (const f of FAQ) out.push(`### ${f[lang].q}`, "", f[lang].a, "");

  if (res.pdf.length + res.videos.length + res.links.length > 0) {
    out.push(`<a name="resources"></a>`, "", `## 📎 ${t.resources}`, "");
    if (res.pdf.length) {
      out.push(`### ${t.pdf}`, "");
      for (const p of res.pdf) out.push(`- [${p.title}](${p.openUrl})`);
      out.push("");
    }
    if (res.videos.length) {
      out.push(`### ${t.videos}`, "");
      for (const v of res.videos)
        out.push(
          `- [${v.title}](${v.watchUrl})${v.duration ? ` (${v.duration})` : ""}`,
        );
      out.push("");
    }
    if (res.links.length) {
      out.push(`### ${t.links}`, "");
      for (const l of res.links)
        out.push(`- [${l.title}](${l.url})${l.note ? ` — ${l.note}` : ""}`);
      out.push("");
    }
  }

  out.push(`<a name="more"></a>`, "", `## ${t.more}`, "");
  for (const [file, label] of DOCS) out.push(`- [${label[lang]}](${file})`);
  out.push("");
  return out.join("\n");
}
