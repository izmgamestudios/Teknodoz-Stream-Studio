// src/studio/ui/template-dialog.tsx
// Picker for the broadcast frame templates (news, 2-up/4-up talk, tutorial, dual screen…).
import { useEffect, useMemo, useRef, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { FORMATS } from "../format";
import { useProject, useStudio } from "../runtime/use-studio";
import { TEMPLATES, TEMPLATE_GROUPS, getTemplate } from "../templates/catalog";
import type { TemplateMode, TemplateOptions } from "../templates/types";
import {
  TEMPLATE_IMAGE_TYPES,
  TemplateUploadError,
  importTemplateImage,
  loadRemembered,
  saveRemembered,
  type UploadedImage,
} from "../templates/uploads";
import { BTN, BTN_PRIMARY, ColorInput, Field, INPUT } from "./fields";
import { MyTemplates } from "./my-templates";
import { TemplatePreview } from "./template-preview";

const FIRST = TEMPLATES[0];

const UPLOAD_ERROR: Record<string, string> = {
  type: "Yalnızca PNG, JPEG, WebP, GIF veya AVIF yüklenebilir (SVG'yi PNG'ye çevirin).",
  size: "Görsel çok büyük (en çok 12 MB, en çok 8192 px) ya da çok küçük.",
  decode: "Görsel okunamadı.",
  store: "Görsel tarayıcı deposuna kaydedilemedi.",
};

/** One upload slot: pick a file, see it, remove it. */
function ImageSlot({
  label,
  hint,
  image,
  disabled,
  onPick,
  onClear,
}: {
  label: string;
  hint: string;
  image: UploadedImage | null;
  disabled?: boolean;
  onPick: (file: File) => void;
  onClear: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-md border p-2">
      <div className="flex items-center gap-2">
        <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded bg-secondary">
          {image ? (
            <img
              src={image.url}
              alt=""
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <span aria-hidden="true" className="text-lg opacity-50">
              🖼
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold">{label}</span>
          <span className="block text-[11px] text-muted-foreground">
            {disabled ? "Bu şablonda arka plan görünmez." : hint}
          </span>
        </span>
        <span className="flex flex-col gap-1">
          <button
            type="button"
            className={BTN}
            disabled={disabled}
            onClick={() => ref.current?.click()}
          >
            {image ? "Değiştir" : "Yükle"}
          </button>
          {image && (
            <button type="button" className={BTN} onClick={onClear}>
              Kaldır
            </button>
          )}
        </span>
      </div>
      <input
        ref={ref}
        type="file"
        hidden
        accept={TEMPLATE_IMAGE_TYPES.join(",")}
        aria-label={label}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onPick(f);
        }}
      />
    </div>
  );
}

export function TemplateDialog() {
  const rt = useStudio();
  const [open, setOpen] = useState(false);
  const [id, setId] = useState(FIRST?.id ?? "");
  const [opts, setOpts] = useState<TemplateOptions>(
    FIRST?.defaults ?? { accent: "#1d4ed8", title: "", tag: "", ticker: "" },
  );
  const [mode, setMode] = useState<TemplateMode>("new-scene");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logo, setLogo] = useState<UploadedImage | null>(null);
  const [bg, setBg] = useState<UploadedImage | null>(null);
  const def = getTemplate(id);
  const out = useProject().settings.output;
  const tplFormat = FORMATS.find((f) => f.id === (def?.format ?? "16:9"));
  const formatChange =
    tplFormat &&
    (tplFormat.width !== out.width || tplFormat.height !== out.height)
      ? tplFormat
      : null;

  // options + the uploaded images, as the builder wants them
  const effective = useMemo<TemplateOptions>(
    () => ({
      ...opts,
      ...(logo ? { logoAssetId: logo.id } : {}),
      ...(bg ? { backgroundAssetId: bg.id } : {}),
    }),
    [opts, logo, bg],
  );
  const assetUrls = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    if (logo) m[logo.id] = logo.url;
    if (bg) m[bg.id] = bg.url;
    return m;
  }, [logo, bg]);

  // bring back the logo / background used last time (when the files are still stored)
  useEffect(() => {
    if (!open) return;
    let off = false;
    void (async () => {
      const r = loadRemembered();
      const restore = async (assetId: string | undefined) => {
        if (!assetId || !(await rt.assets.get(assetId))) return null;
        const url = await rt.assets.getUrl(assetId);
        return url ? { id: assetId, url } : null;
      };
      const [l, b] = await Promise.all([
        restore(r.logoAssetId),
        restore(r.backgroundAssetId),
      ]);
      if (!off) {
        setLogo((cur) => cur ?? l);
        setBg((cur) => cur ?? b);
      }
    })();
    return () => {
      off = true;
    };
  }, [open, rt]);

  const upload = async (file: File, kind: "logo" | "background") => {
    setError(null);
    try {
      const img = await importTemplateImage(rt.assets, file, kind);
      if (kind === "logo") setLogo(img);
      else setBg(img);
      const r = loadRemembered();
      saveRemembered({
        ...r,
        ...(kind === "logo"
          ? { logoAssetId: img.id }
          : { backgroundAssetId: img.id }),
      });
    } catch (e) {
      setError(
        UPLOAD_ERROR[e instanceof TemplateUploadError ? e.code : "decode"] ??
          "Yüklenemedi.",
      );
    }
  };

  const clear = (kind: "logo" | "background") => {
    if (kind === "logo") setLogo(null);
    else setBg(null);
    const r = loadRemembered();
    if (kind === "logo") delete r.logoAssetId;
    else delete r.backgroundAssetId;
    saveRemembered(r);
  };

  const pick = (nextId: string) => {
    const d = getTemplate(nextId);
    if (!d) return;
    setId(nextId);
    setOpts(d.defaults);
    setError(null);
  };

  const apply = async () => {
    if (!def) return;
    setBusy(true);
    setError(null);
    const sceneId = await rt.applyTemplate(def.id, effective, mode);
    setBusy(false);
    if (sceneId) setOpen(false);
    else setError("Şablon uygulanamadı (sahne/katman sınırı?).");
  };

  const set = <K extends keyof TemplateOptions>(
    key: K,
    value: TemplateOptions[K],
  ) => setOpts((o) => ({ ...o, [key]: value }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className={BTN} title="Yayın çerçevesi şablonları">
          ▦ Şablon
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Yayın çerçevesi şablonları</DialogTitle>
          <DialogDescription>
            Haber, röportaj, 2'li/4'lü konuşma, mobil/masaüstü test, eğitim,
            çift ekran ve dikey (9:16), 4:5 ile kare sosyal medya düzenleri.
            Uygulanan şablon sıradan katmanlardan oluşur; sonradan dilediğin
            gibi düzenleyebilirsin.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <MyTemplates mode={mode} onApplied={() => setOpen(false)} />
            {TEMPLATE_GROUPS.map((g) => (
              <div key={g.id}>
                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground">
                  {g.label}
                </p>
                <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {TEMPLATES.filter((t) => t.group === g.id).map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => pick(t.id)}
                        aria-pressed={t.id === id}
                        className={`block w-full rounded-lg border p-2 text-left transition-colors ${
                          t.id === id
                            ? "border-speaker-b bg-speaker-b/10"
                            : "border-border hover:bg-accent"
                        }`}
                      >
                        <TemplatePreview def={t} />
                        <span className="mt-2 block text-sm font-semibold">
                          {t.name}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {t.description}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {def && (
            <aside className="space-y-3 lg:sticky lg:top-0 lg:self-start">
              <TemplatePreview
                def={def}
                options={effective}
                assetUrls={assetUrls}
              />
              {formatChange && (
                <p
                  role="status"
                  className="rounded-md bg-secondary p-2 text-[11px] leading-snug"
                >
                  Bu şablon <b>{formatChange.label}</b> ({formatChange.width}×
                  {formatChange.height}) içindir. Uygulayınca çıktı formatı
                  değişir ve mevcut sahneler yeni formata uyarlanır (Ctrl+Z ile
                  geri alınır).
                </p>
              )}
              <Field label="Tema rengi">
                <ColorInput
                  value={opts.accent}
                  onChange={(v) => set("accent", v)}
                />
              </Field>
              <Field label="Başlık">
                <input
                  className={INPUT}
                  maxLength={120}
                  value={opts.title}
                  onChange={(e) => set("title", e.target.value)}
                />
              </Field>
              {def.lowerThird && (
                <Field
                  label={def.topTitle ? "Alt bant yazısı" : "Etiket (kırmızı)"}
                >
                  <input
                    className={INPUT}
                    maxLength={60}
                    value={opts.tag}
                    onChange={(e) => set("tag", e.target.value)}
                  />
                </Field>
              )}
              {def.ticker && (
                <Field label="Kayan yazı">
                  <input
                    className={INPUT}
                    maxLength={300}
                    value={opts.ticker}
                    onChange={(e) => set("ticker", e.target.value)}
                  />
                </Field>
              )}
              <ImageSlot
                label="Logo"
                hint="Şablonun logo alanına yerleşir (en-boy oranı korunur; şeffaf PNG önerilir)."
                image={logo}
                onPick={(f) => void upload(f, "logo")}
                onClear={() => clear("logo")}
              />
              <ImageSlot
                label="Arka plan görseli"
                hint="Üretilen noktalı arka planın yerine ekranı doldurur (16:9 önerilir)."
                image={bg}
                disabled={!def.backdrop}
                onPick={(f) => void upload(f, "background")}
                onClear={() => clear("background")}
              />
              <fieldset className="space-y-1 text-sm">
                <legend className="mb-1 text-xs font-semibold text-muted-foreground">
                  Nereye uygulansın?
                </legend>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="tpl-mode"
                    checked={mode === "new-scene"}
                    onChange={() => setMode("new-scene")}
                  />
                  Yeni sahne olarak ekle
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="tpl-mode"
                    checked={mode === "replace-active"}
                    onChange={() => setMode("replace-active")}
                  />
                  Aktif sahnenin katmanlarını değiştir
                </label>
              </fieldset>
              {error && (
                <p role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              )}
              <button
                className={`${BTN_PRIMARY} w-full justify-center`}
                disabled={busy}
                onClick={() => void apply()}
              >
                {busy ? "Hazırlanıyor…" : "Şablonu uygula"}
              </button>
              <p className="text-[11px] text-muted-foreground">
                Konuk panelleri boş gelir: konuğu “Yayına al”dığında ilk boş
                panele otomatik yerleşir.
              </p>
            </aside>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
