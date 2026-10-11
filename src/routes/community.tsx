// src/routes/community.tsx
// Community hub: where to join, announce a stream, channel setup status (and, soon, sponsors).
import { createFileRoute } from "@tanstack/react-router";

import { channelStatuses, type UrlProblem } from "@/studio/community/channels";
import { COMMUNITY_LINKS } from "@/studio/community/links";
import { CREDITS } from "@/studio/credits";
import { AnnounceCard } from "@/studio/ui/announce-card";
import { CreditsFooter } from "@/studio/ui/credits";
import { BTN, BTN_ACCENT, PANEL, PanelTitle } from "@/studio/ui/fields";

export const Route = createFileRoute("/community")({
  head: () => ({
    meta: [
      { title: "Topluluk — Teknodoz Studio" },
      {
        name: "description",
        content:
          "Teknodoz topluluk kanalları (WhatsApp, Telegram, Slack, LinkedIn, Facebook…) ve yayın duyurusu paylaşımı.",
      },
    ],
  }),
  component: CommunityPage,
});

const PROBLEM: Record<UrlProblem, string> = {
  empty: "boş",
  invalid: "adres okunamadı",
  "not-https": "https:// olmalı",
  credentials: "adreste kullanıcı/parola olamaz",
  host: "platformun kendi alan adı değil",
  path: "beklenen yol değil (ör. LinkedIn için /company/…)",
  "too-long": "çok uzun",
};

function CommunityPage() {
  const statuses = channelStatuses(COMMUNITY_LINKS);
  const active = statuses.filter((s) => s.url);
  const pending = statuses.filter((s) => !s.url);

  return (
    <div className="min-h-screen p-3 md:p-6">
      <header className="mx-auto mb-4 max-w-6xl">
        <p className="text-xs uppercase tracking-[0.3em] text-speaker-b">
          Teknodoz · DozCommunity
        </p>
        <h1 className="mt-1 text-3xl font-bold">Topluluk</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Güncellemeler, yayın duyuruları ve soru-cevap için kanallarımıza
          katılın. Proje ücretsiz ve açık kaynaktır; geri bildirim ve katkılar
          her kanalda memnuniyetle karşılanır.
        </p>
      </header>

      <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-2">
        <section className={PANEL} id="katil" aria-label="Kanallar">
          <PanelTitle>Katıl</PanelTitle>
          {active.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Henüz açık kanal yok.
            </p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {active.map(({ def, url }) => (
                <li
                  key={def.id}
                  className="flex flex-col justify-between gap-2 rounded-lg border p-3"
                >
                  <div>
                    <p className="font-semibold">
                      <span aria-hidden="true">{def.icon}</span> {def.name}
                    </p>
                    <p className="text-xs text-muted-foreground">{def.blurb}</p>
                  </div>
                  <a
                    className={BTN_ACCENT}
                    href={url as string}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Aç ↗
                  </a>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11px] text-muted-foreground">
            İş birliği, sponsorluk veya basın için:{" "}
            <a className="underline" href={`mailto:${CREDITS.email}`}>
              {CREDITS.email}
            </a>
          </p>
        </section>

        <AnnounceCard />

        <details className={`${PANEL} lg:col-span-2`} id="kurulum">
          <summary className="cursor-pointer text-sm font-semibold">
            Kurulum durumu (proje sahibi için) — {active.length}/
            {statuses.length} kanal bağlı
          </summary>
          <p className="mt-2 text-xs text-muted-foreground">
            Kanalı platformda oluşturduktan sonra adresini{" "}
            <code>src/studio/community/links.ts</code> dosyasına yazın; yalnızca
            platformun kendi alan adındaki https adresleri düğme olur. Adım adım
            rehber ve hazır metinler: <code>docs/COMMUNITY.md</code>.
          </p>
          <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
            {statuses.map(({ def, url, problem }) => (
              <li key={def.id} className="rounded-md border p-2">
                <span aria-hidden="true">{def.icon}</span> <b>{def.name}</b>{" "}
                {url ? (
                  <span className="text-speaker-b">✓ bağlı</span>
                ) : problem ? (
                  <span className="text-destructive">
                    ⚠ adres geçersiz: {PROBLEM[problem]}
                  </span>
                ) : (
                  <span className="text-muted-foreground">○ bekliyor</span>
                )}
                {!url && (
                  <p className="text-[11px] text-muted-foreground">
                    {def.create}
                  </p>
                )}
              </li>
            ))}
          </ul>
          {pending.length === 0 && (
            <p className="mt-2 text-xs">Tüm kanallar bağlı.</p>
          )}
          <p className="mt-2">
            <a
              className={BTN}
              href={`${CREDITS.repo}/issues`}
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub Issues
            </a>
          </p>
        </details>
      </div>

      <CreditsFooter className="mx-auto mt-6 max-w-6xl border-t pt-3" />
    </div>
  );
}
