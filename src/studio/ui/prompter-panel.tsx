// src/studio/ui/prompter-panel.tsx
// Script editor + prompter controls (speed, size, mirror, display mode, burn-in, voice follow).
import { useRef, useState } from "react";

import {
  PRIVACY_NOTE,
  SCRIPT_FILE_ACCEPT,
  isVoiceFollowSupported,
  readClipboardText,
  readScriptFile,
  type VoiceFollowErrorCode,
} from "../prompter";
import {
  usePrompterState,
  useProject,
  useRuntimeSnapshot,
  useStudio,
} from "../runtime/use-studio";
import {
  BTN,
  BTN_ACCENT,
  Check,
  Field,
  INPUT,
  PANEL,
  PanelTitle,
  RangeInput,
  SelectInput,
} from "./fields";
import { NotchView, PrompterView } from "./prompter-view";

const SAMPLE = `Herkese merhaba! Bugün tarayıcıda çalışan, sunucusuz bir yayın stüdyosunu tanıtıyorum.
Kamera, mikrofon ve ekran görüntüsü cihazınızdan dışarı çıkmıyor.
Metni kaydırırken kameraya bakmaya devam edin; sesle takip açıksa metin siz konuştukça akar.
Teşekkürler, bir sonraki videoda görüşmek üzere!`;

const VOICE_ERRORS: Partial<Record<VoiceFollowErrorCode, string>> = {
  unsupported:
    "Bu tarayıcı konuşma tanımayı desteklemiyor (Chrome/Edge önerilir).",
  "not-allowed": "Mikrofon izni verilmedi.",
  "audio-capture": "Mikrofon bulunamadı.",
  "language-not-supported": "Seçilen dil desteklenmiyor.",
  network: "Konuşma tanıma servisine ulaşılamadı.",
};

export function PrompterPanel({
  showPreview = true,
}: {
  showPreview?: boolean;
}) {
  const rt = useStudio();
  const project = useProject();
  const engine = usePrompterState();
  const snap = useRuntimeSnapshot();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState("");
  const { script, settings } = project.prompter;
  const model = rt.getScriptModel();
  const set = rt.project.updatePrompterSettings;
  const minutes = model.wordCount / 150;

  async function onFile(f: File) {
    try {
      rt.project.setPrompterScript(await readScriptFile(f));
      rt.prompter.rewind();
      setMsg("");
    } catch (e) {
      const code = (e as { code?: string }).code;
      setMsg(
        code === "too-large"
          ? "Dosya çok büyük (en fazla 5 MB)."
          : "Dosya okunamadı (.txt, .md, .srt veya .docx deneyin).",
      );
    }
  }

  return (
    <section className={PANEL} aria-label="Prompter">
      <PanelTitle
        aside={
          <span className="text-[11px] text-muted-foreground">
            {model.wordCount} sözcük · ≈{" "}
            {minutes < 1 ? "<1" : Math.round(minutes)} dk
          </span>
        }
      >
        Prompter
      </PanelTitle>

      <div className="mb-2 flex flex-wrap gap-1.5">
        <button className={BTN} onClick={() => fileRef.current?.click()}>
          📄 Dosya (.txt/.docx)
        </button>
        <button
          className={BTN}
          onClick={async () => {
            try {
              rt.project.setPrompterScript(await readClipboardText());
              rt.prompter.rewind();
              setMsg("");
            } catch {
              setMsg(
                "Panoya erişilemedi. Metni doğrudan kutuya yapıştırın (Ctrl+V).",
              );
            }
          }}
        >
          📋 Panodan yapıştır
        </button>
        <button
          className={BTN}
          onClick={() => rt.project.setPrompterScript(SAMPLE)}
        >
          Örnek metin
        </button>
        <button
          className={BTN}
          onClick={() => rt.project.setPrompterScript("")}
          disabled={script === ""}
        >
          Temizle
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={SCRIPT_FILE_ACCEPT}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void onFile(f);
          }}
        />
      </div>
      {msg && (
        <p role="alert" className="mb-2 text-xs text-destructive">
          {msg}
        </p>
      )}

      <textarea
        className={`${INPUT} h-40 resize-y font-mono`}
        value={script}
        placeholder={
          "Metni buraya yazın veya yapıştırın.\nİki kişilik diyalog için satırları A: ve B: ile başlatın."
        }
        onChange={(e) => rt.project.setPrompterScript(e.target.value)}
        aria-label="Prompter metni"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className={BTN_ACCENT}
          onClick={() => rt.prompter.toggle()}
          title="Başlat/durdur (Boşluk)"
        >
          {engine.playing ? "❚❚ Durdur" : "▶ Kaydır"}
        </button>
        <button
          className={BTN}
          onClick={() => rt.prompter.rewind()}
          title="Başa dön (R)"
        >
          ⏮ Başa
        </button>
        <span className="text-xs tabular-nums text-muted-foreground">
          {engine.held && engine.playing
            ? "konuşma bekleniyor…"
            : `${Math.round(engine.speedPx)} px/sn`}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label={`Hız: ${settings.speedPx} px/sn (↑/↓)`}>
          <RangeInput
            label="Hız"
            min={0}
            max={300}
            value={settings.speedPx}
            onChange={(speedPx) => set({ speedPx })}
          />
        </Field>
        <Field label={`Yazı boyutu: ${settings.fontSize}px`}>
          <RangeInput
            label="Yazı boyutu"
            min={20}
            max={120}
            value={settings.fontSize}
            onChange={(fontSize) => set({ fontSize })}
          />
        </Field>
        <Field label={`Satır aralığı: ${settings.lineHeight.toFixed(1)}`}>
          <RangeInput
            label="Satır aralığı"
            min={1}
            max={2.4}
            step={0.1}
            value={settings.lineHeight}
            onChange={(lineHeight) => set({ lineHeight })}
          />
        </Field>
        <Field label={`Kontrast: %${Math.round(settings.contrast * 100)}`}>
          <RangeInput
            label="Kontrast"
            min={0}
            max={1}
            step={0.05}
            value={settings.contrast}
            onChange={(contrast) => set({ contrast })}
          />
        </Field>
        <Field label="Görünüm">
          <SelectInput
            value={settings.display}
            options={[
              { value: "hud", label: "HUD (tam metin)" },
              { value: "notch", label: "Kamera altı (1–2 satır)" },
            ]}
            onChange={(display) => set({ display })}
          />
        </Field>
        <div className="flex items-end">
          <Check
            checked={settings.mirror}
            onChange={(mirror) => set({ mirror })}
          >
            Ayna (ters çevir)
          </Check>
        </div>
      </div>

      <fieldset className="mt-3 space-y-2 rounded-lg border p-2">
        <legend className="px-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Kayda yazdır (burn-in)
        </legend>
        <Check checked={settings.burnIn} onChange={(burnIn) => set({ burnIn })}>
          Metni videoya göm
        </Check>
        <p className="text-[11px] text-muted-foreground">
          Kapalıyken (varsayılan) metin yalnızca bu ekranda görünür, kayıtta yer
          almaz. Açıkken sahnedeki “Prompter (burn-in)” katmanı metni altyazı /
          kayan şerit / notch olarak çizer.
        </p>
        <Field label="Burn-in biçimi">
          <SelectInput
            value={settings.burnInMode}
            options={[
              { value: "subtitle", label: "Altyazı" },
              { value: "ticker", label: "Kayan şerit (ticker)" },
              { value: "notch", label: "Kamera altı (notch)" },
            ]}
            onChange={(burnInMode) => set({ burnInMode })}
          />
        </Field>
      </fieldset>

      <fieldset className="mt-3 space-y-2 rounded-lg border p-2">
        <legend className="px-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Sesle takip
        </legend>
        <div className="flex flex-wrap items-center gap-3">
          <Check
            checked={snap.voice.active}
            onChange={(on) => {
              set({ voiceFollow: on });
              rt.setVoiceFollow(on);
            }}
          >
            Konuştukça kaydır
          </Check>
          <select
            aria-label="Konuşma dili"
            className="rounded-md border bg-background px-2 py-1 text-xs"
            value={settings.voiceLang}
            onChange={(e) => set({ voiceLang: e.target.value })}
          >
            <option value="tr-TR">Türkçe</option>
            <option value="en-US">English (US)</option>
            <option value="en-GB">English (UK)</option>
            <option value="de-DE">Deutsch</option>
          </select>
          {snap.voice.active && (
            <span
              className={`text-xs ${snap.voice.speaking ? "text-speaker-b" : "text-muted-foreground"}`}
            >
              {snap.voice.speaking ? "● dinliyor" : "○ sessiz — metin bekliyor"}
            </span>
          )}
        </div>
        {!isVoiceFollowSupported() && (
          <p className="text-xs text-primary">{VOICE_ERRORS.unsupported}</p>
        )}
        {snap.voice.error && snap.voice.error !== "no-speech" && (
          <p role="alert" className="text-xs text-destructive">
            {VOICE_ERRORS[snap.voice.error] ?? "Sesle takip hatası."}
          </p>
        )}
        <p className="text-[11px] text-muted-foreground">{PRIVACY_NOTE}</p>
      </fieldset>

      {showPreview && settings.display === "hud" && (
        <PrompterView className="mt-3 h-72" />
      )}
      {settings.display === "notch" && <NotchView />}
      <p className="mt-2 text-[11px] text-muted-foreground">
        Kısayollar: <kbd className="rounded border px-1">Boşluk</kbd>{" "}
        başlat/durdur · <kbd className="rounded border px-1">↑</kbd>/
        <kbd className="rounded border px-1">↓</kbd> hız ·{" "}
        <kbd className="rounded border px-1">R</kbd> başa dön
      </p>
    </section>
  );
}
