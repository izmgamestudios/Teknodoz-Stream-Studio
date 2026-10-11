// src/routes/guide.tsx
// User guide: step-by-step sections, the Drive PDF and YouTube videos the owner configured
// (resources-config.ts; embeds load only after a click), shortcuts and FAQ. Same content as
// docs/USER-GUIDE*.md on GitHub (src/studio/guide/content.ts).
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { titleFromMatches } from "@/studio/branding/head";
import { CREDITS } from "@/studio/credits";
import { FAQ, GUIDE, type GuideSection } from "@/studio/guide/content";
import {
  resolveResources,
  type ResolvedPdf,
  type ResolvedVideo,
  type ResourceProblem,
} from "@/studio/guide/resources";
import { GUIDE_RESOURCES } from "@/studio/guide/resources-config";
import { guideShortcuts } from "@/studio/guide/shortcuts";
import { useLang } from "@/studio/i18n/use-t";
import { useBrand } from "@/studio/ui/brand-context";
import { CreditsFooter } from "@/studio/ui/credits";
import { BTN, BTN_ACCENT, INPUT, PANEL, PanelTitle } from "@/studio/ui/fields";

export const Route = createFileRoute("/guide")({
  head: ({ matches }) => ({
    meta: [
      { title: titleFromMatches(matches, "Kılavuz") },
      {
        name: "description",
        content:
          "Teknodoz Studio kullanım kılavuzu: prompter, stüdyo, oda, canlı yayın, topluluk ve kurulum adımları; PDF ve video kaynakları.",
      },
    ],
  }),
  component: GuidePage,
});

type Lang = "tr" | "en";
const TXT = {
  eyebrow: { tr: "Kılavuz", en: "Guide" },
  title: { tr: "Kullanım kılavuzu", en: "User guide" },
  intro: {
    tr: "Adım adım anlatım, PDF ve video kaynakları, kısayollar ve sık sorulan sorular. Aynı içerik GitHub'da da yayınlanır.",
    en: "Step by step instructions, PDF and video resources, shortcuts and FAQ. The same content is published on GitHub.",
  },
  search: { tr: "Kılavuzda ara…", en: "Search the guide…" },
  none: { tr: "Eşleşen bölüm yok.", en: "No matching section." },
  open: { tr: "Sayfayı aç", en: "Open page" },
  tip: { tr: "İpucu", en: "Tip" },
  resources: { tr: "PDF ve video", en: "PDF and video" },
  noResources: {
    tr: "PDF kılavuz ve eğitim videoları hazır olduğunda burada görünür.",
    en: "The PDF guide and tutorial videos will appear here when they are ready.",
  },
  pdf: { tr: "PDF kılavuz", en: "PDF guide" },
  videos: { tr: "Videolar", en: "Videos" },
  links: { tr: "Bağlantılar", en: "Links" },
  openPdf: { tr: "PDF'i aç", en: "Open PDF" },
  showPdf: { tr: "Sayfada göster", en: "Show on this page" },
  hidePdf: { tr: "Gizle", en: "Hide" },
  play: { tr: "Videoyu oynat", en: "Play video" },
  watchOn: { tr: "YouTube'da aç", en: "Open on YouTube" },
  privacy: {
    tr: "Video ve PDF önizlemesi tıklayana kadar yüklenmez; böylece sayfa açılırken Google/YouTube'a istek gitmez.",
    en: "Video and PDF previews load only after you click, so nothing is requested from Google/YouTube when the page opens.",
  },
  shortcuts: { tr: "Klavye kısayolları", en: "Keyboard shortcuts" },
  shortcutsNote: {
    tr: "Ayarlar'dan değiştirilebilir.",
    en: "Can be changed in Settings.",
  },
  faq: { tr: "Sık sorulan sorular", en: "Frequently asked questions" },
  status: { tr: "Kaynak durumu", en: "Resource status" },
  contents: { tr: "İçindekiler", en: "Contents" },
  github: { tr: "GitHub'da kılavuz", en: "Guide on GitHub" },
  bib: { tr: "Kaynakça", en: "Bibliography" },
} satisfies Record<string, Record<Lang, string>>;

const PROBLEM: Record<ResourceProblem, Record<Lang, string>> = {
  invalid: { tr: "adres okunamadı", en: "address could not be read" },
  "not-https": { tr: "https:// olmalı", en: "must be https://" },
  credentials: {
    tr: "adreste kullanıcı/parola olamaz",
    en: "no credentials allowed",
  },
  host: { tr: "beklenen alan adı değil", en: "not an expected host" },
  id: { tr: "dosya/video kimliği bulunamadı", en: "file / video id not found" },
  "too-long": { tr: "çok uzun", en: "too long" },
  title: { tr: "başlık boş ya da çok uzun", en: "title empty or too long" },
};

function matches(s: GuideSection, lang: Lang, q: string): boolean {
  if (!q) return true;
  const x = s[lang];
  return [x.title, x.summary, ...x.steps, ...(x.tips ?? [])]
    .join("\n")
    .toLocaleLowerCase(lang)
    .includes(q);
}

function VideoCard({ v, lang }: { v: ResolvedVideo; lang: Lang }) {
  const [play, setPlay] = useState(false);
  return (
    <li className="overflow-hidden rounded-lg border">
      <div className="relative aspect-video w-full bg-secondary">
        {play ? (
          <iframe
            src={v.embedUrl}
            title={v.title}
            className="absolute inset-0 h-full w-full"
            allow="encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          />
        ) : (
          <button
            type="button"
            className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-sm font-semibold hover:bg-accent"
            onClick={() => setPlay(true)}
            aria-label={`${TXT.play[lang]}: ${v.title}`}
          >
            <span aria-hidden="true" className="text-4xl text-speaker-b">
              ▶
            </span>
            {TXT.play[lang]}
          </button>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 p-2">
        <p className="min-w-0 truncate text-sm font-semibold">
          {v.title}
          {v.duration && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {v.duration}
            </span>
          )}
        </p>
        <a
          className="shrink-0 text-xs text-speaker-b underline"
          href={v.watchUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {TXT.watchOn[lang]}
        </a>
      </div>
    </li>
  );
}

function PdfCard({ p, lang }: { p: ResolvedPdf; lang: Lang }) {
  const [show, setShow] = useState(false);
  return (
    <li className="space-y-2 rounded-lg border p-3">
      <p className="text-sm font-semibold">
        <span aria-hidden="true">📄</span> {p.title}
      </p>
      <div className="flex flex-wrap gap-2">
        <a
          className={BTN_ACCENT}
          href={p.openUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {TXT.openPdf[lang]}
        </a>
        {p.embedUrl && (
          <button className={BTN} onClick={() => setShow((s) => !s)}>
            {show ? TXT.hidePdf[lang] : TXT.showPdf[lang]}
          </button>
        )}
      </div>
      {show && p.embedUrl && (
        <iframe
          src={p.embedUrl}
          title={p.title}
          className="h-[70vh] w-full rounded-md border bg-white"
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-popups"
        />
      )}
    </li>
  );
}

function GuidePage() {
  const lang = useLang();
  const brand = useBrand();
  const [query, setQuery] = useState("");
  const q = query.trim().toLocaleLowerCase(lang);
  const res = useMemo(
    () => resolveResources(GUIDE_RESOURCES, brand.siteUrl),
    [brand.siteUrl],
  );
  const sections = GUIDE.filter((s) => matches(s, lang, q));
  const faq = FAQ.filter(
    (f) =>
      !q || `${f[lang].q}\n${f[lang].a}`.toLocaleLowerCase(lang).includes(q),
  );
  const shortcuts = guideShortcuts(lang);
  const hasResources =
    res.pdf.length + res.videos.length + res.links.length > 0;

  return (
    <div className="min-h-screen p-3 md:p-6">
      <header className="mx-auto mb-4 max-w-6xl">
        <p className="text-xs uppercase tracking-[0.3em] text-speaker-b">
          {brand.name} · {TXT.eyebrow[lang]}
        </p>
        <h1 className="mt-1 text-3xl font-bold">{TXT.title[lang]}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          {TXT.intro[lang]}
        </p>
        <div className="mt-3 max-w-md">
          <input
            type="search"
            className={INPUT}
            value={query}
            placeholder={TXT.search[lang]}
            aria-label={TXT.search[lang]}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[220px_1fr]">
        <nav
          aria-label={TXT.contents[lang]}
          className="lg:sticky lg:top-3 lg:self-start"
        >
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground">
            {TXT.contents[lang]}
          </p>
          <ul className="flex flex-wrap gap-1.5 lg:flex-col lg:gap-0.5">
            {sections.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="block rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <span aria-hidden="true">{s.icon}</span> {s[lang].title}
                </a>
              </li>
            ))}
            {!q && (
              <>
                <li>
                  <a
                    href="#kisayollar"
                    className="block rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    ⌨️ {TXT.shortcuts[lang]}
                  </a>
                </li>
                <li>
                  <a
                    href="#sss"
                    className="block rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    ❓ {TXT.faq[lang]}
                  </a>
                </li>
              </>
            )}
          </ul>
        </nav>

        <main className="min-w-0 space-y-4">
          {!q && (
            <section
              className={PANEL}
              id="kaynaklar"
              aria-label={TXT.resources[lang]}
            >
              <PanelTitle>{TXT.resources[lang]}</PanelTitle>
              {!hasResources ? (
                <p className="text-sm text-muted-foreground">
                  {TXT.noResources[lang]}
                </p>
              ) : (
                <div className="space-y-4">
                  {res.pdf.length > 0 && (
                    <div>
                      <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                        {TXT.pdf[lang]}
                      </p>
                      <ul className="space-y-2">
                        {res.pdf.map((p) => (
                          <PdfCard key={p.openUrl} p={p} lang={lang} />
                        ))}
                      </ul>
                    </div>
                  )}
                  {res.videos.length > 0 && (
                    <div>
                      <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                        {TXT.videos[lang]}
                      </p>
                      <ul className="grid gap-3 sm:grid-cols-2">
                        {res.videos.map((v) => (
                          <VideoCard
                            key={v.videoId + v.title}
                            v={v}
                            lang={lang}
                          />
                        ))}
                      </ul>
                    </div>
                  )}
                  {res.links.length > 0 && (
                    <div>
                      <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                        {TXT.links[lang]}
                      </p>
                      <ul className="space-y-1 text-sm">
                        {res.links.map((l) => (
                          <li key={l.url}>
                            <a
                              className="text-speaker-b underline"
                              href={l.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {l.title}
                            </a>
                            {l.note && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                {l.note}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {(res.pdf.length > 0 || res.videos.length > 0) && (
                    <p className="text-[11px] text-muted-foreground">
                      {TXT.privacy[lang]}
                    </p>
                  )}
                </div>
              )}
              {res.issues.length > 0 && (
                <ul
                  className="mt-3 space-y-1 border-t pt-2 text-xs text-muted-foreground"
                  aria-label={TXT.status[lang]}
                >
                  {res.issues.map((i) => (
                    <li key={`${i.kind}-${i.index}`}>
                      {i.kind} #{i.index + 1}: {PROBLEM[i.problem][lang]}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {sections.length === 0 && faq.length === 0 && (
            <p role="status" className="text-sm text-muted-foreground">
              {TXT.none[lang]}
            </p>
          )}

          {sections.map((s) => {
            const x = s[lang];
            return (
              <section
                key={s.id}
                id={s.id}
                className={`${PANEL} scroll-mt-4`}
                aria-labelledby={`h-${s.id}`}
              >
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <h2 id={`h-${s.id}`} className="text-xl font-bold">
                    <span aria-hidden="true">{s.icon}</span> {x.title}
                  </h2>
                  {s.to && (
                    <Link to={s.to} className={BTN}>
                      {TXT.open[lang]} →
                    </Link>
                  )}
                </div>
                <p className="mb-3 text-sm text-muted-foreground">
                  {x.summary}
                </p>
                <ol className="list-decimal space-y-1.5 pl-5 text-sm">
                  {x.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                {x.tips && x.tips.length > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {x.tips.map((tip) => (
                      <li
                        key={tip}
                        className="rounded-md border border-speaker-b/30 bg-speaker-b/5 px-3 py-1.5 text-xs text-muted-foreground"
                      >
                        <b className="text-speaker-b">💡 {TXT.tip[lang]}:</b>{" "}
                        {tip}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}

          {!q && (
            <section
              className={`${PANEL} scroll-mt-4`}
              id="kisayollar"
              aria-label={TXT.shortcuts[lang]}
            >
              <PanelTitle>{TXT.shortcuts[lang]}</PanelTitle>
              <table className="w-full text-sm">
                <tbody>
                  {shortcuts.map((k) => (
                    <tr
                      key={k.keys + k.label}
                      className="border-b last:border-0"
                    >
                      <td className="w-40 py-1.5 pr-3">
                        <kbd className="rounded border bg-secondary px-1.5 py-0.5 font-mono text-xs">
                          {k.keys}
                        </kbd>
                      </td>
                      <td className="py-1.5 text-muted-foreground">
                        {k.label}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-muted-foreground">
                {TXT.shortcutsNote[lang]}
              </p>
            </section>
          )}

          {faq.length > 0 && (
            <section
              className={`${PANEL} scroll-mt-4`}
              id="sss"
              aria-label={TXT.faq[lang]}
            >
              <PanelTitle>{TXT.faq[lang]}</PanelTitle>
              <div className="space-y-1">
                {faq.map((f) => (
                  <details
                    key={f.id}
                    className="rounded-md border px-3 py-2 text-sm"
                    open={q !== ""}
                  >
                    <summary className="cursor-pointer font-semibold">
                      {f[lang].q}
                    </summary>
                    <p className="mt-1.5 text-muted-foreground">{f[lang].a}</p>
                  </details>
                ))}
              </div>
            </section>
          )}

          <div className="flex flex-wrap gap-2">
            <a
              className={BTN}
              href={`${CREDITS.repo}/blob/main/docs/USER-GUIDE${lang === "en" ? ".en" : ""}.md`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {TXT.github[lang]}
            </a>
            <a
              className={BTN}
              href={`${CREDITS.repo}/blob/main/docs/KAYNAKCA.md`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {TXT.bib[lang]}
            </a>
          </div>
        </main>
      </div>
      <CreditsFooter className="mx-auto mt-6 max-w-6xl border-t pt-3" />
    </div>
  );
}
