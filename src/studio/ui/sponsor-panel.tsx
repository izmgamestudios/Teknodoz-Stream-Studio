// src/studio/ui/sponsor-panel.tsx
// Studio panel: the sponsors / partners of THIS broadcast, which of them are shown on air, the
// on-air sponsor layer and the screen-time report.
import { useEffect, useRef, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { downloadBlob } from "../engine/download";
import { createLayer } from "../defaults";
import { getActiveScene } from "../project/store";
import { useProject, useStudio } from "../runtime/use-studio";
import { KIND_LABEL, TIER_COLOR } from "../sponsors/draw";
import { fmtDuration } from "../sponsors/report";
import {
  TEMPLATE_IMAGE_TYPES,
  TemplateUploadError,
  importTemplateImage,
} from "../templates/uploads";
import type { Sponsor, SponsorTier, SupporterKind } from "../types";
import { BTN, BTN_ACCENT, Check, INPUT, PANEL, PanelTitle } from "./fields";

const TIER_LABEL: Record<SponsorTier, string> = {
  title: "Ana sponsor",
  gold: "Altın",
  silver: "Gümüş",
  supporter: "Destekçi",
};

type Draft = Omit<Sponsor, "id">;
const EMPTY: Draft = {
  name: "",
  kind: "sponsor",
  tier: "silver",
  url: "",
  tagline: "",
  logoAssetId: "",
  onAir: true,
};

function useAssetUrl(assetId: string): string | null {
  const rt = useStudio();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    setUrl(null);
    if (assetId)
      void rt.assets.getUrl(assetId).then((u) => !off && setUrl(u ?? null));
    return () => {
      off = true;
    };
  }, [rt, assetId]);
  return url;
}

function Thumb({ assetId, name }: { assetId: string; name: string }) {
  const url = useAssetUrl(assetId);
  return (
    <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded bg-secondary text-xs font-bold">
      {url ? (
        <img
          src={url}
          alt=""
          className="max-h-full max-w-full object-contain"
        />
      ) : (
        (name.trim()[0] ?? "?").toUpperCase()
      )}
    </span>
  );
}

const UPLOAD_ERROR: Record<string, string> = {
  type: "PNG, JPEG, WebP, GIF veya AVIF yükleyin (SVG'yi PNG'ye çevirin).",
  size: "Görsel çok büyük (≤12 MB, ≤8192 px) ya da çok küçük.",
  decode: "Görsel okunamadı.",
  store: "Tarayıcı deposuna kaydedilemedi.",
};

function SponsorForm({
  draft,
  editingId,
  onClose,
}: {
  draft: Draft;
  editingId: string | null;
  onClose: () => void;
}) {
  const rt = useStudio();
  const [d, setD] = useState<Draft>(draft);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const logoUrl = useAssetUrl(d.logoAssetId);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setD((x) => ({ ...x, [k]: v }));

  const save = () => {
    setErr(null);
    const clean: Draft = {
      ...d,
      name: d.name.trim(),
      url: d.url.trim(),
      tagline: d.tagline.trim(),
    };
    const ok = editingId
      ? rt.project.updateSponsor(editingId, clean)
      : rt.project.addSponsor(clean) !== undefined;
    if (!ok) {
      setErr(
        "Kayıt geçersiz: ad boş olamaz, web sitesi http(s) olmalı (en çok 40 sponsor).",
      );
      return;
    }
    onClose();
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs sm:col-span-2">
          <span className="mb-1 block text-muted-foreground">Ad *</span>
          <input
            className={INPUT}
            maxLength={80}
            value={d.name}
            onChange={(e) => set("name", e.target.value)}
            autoFocus
          />
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">Tür</span>
          <select
            className={INPUT}
            value={d.kind}
            onChange={(e) => {
              const kind = e.target.value as SupporterKind;
              // investors are normally not shown on air
              setD((x) => ({
                ...x,
                kind,
                onAir: kind === "investor" ? false : x.onAir,
              }));
            }}
          >
            {(Object.keys(KIND_LABEL) as SupporterKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">
            Seviye (ekran süresi ağırlığı)
          </span>
          <select
            className={INPUT}
            value={d.tier}
            onChange={(e) => set("tier", e.target.value as SponsorTier)}
          >
            {(Object.keys(TIER_LABEL) as SponsorTier[]).map((t) => (
              <option key={t} value={t}>
                {TIER_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs sm:col-span-2">
          <span className="mb-1 block text-muted-foreground">Web sitesi</span>
          <input
            className={`${INPUT} font-mono`}
            inputMode="url"
            placeholder="https://"
            maxLength={300}
            value={d.url}
            onChange={(e) => set("url", e.target.value)}
          />
        </label>
        <label className="text-xs sm:col-span-2">
          <span className="mb-1 block text-muted-foreground">
            Slogan / açıklama (en çok 140)
          </span>
          <input
            className={INPUT}
            maxLength={140}
            value={d.tagline}
            onChange={(e) => set("tagline", e.target.value)}
          />
        </label>
      </div>

      <div className="flex items-center gap-2 rounded-md border p-2">
        <span className="flex size-14 items-center justify-center overflow-hidden rounded bg-secondary">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt=""
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <span aria-hidden="true">🖼</span>
          )}
        </span>
        <span className="flex-1 text-xs text-muted-foreground">
          Logo (şeffaf PNG önerilir). Tarayıcınızda saklanır ve{" "}
          <code>.pptdz</code> paketine girer.
        </span>
        <button
          type="button"
          className={BTN}
          onClick={() => fileRef.current?.click()}
        >
          {d.logoAssetId ? "Değiştir" : "Yükle"}
        </button>
        {d.logoAssetId && (
          <button
            type="button"
            className={BTN}
            onClick={() => set("logoAssetId", "")}
          >
            Kaldır
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          hidden
          aria-label="Sponsor logosu"
          accept={TEMPLATE_IMAGE_TYPES.join(",")}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            setErr(null);
            try {
              const img = await importTemplateImage(rt.assets, f, "logo");
              set("logoAssetId", img.id);
            } catch (x) {
              setErr(
                UPLOAD_ERROR[
                  x instanceof TemplateUploadError ? x.code : "decode"
                ] ?? "Yüklenemedi.",
              );
            }
          }}
        />
      </div>

      <Check checked={d.onAir} onChange={(v) => set("onAir", v)}>
        Yayında göster (sponsor katmanında dönüşümlü)
      </Check>
      {d.kind === "investor" && (
        <p className="text-[11px] text-muted-foreground">
          Yatırımcılar varsayılan olarak yayında gösterilmez; yalnızca
          raporda/kayıtta tutulur.
        </p>
      )}
      {err && (
        <p role="alert" className="text-xs text-destructive">
          {err}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button className={BTN} onClick={onClose}>
          Vazgeç
        </button>
        <button className={BTN_ACCENT} onClick={save}>
          {editingId ? "Kaydet" : "Ekle"}
        </button>
      </div>
    </div>
  );
}

export function SponsorPanel({ onSelect }: { onSelect: (id: string) => void }) {
  const rt = useStudio();
  const project = useProject();
  const sponsors = project.sponsors;
  const [form, setForm] = useState<{ id: string | null; draft: Draft } | null>(
    null,
  );
  const [tick, setTick] = useState(0);

  // screen-time numbers live outside the project store: refresh them while the panel is shown
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 2000);
    return () => window.clearInterval(id);
  }, []);
  const data = rt.sponsorExposure.snapshot();
  const onAir = rt.sponsorExposure.isOnAir;
  void tick;

  const addLayer = () => {
    const layer = createLayer("sponsor");
    rt.project.addLayer(getActiveScene(project).id, layer);
    onSelect(layer.id);
  };

  const exportReport = () => {
    const blob = new Blob([rt.sponsorReport()], {
      type: "text/csv;charset=utf-8",
    });
    const day = new Date().toISOString().slice(0, 10);
    downloadBlob(blob, `sponsor-raporu-${day}.csv`);
  };

  return (
    <section className={PANEL} aria-label="Sponsorlar">
      <PanelTitle
        aside={
          <button
            className={BTN}
            onClick={() => setForm({ id: null, draft: EMPTY })}
          >
            + Sponsor
          </button>
        }
      >
        Sponsorlar
      </PanelTitle>

      {sponsors.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Bu yayının sponsorlarını, iş ortaklarını ve iş birlikçilerini ekleyin;
          logoları yayında dönüşümlü gösterin ve sponsora ekranda kalma raporu
          verin.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {sponsors.map((s, i) => (
            <li
              key={s.id}
              className="flex items-center gap-2 rounded-md border p-1.5"
            >
              <Thumb assetId={s.logoAssetId} name={s.name} />
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() =>
                  setForm({
                    id: s.id,
                    draft: {
                      name: s.name,
                      kind: s.kind,
                      tier: s.tier,
                      url: s.url,
                      tagline: s.tagline,
                      logoAssetId: s.logoAssetId,
                      onAir: s.onAir,
                    },
                  })
                }
                title="Düzenle"
              >
                <span className="block truncate text-sm font-semibold">
                  {s.name}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  <span style={{ color: TIER_COLOR[s.tier] }}>●</span>{" "}
                  {TIER_LABEL[s.tier]} · {KIND_LABEL[s.kind]}
                </span>
                <span className="block truncate font-mono text-[10px] text-muted-foreground">
                  bu yayın {fmtDuration((data.sessionMs[s.id] ?? 0) / 1000)} ·
                  toplam {fmtDuration((data.totalMs[s.id] ?? 0) / 1000)}
                </span>
              </button>
              <label
                className="flex items-center gap-1 text-[11px]"
                title="Yayında göster"
              >
                <input
                  type="checkbox"
                  checked={s.onAir}
                  onChange={(e) =>
                    rt.project.updateSponsor(s.id, { onAir: e.target.checked })
                  }
                  aria-label={`${s.name} yayında göster`}
                />
                Yayın
              </label>
              <span className="flex flex-col">
                <button
                  aria-label="Yukarı"
                  className="px-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  disabled={i === 0}
                  onClick={() => rt.project.moveSponsor(i, i - 1)}
                >
                  ↑
                </button>
                <button
                  aria-label="Aşağı"
                  className="px-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  disabled={i === sponsors.length - 1}
                  onClick={() => rt.project.moveSponsor(i, i + 1)}
                >
                  ↓
                </button>
              </span>
              <button
                aria-label={`${s.name} sil`}
                className="px-1 text-destructive hover:opacity-80"
                onClick={() => {
                  if (window.confirm(`“${s.name}” silinsin mi?`))
                    rt.project.removeSponsor(s.id);
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          className={BTN_ACCENT}
          onClick={addLayer}
          title="Aktif sahneye sponsor katmanı ekler"
        >
          🏷 Sahneye ekle
        </button>
        <button
          className={BTN}
          disabled={sponsors.length === 0}
          onClick={exportReport}
        >
          Rapor (CSV)
        </button>
        <button
          className={BTN}
          onClick={() => {
            if (window.confirm("Tüm ekranda kalma sayaçları sıfırlansın mı?"))
              rt.clearSponsorExposure();
          }}
        >
          Sayaçları sıfırla
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {onAir
          ? "● Yayında: süreler sayılıyor. "
          : "Süreler yalnızca kayıt/canlı yayın sırasında sayılır. "}
        Bu <b>ekranda kalma süresidir</b>, izleyici sayısı değil; izleyici
        verisi için platformun istatistiğini ekleyin.
      </p>

      <Dialog open={form !== null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {form?.id ? "Sponsoru düzenle" : "Sponsor / ortak ekle"}
            </DialogTitle>
            <DialogDescription>
              Ana sponsor ekranda 3, altın 2, gümüş ve destekçi 1 birim süre
              kalır.
            </DialogDescription>
          </DialogHeader>
          {form && (
            <SponsorForm
              key={form.id ?? "new"}
              draft={form.draft}
              editingId={form.id}
              onClose={() => setForm(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
