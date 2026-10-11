// src/studio/ui/template-dialog.tsx
// Picker for the broadcast frame templates (news, 2-up/4-up talk, tutorial, dual screen…).
import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { useStudio } from "../runtime/use-studio";
import { TEMPLATES, TEMPLATE_GROUPS, getTemplate } from "../templates/catalog";
import type { TemplateMode, TemplateOptions } from "../templates/types";
import { BTN, BTN_PRIMARY, ColorInput, Field, INPUT } from "./fields";
import { TemplatePreview } from "./template-preview";

const FIRST = TEMPLATES[0];

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
  const def = getTemplate(id);

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
    const sceneId = await rt.applyTemplate(def.id, opts, mode);
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
            Haber, 2'li/4'lü konuşma, mobil/masaüstü test, eğitim ve çift ekran
            düzenleri. Uygulanan şablon sıradan katmanlardan oluşur; sonradan
            dilediğin gibi düzenleyebilirsin.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
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
              <TemplatePreview def={def} options={opts} />
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
