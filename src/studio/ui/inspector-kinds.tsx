// src/studio/ui/inspector-kinds.tsx
// Kind-specific inspector fields.
import { useEffect, useState } from "react";

import { normalizePrototypeUrl } from "../proto";
import type { LayerPatch } from "../project/store";
import { useProject, useSources, useStudio } from "../runtime/use-studio";
import type { Layer } from "../types";
import {
  BTN,
  Check,
  ColorInput,
  Field,
  INPUT,
  NumInput,
  RangeInput,
  SelectInput,
} from "./fields";

type Patch = (p: LayerPatch, key?: string) => boolean;

const URL_ERRORS: Record<string, string> = {
  empty: "Adres boş.",
  "too-long": "Adres çok uzun.",
  invalid: "Geçersiz adres.",
  protocol: "Yalnızca http/https adresleri kullanılabilir.",
  credentials: "Adreste kullanıcı adı/şifre olamaz.",
};

export function KindFields({
  layer,
  sceneId,
  patch,
}: {
  layer: Layer;
  sceneId: string;
  patch: Patch;
}) {
  void sceneId;
  const rt = useStudio();
  const project = useProject();
  const sources = useSources();

  switch (layer.kind) {
    case "webcam":
      return (
        <div className="space-y-2">
          <Check
            checked={layer.mirror}
            onChange={(mirror) => patch({ mirror })}
          >
            Ayna (selfie) görüntü
          </Check>
          {!sources.webcam && (
            <p className="text-xs text-muted-foreground">
              Kamera kapalı. Üstteki “Kamerayı aç” düğmesini kullanın.
            </p>
          )}
        </div>
      );
    case "screen":
      return !sources.screen ? (
        <p className="text-xs text-muted-foreground">
          Ekran paylaşımı kapalı. Üstteki “Ekran paylaş” düğmesini kullanın.
        </p>
      ) : null;
    case "web":
      return <WebFields layer={layer} patch={patch} />;
    case "guest":
      return (
        <div className="space-y-2">
          <Field label="Etiket">
            <input
              className={INPUT}
              value={layer.label}
              maxLength={80}
              onChange={(e) => patch({ label: e.target.value })}
            />
          </Field>
          <p className="text-xs text-muted-foreground">
            Konuk katmanı, kulis (Green Room) panelinden “Yayına al” denince
            konuğun görüntüsüyle dolar.
          </p>
        </div>
      );
    case "image":
      return null;
    case "video":
      return (
        <div className="space-y-2">
          <Check checked={layer.loop} onChange={(loop) => patch({ loop })}>
            Döngü
          </Check>
          <Check checked={layer.muted} onChange={(muted) => patch({ muted })}>
            Sesi kapat
          </Check>
          <Field label={`Ses: %${Math.round(layer.volume * 100)}`}>
            <RangeInput
              label="Video sesi"
              min={0}
              max={1}
              step={0.01}
              value={layer.volume}
              onChange={(volume) => patch({ volume })}
            />
          </Field>
          <button
            className={BTN}
            onClick={() => rt.sources.toggleVideo(layer.id)}
          >
            ⏯ Oynat / duraklat
          </button>
        </div>
      );
    case "shape":
      return (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Şekil">
              <SelectInput
                value={layer.shape}
                options={[
                  { value: "banner", label: "Banner" },
                  { value: "rect", label: "Dikdörtgen" },
                  { value: "ellipse", label: "Elips" },
                ]}
                onChange={(shape) => patch({ shape })}
              />
            </Field>
            <Field label="Köşe yuvarlama">
              <NumInput
                value={layer.radius}
                min={0}
                max={500}
                onChange={(radius) => patch({ radius })}
              />
            </Field>
            <Field label="Dolgu">
              <ColorInput
                value={layer.fill}
                onChange={(fill) => patch({ fill })}
              />
            </Field>
            <Field label="Çizgi">
              <ColorInput
                value={layer.stroke}
                onChange={(stroke) => patch({ stroke })}
              />
            </Field>
            <Field label="Çizgi kalınlığı">
              <NumInput
                value={layer.strokeWidth}
                min={0}
                max={100}
                onChange={(strokeWidth) => patch({ strokeWidth })}
              />
            </Field>
            <Field label="Yazı rengi">
              <ColorInput
                value={layer.textColor}
                onChange={(textColor) => patch({ textColor })}
              />
            </Field>
          </div>
          <Field label="Yazı">
            <input
              className={INPUT}
              value={layer.text}
              maxLength={500}
              onChange={(e) => patch({ text: e.target.value })}
            />
          </Field>
        </div>
      );
    case "text":
      return (
        <div className="space-y-2">
          <Field label="Metin">
            <textarea
              className={`${INPUT} min-h-16 resize-y`}
              value={layer.text}
              maxLength={2000}
              onChange={(e) => patch({ text: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Stil">
              <SelectInput
                value={layer.style}
                options={[
                  { value: "plain", label: "Düz" },
                  { value: "banner", label: "Banner" },
                  { value: "subtitle", label: "Altyazı" },
                  { value: "ticker", label: "Kayan yazı" },
                ]}
                onChange={(style) => patch({ style })}
              />
            </Field>
            <Field label="Hizalama">
              <SelectInput
                value={layer.align}
                options={[
                  { value: "left", label: "Sol" },
                  { value: "center", label: "Orta" },
                  { value: "right", label: "Sağ" },
                ]}
                onChange={(align) => patch({ align })}
              />
            </Field>
            <Field label="Boyut (px)">
              <NumInput
                value={layer.fontSize}
                min={8}
                max={400}
                onChange={(fontSize) => patch({ fontSize })}
              />
            </Field>
            <Field label="Renk">
              <ColorInput
                value={layer.color}
                onChange={(color) => patch({ color })}
              />
            </Field>
            <Field label="Arka plan">
              <ColorInput
                value={layer.background}
                onChange={(background) => patch({ background })}
              />
            </Field>
            <div className="flex items-end gap-2">
              <button
                className={BTN}
                onClick={() => patch({ background: "transparent" })}
              >
                Şeffaf
              </button>
              <Check checked={layer.bold} onChange={(bold) => patch({ bold })}>
                Kalın
              </Check>
            </div>
          </div>
        </div>
      );
    case "prompter":
      return (
        <div className="space-y-2">
          <Field label="Burn-in modu">
            <SelectInput
              value={layer.mode}
              options={[
                { value: "subtitle", label: "Altyazı" },
                { value: "ticker", label: "Kayan şerit (ticker)" },
                { value: "notch", label: "Kamera altı (notch)" },
              ]}
              onChange={(mode) => patch({ mode })}
            />
          </Field>
          <Check
            checked={project.prompter.settings.burnIn}
            onChange={(burnIn) => rt.project.updatePrompterSettings({ burnIn })}
          >
            Prompter metnini videoya yaz (burn-in)
          </Check>
          <p className="text-xs text-muted-foreground">
            Kapalıyken metin yalnızca sizin ekranınızda (HUD) görünür ve kayda
            girmez.
          </p>
        </div>
      );
    case "chat":
      return (
        <div className="space-y-2">
          <Field label="Gösterim">
            <SelectInput
              value={layer.mode}
              options={[
                {
                  value: "spotlight",
                  label: "Yayındaki mesaj (reji seçer)",
                },
                { value: "feed", label: "Onaylı mesaj akışı" },
              ]}
              onChange={(mode) => patch({ mode })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Yazı boyutu">
              <NumInput
                value={layer.fontSize}
                min={8}
                max={400}
                step={2}
                onChange={(fontSize) => patch({ fontSize })}
              />
            </Field>
            {layer.mode === "feed" && (
              <Field label="Mesaj sayısı">
                <NumInput
                  value={layer.maxMessages}
                  min={1}
                  max={8}
                  step={1}
                  onChange={(maxMessages) => patch({ maxMessages })}
                />
              </Field>
            )}
            <Field label="Vurgu rengi">
              <ColorInput
                value={layer.accent}
                onChange={(accent) => patch({ accent })}
              />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">
            Oda sohbetindeki mesajlar önce editör/reji onayından geçer; yalnızca
            onaylananlar (ve “yayına al” denen mesaj) videoya girer. Oda
            kapalıyken katman boş kalır.
          </p>
        </div>
      );
  }
}

function UrlField({
  url,
  onApply,
}: {
  url: string;
  onApply: (url: string) => void;
}) {
  const [draft, setDraft] = useState(url);
  const [err, setErr] = useState("");
  useEffect(() => setDraft(url), [url]);
  return (
    <form
      className="space-y-1"
      onSubmit={(e) => {
        e.preventDefault();
        const r = normalizePrototypeUrl(draft);
        if (r.ok) {
          setErr("");
          setDraft(r.url);
          onApply(r.url);
        } else setErr(URL_ERRORS[r.reason] ?? "Geçersiz adres.");
      }}
    >
      <Field label="Prototip adresi">
        <div className="flex gap-1">
          <input
            className={INPUT}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="https://prototip.ornek.com"
            inputMode="url"
            aria-invalid={err !== ""}
          />
          <button className={BTN} type="submit">
            Uygula
          </button>
        </div>
      </Field>
      {err && (
        <p role="alert" className="text-xs text-destructive">
          {err}
        </p>
      )}
    </form>
  );
}

function WebFields({
  layer,
  patch,
}: {
  layer: Extract<Layer, { kind: "web" }>;
  patch: Patch;
}) {
  const rt = useStudio();
  const sources = useSources();
  const live = sources.webCaptures.includes(layer.id);
  return (
    <div className="space-y-2">
      <UrlField url={layer.url} onApply={(url) => patch({ url })} />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Cihaz çerçevesi">
          <SelectInput
            value={layer.frame}
            options={[
              { value: "mobile", label: "Mobil (9:16)" },
              { value: "desktop", label: "Masaüstü (16:9)" },
              { value: "none", label: "Çerçevesiz" },
            ]}
            onChange={(frame) => patch({ frame })}
          />
        </Field>
        <div className="flex items-end">
          <Check
            checked={layer.ripples}
            onChange={(ripples) => patch({ ripples })}
          >
            Dokunma efekti
          </Check>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {live ? (
          <button
            className={BTN}
            onClick={() => rt.sources.stopWebCapture(layer.id)}
          >
            ■ Yakalamayı durdur
          </button>
        ) : (
          <button
            className={BTN}
            onClick={() =>
              void rt.sources.startWebCapture(layer.id, undefined, "pick")
            }
          >
            🎯 Sekmeyi/pencereyi yakala
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Prototip görüntüsü ekran/sekme yakalamayla sahneye girer. Altta
        “Prototip” panelinden sayfayı gömüp bölgeyi otomatik kırpabilirsiniz.
      </p>
    </div>
  );
}
