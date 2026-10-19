// src/studio/ui/supporters.tsx
// Project-level supporters wall, package overview and the application kit (sponsor, partner,
// collaborator, investor, media). Nothing is sent anywhere: the form only prepares an e-mail /
// WhatsApp draft that the visitor sends from their own app.
import { useState } from "react";

import {
  APPLICANT_LABEL,
  KIND_TITLE,
  PACKAGES,
  PROJECT_SUPPORTERS,
  applicationLinks,
  applicationText,
  validSupporters,
  type ApplicantKind,
} from "../community/supporters";
import { CREDITS } from "../credits";
import { TIER_COLOR } from "../sponsors/draw";
import type { SupporterKind } from "../types";
import { BTN, BTN_ACCENT, INPUT, PANEL, PanelTitle } from "./fields";

const KIND_ORDER: SupporterKind[] = [
  "sponsor",
  "partner",
  "collaborator",
  "investor",
];

const HINT: Record<ApplicantKind, string> = {
  sponsor: "Hangi paketle ilgilendiğinizi ve hedef kitlenizi yazın.",
  partner: "Entegrasyon, dağıtım veya ortak etkinlik fikrinizi yazın.",
  collaborator:
    "İçerik, eğitim veya şablon üretimi için ne önerdiğinizi yazın.",
  investor:
    "İlgi alanınızı ve görüşme için uygun zamanı yazın. Yatırım özeti talep edebilirsiniz.",
  media: "Yayın/haber konusunu ve tarihi yazın.",
};

export function SupportersSection() {
  const wall = validSupporters(PROJECT_SUPPORTERS);
  const [kind, setKind] = useState<ApplicantKind>("sponsor");
  const [name, setName] = useState("");
  const [org, setOrg] = useState("");
  const [contact, setContact] = useState("");
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);

  const input = { kind, name, org, contact, message };
  const links = applicationLinks(input);
  const ready = name.trim() !== "" && contact.trim() !== "";

  const copy = async () => {
    const t = applicationText(input);
    try {
      await navigator.clipboard.writeText(`${t.subject}\n\n${t.body}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // the draft opens in the mail app anyway
    }
  };

  return (
    <section
      className={`${PANEL} lg:col-span-2`}
      id="destekciler"
      aria-label="Destekçiler ve ortaklar"
    >
      <PanelTitle>Destekçiler, ortaklar ve iş birlikçiler</PanelTitle>

      {wall.length === 0 ? (
        <p className="mb-3 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          Bu duvar ilk sponsorunuzu, iş ortağınızı ve iş birlikçinizi bekliyor.
          Proje ücretsiz ve açık kaynaktır; destek, geliştirmeyi ve haftalık
          yayınları sürdürür.
        </p>
      ) : (
        <div className="mb-3 space-y-3">
          {KIND_ORDER.map((k) => {
            const list = wall.filter((s) => s.kind === k);
            if (list.length === 0) return null;
            return (
              <div key={k}>
                <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground">
                  {KIND_TITLE[k]}
                </p>
                <ul className="flex flex-wrap gap-2">
                  {list.map((s) => (
                    <li key={s.name + s.since}>
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer sponsored"
                        className="flex items-center gap-2 rounded-lg border px-3 py-2 hover:bg-accent"
                        style={{ borderColor: TIER_COLOR[s.tier] }}
                      >
                        {s.logo && (
                          <img
                            src={s.logo}
                            alt=""
                            className="h-8 w-auto max-w-28 object-contain"
                          />
                        )}
                        <span className="text-sm font-semibold">{s.name}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground">
        Sponsorluk paketleri (taslak, görüşülür)
      </p>
      <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {PACKAGES.map((p) => (
          <div
            key={p.tier}
            className="rounded-lg border p-3"
            style={{ borderTopColor: TIER_COLOR[p.tier], borderTopWidth: 3 }}
          >
            <p className="font-semibold">{p.name}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
              {p.benefits.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <form
          className="space-y-2"
          onSubmit={(e) => e.preventDefault()}
          aria-label="Başvuru kiti"
        >
          <p className="text-sm font-semibold">Konuşalım</p>
          <label className="block text-xs">
            <span className="mb-1 block text-muted-foreground">Konu</span>
            <select
              className={INPUT}
              value={kind}
              onChange={(e) => setKind(e.target.value as ApplicantKind)}
            >
              {(Object.keys(APPLICANT_LABEL) as ApplicantKind[]).map((k) => (
                <option key={k} value={k}>
                  {APPLICANT_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-xs">
              <span className="mb-1 block text-muted-foreground">Adınız *</span>
              <input
                className={INPUT}
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block text-muted-foreground">Kurum</span>
              <input
                className={INPUT}
                maxLength={80}
                value={org}
                onChange={(e) => setOrg(e.target.value)}
              />
            </label>
          </div>
          <label className="block text-xs">
            <span className="mb-1 block text-muted-foreground">
              E-posta / telefon *
            </span>
            <input
              className={INPUT}
              maxLength={120}
              value={contact}
              onChange={(e) => setContact(e.target.value)}
            />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block text-muted-foreground">Mesaj</span>
            <textarea
              className={`${INPUT} min-h-24`}
              maxLength={1200}
              placeholder={HINT[kind]}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-1.5">
            <a
              className={`${BTN_ACCENT} ${ready ? "" : "pointer-events-none opacity-50"}`}
              href={ready ? links.mailto : undefined}
              aria-disabled={!ready}
            >
              ✉️ E-posta taslağı aç
            </a>
            <a
              className={`${BTN} ${ready ? "" : "pointer-events-none opacity-50"}`}
              href={ready ? links.whatsapp : undefined}
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={!ready}
            >
              🟢 WhatsApp ile yaz
            </a>
            <button
              type="button"
              className={BTN}
              disabled={!ready}
              onClick={() => void copy()}
            >
              {copied ? "✓ Kopyalandı" : "Metni kopyala"}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Bu form hiçbir sunucuya veri göndermez: e-posta veya WhatsApp
            uygulamanızda bir taslak açar, göndermek sizin elinizdedir.
            Doğrudan: {CREDITS.email}
          </p>
        </form>

        <div className="space-y-2 text-sm">
          <p className="font-semibold">Kimler için?</p>
          <ul className="space-y-1.5 text-xs text-muted-foreground">
            <li>
              <b className="text-foreground">Sponsor:</b> geliştirici, içerik
              üreticisi ve eğitmen kitlesine ulaşmak isteyen markalar.
            </li>
            <li>
              <b className="text-foreground">İş ortağı:</b> barındırma, donanım,
              yayın ve eğitim platformları; entegrasyon ve ortak etkinlik.
            </li>
            <li>
              <b className="text-foreground">İş birlikçi:</b> eğitmenler,
              topluluk liderleri, şablon ve içerik üreticileri, katkıcılar.
            </li>
            <li>
              <b className="text-foreground">Yatırımcı:</b> ürünü ve ekibi
              tanımak isteyenler; yatırım özeti ve görüşme talebi için.
            </li>
          </ul>
          <p className="text-[11px] text-muted-foreground">
            Proje bağımsız ve açık kaynaktır (MIT): sponsorluk kod veya yol
            haritası üzerinde karar hakkı vermez. Ticari iş birliklerinde
            “sponsorlu / iş birliği” ibaresi kullanılır. Strateji ve süreç:{" "}
            <code>docs/STRATEGY.md</code>.
          </p>
        </div>
      </div>
    </section>
  );
}
