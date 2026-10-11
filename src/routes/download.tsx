// src/routes/download.tsx
// Install the app: one-click PWA install where the browser offers it, step-by-step instructions per
// platform, native installer / store links when the owner configured them (downloads-config.ts),
// and a QR code to open the page on a phone.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { titleFromMatches } from "@/studio/branding/head";
import { CREDITS } from "@/studio/credits";
import { useLang } from "@/studio/i18n/use-t";
import {
  resolveDownloads,
  type DownloadProblem,
  type DownloadStatus,
} from "@/studio/pwa/downloads";
import { DOWNLOADS_CONFIG } from "@/studio/pwa/downloads-config";
import {
  PLATFORM_ICONS,
  PLATFORM_IDS,
  PLATFORM_NAMES,
  installSteps,
  type BrowserId,
  type DownloadTarget,
  type PlatformId,
} from "@/studio/pwa/platform";
import { useInstall } from "@/studio/pwa/use-install";
import { BrandBadge, BrandLogo, useBrand } from "@/studio/ui/brand-context";
import { CreditsFooter } from "@/studio/ui/credits";
import { BTN, BTN_ACCENT, PANEL, PanelTitle } from "@/studio/ui/fields";
import { QrImage } from "@/studio/ui/qr-image";

export const Route = createFileRoute("/download")({
  head: ({ matches }) => ({
    meta: [
      { title: titleFromMatches(matches, "İndir") },
      {
        name: "description",
        content:
          "Windows, macOS, Linux, Android ve iOS için uygulama olarak yükle: kurulum gerektirmeyen, otomatik güncellenen web uygulaması.",
      },
    ],
  }),
  component: DownloadPage,
});

type Lang = "tr" | "en";
const TXT = {
  eyebrow: { tr: "İndir", en: "Download" },
  title: { tr: "Uygulamayı yükle", en: "Install the app" },
  intro: {
    tr: "Windows, macOS, Linux, Android ve iOS'ta aynı uygulama: tarayıcıdan tek tıkla uygulama olarak yüklenir, kendi penceresinde açılır, kendiliğinden güncellenir. Mağaza ya da kurulum dosyası gerekmez.",
    en: "The same app on Windows, macOS, Linux, Android and iOS: install it from the browser in one click, it opens in its own window and updates itself. No store or installer file needed.",
  },
  yourDevice: { tr: "Cihazın", en: "Your device" },
  installNow: { tr: "Uygulamayı yükle", en: "Install the app" },
  installed: {
    tr: "✓ Yüklendi. Uygulamayı başlat menüsünden / ana ekrandan aç.",
    en: "✓ Installed. Open it from your start menu / home screen.",
  },
  running: {
    tr: "✓ Şu an uygulama olarak çalışıyor.",
    en: "✓ You are running the installed app.",
  },
  declined: {
    tr: "Yükleme iptal edildi; istediğinde yeniden deneyebilirsin.",
    en: "Installation was cancelled; you can try again any time.",
  },
  howTo: { tr: "Nasıl yüklenir?", en: "How to install" },
  platforms: { tr: "Platformlar", en: "Platforms" },
  web: { tr: "Web uygulaması", en: "Web app" },
  webOk: { tr: "Hazır — her tarayıcıda", en: "Ready — in any browser" },
  native: { tr: "Yerel uygulama", en: "Native app" },
  soon: { tr: "Henüz yok", en: "Not available yet" },
  store: { tr: "Mağazada aç", en: "Open in the store" },
  file: { tr: "İndir", en: "Download" },
  steps: { tr: "Kurulum adımları", en: "Install steps" },
  thisDevice: { tr: "bu cihaz", en: "this device" },
  phone: { tr: "Telefonda aç", en: "Open on your phone" },
  phoneBody: {
    tr: "Telefonunun kamerasıyla okut, sayfayı aç ve oradan yükle.",
    en: "Scan with your phone camera, open the page and install from there.",
  },
  notes: { tr: "Bilmen gerekenler", en: "Good to know" },
  status: { tr: "Bağlantı durumu", en: "Link status" },
  docs: { tr: "Ayrıntılı kılavuz (GitHub)", en: "Detailed guide (GitHub)" },
} satisfies Record<string, Record<Lang, string>>;

const NOTES: readonly Record<Lang, string>[] = [
  {
    tr: "Kamera, mikrofon ve ekran paylaşımı tarayıcıdaki gibi çalışır; yüklü uygulama için de izin istenir.",
    en: "Camera, microphone and screen sharing work as in the browser; the installed app asks for permission too.",
  },
  {
    tr: "iPhone/iPad'de tarayıcı ekran paylaşımı (getDisplayMedia) desteklenmez; konuk kamerası ve kumanda çalışır.",
    en: "iPhone/iPad browsers do not support screen sharing (getDisplayMedia); guest camera and remote control work.",
  },
  {
    tr: "Yayın, oda ve sohbet internet ister; çevrimdışıyken yalnızca bağlantı yok sayfası açılır.",
    en: "Streaming, rooms and chat need a connection; offline you only get the “no connection” page.",
  },
  {
    tr: "Projelerin ve ayarların cihazında saklanır (tarayıcı deposu); kaldırınca silinebilir — projeyi .pptdz olarak dışa aktar.",
    en: "Projects and settings live on your device (browser storage) and can be erased on uninstall — export the project as .pptdz.",
  },
  {
    tr: "Mağaza/yerel kurulum dosyaları ayrı birer yapıdır ve yalnızca yayınlandıklarında burada görünür.",
    en: "Store / native installers are separate builds and only appear here once published.",
  },
];

const PROBLEM: Record<DownloadProblem, Record<Lang, string>> = {
  invalid: { tr: "adres okunamadı", en: "address could not be read" },
  "not-https": { tr: "https:// olmalı", en: "must be https://" },
  credentials: {
    tr: "adreste kullanıcı/parola olamaz",
    en: "no credentials allowed in the address",
  },
  host: {
    tr: "izinli bir yayın/mağaza alan adı değil (extraHosts'a ekle)",
    en: "not an allowed release/store host (add it to extraHosts)",
  },
  "too-long": { tr: "çok uzun", en: "too long" },
  sha256: {
    tr: "sha256 64 hex karakter olmalı",
    en: "sha256 must be 64 hex characters",
  },
};

const DEFAULT_BROWSER: Record<DownloadTarget, BrowserId> = {
  windows: "chrome",
  macos: "chrome",
  linux: "chrome",
  android: "chrome",
  ios: "safari",
};

function NativeButton({
  status,
  lang,
}: {
  status: DownloadStatus;
  lang: Lang;
}) {
  const link = status.link;
  if (!link) {
    return (
      <p className="text-xs text-muted-foreground">
        {TXT.native[lang]}: {TXT.soon[lang]}
      </p>
    );
  }
  return (
    <div className="space-y-1">
      <a
        className={BTN_ACCENT}
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {link.label ??
          `${link.kind === "store" ? TXT.store[lang] : TXT.file[lang]}${link.format ? ` (${link.format})` : ""}`}
      </a>
      {link.version && (
        <p className="text-[11px] text-muted-foreground">v{link.version}</p>
      )}
      {link.sha256 && (
        <p className="break-all text-[10px] text-muted-foreground">
          SHA-256: <code>{link.sha256.toLowerCase()}</code>
        </p>
      )}
    </div>
  );
}

function PlatformCard({
  target,
  status,
  here,
  browser,
  lang,
}: {
  target: DownloadTarget;
  status: DownloadStatus;
  here: boolean;
  browser: BrowserId;
  lang: Lang;
}) {
  const steps = installSteps(target, here ? browser : DEFAULT_BROWSER[target]);
  return (
    <li
      className={`flex flex-col gap-3 rounded-xl border p-3 ${here ? "border-speaker-b bg-speaker-b/10" : ""}`}
      data-platform={target}
      data-here={here}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold">
          <span aria-hidden="true">{PLATFORM_ICONS[target]}</span>{" "}
          {PLATFORM_NAMES[target]}
        </p>
        {here && (
          <span className="rounded-full bg-speaker-b px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-background">
            {TXT.thisDevice[lang]}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {TXT.web[lang]}:{" "}
        <span className="text-foreground">{TXT.webOk[lang]}</span>
      </p>
      <NativeButton status={status} lang={lang} />
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          {TXT.steps[lang]}
        </summary>
        <ol className="mt-2 list-decimal space-y-1 pl-4 text-muted-foreground">
          {steps[lang].map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </details>
    </li>
  );
}

function DownloadPage() {
  const lang = useLang();
  const brand = useBrand();
  const inst = useInstall();
  const [declined, setDeclined] = useState(false);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const statuses = useMemo(
    () => resolveDownloads(DOWNLOADS_CONFIG, brand.siteUrl),
    [brand.siteUrl],
  );
  const byTarget = (t: DownloadTarget) =>
    statuses.find((s) => s.target === t) as DownloadStatus;
  const problems = statuses.filter((s) => s.problem);
  // this device first
  const order: DownloadTarget[] = [...PLATFORM_IDS].sort(
    (a, b) => Number(b === inst.platform) - Number(a === inst.platform),
  );
  const shareUrl = `${brand.siteUrl || origin}/download`;
  const steps = installSteps(inst.platform, inst.browser)[lang];

  return (
    <div className="min-h-screen p-3 md:p-6">
      <header className="mx-auto mb-4 max-w-5xl">
        <p className="text-xs uppercase tracking-[0.3em] text-speaker-b">
          {brand.name} · {TXT.eyebrow[lang]}
        </p>
        <h1 className="mt-1 flex flex-wrap items-center gap-3 text-3xl font-bold">
          {TXT.title[lang]}
          <BrandBadge />
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          {TXT.intro[lang]}
        </p>
      </header>

      <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[1fr_280px]">
        <div className="space-y-4">
          <section
            className={PANEL}
            aria-label={TXT.installNow[lang]}
            id="yukle"
          >
            <div className="mb-3 flex items-center gap-3">
              <BrandLogo className="text-xl" />
              {inst.ready && (
                <span className="text-xs text-muted-foreground">
                  {TXT.yourDevice[lang]}: {PLATFORM_ICONS[inst.platform]}{" "}
                  {PLATFORM_NAMES[inst.platform]}
                </span>
              )}
            </div>
            {inst.standalone || inst.installed ? (
              <p role="status" className="text-sm font-semibold text-speaker-b">
                {inst.installed ? TXT.installed[lang] : TXT.running[lang]}
              </p>
            ) : (
              <div className="space-y-3">
                {declined && (
                  <p role="status" className="text-xs text-muted-foreground">
                    {TXT.declined[lang]}
                  </p>
                )}
                {inst.canPrompt ? (
                  <button
                    className={BTN_ACCENT}
                    onClick={() => {
                      setDeclined(false);
                      void inst
                        .install()
                        .then((r) => setDeclined(r === "dismissed"));
                    }}
                  >
                    ⬇ {TXT.installNow[lang]}
                  </button>
                ) : (
                  <div>
                    <p className="mb-1 text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">
                      {TXT.howTo[lang]}
                    </p>
                    <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                      {steps.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            )}
          </section>

          <section
            className={PANEL}
            aria-label={TXT.platforms[lang]}
            id="platformlar"
          >
            <PanelTitle>{TXT.platforms[lang]}</PanelTitle>
            <ul className="grid gap-3 sm:grid-cols-2">
              {order.map((t) => (
                <PlatformCard
                  key={t}
                  target={t}
                  status={byTarget(t)}
                  here={inst.ready && t === inst.platform}
                  browser={inst.browser}
                  lang={lang}
                />
              ))}
            </ul>
          </section>

          {problems.length > 0 && (
            <section className={PANEL} aria-label={TXT.status[lang]} id="durum">
              <PanelTitle>{TXT.status[lang]}</PanelTitle>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {problems.map((s) => (
                  <li key={s.target}>
                    {PLATFORM_NAMES[s.target as PlatformId]}:{" "}
                    {PROBLEM[s.problem as DownloadProblem][lang]}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="space-y-4">
          <section className={PANEL} aria-label={TXT.phone[lang]} id="telefon">
            <PanelTitle>{TXT.phone[lang]}</PanelTitle>
            {origin || brand.siteUrl ? (
              <div className="flex flex-col items-center gap-2">
                <QrImage text={shareUrl} size={200} />
                <p className="text-center text-xs text-muted-foreground">
                  {TXT.phoneBody[lang]}
                </p>
                <code className="break-all text-center text-[10px] text-muted-foreground">
                  {shareUrl}
                </code>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">…</p>
            )}
          </section>

          <section className={PANEL} aria-label={TXT.notes[lang]} id="notlar">
            <PanelTitle>{TXT.notes[lang]}</PanelTitle>
            <ul className="list-disc space-y-2 pl-4 text-xs text-muted-foreground">
              {NOTES.map((n) => (
                <li key={n.en}>{n[lang]}</li>
              ))}
            </ul>
            <a
              className={`${BTN} mt-3`}
              href={`${CREDITS.repo}/blob/main/docs/DOWNLOADS.md`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {TXT.docs[lang]}
            </a>
          </section>
        </aside>
      </div>
      <CreditsFooter className="mx-auto mt-6 max-w-5xl border-t pt-3" />
    </div>
  );
}
