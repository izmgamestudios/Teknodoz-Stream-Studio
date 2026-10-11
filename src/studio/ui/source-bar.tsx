// src/studio/ui/source-bar.tsx
// Camera / screen / mic controls above the stage.
import { useEffect, useState } from "react";

import {
  useRuntimeSnapshot,
  useSources,
  useStudio,
} from "../runtime/use-studio";
import { BTN } from "./fields";

const ERROR_TEXT: Record<string, string> = {
  "camera-denied":
    "Kamera/mikrofon izni verilmedi. Tarayıcı adres çubuğundan izin verin.",
  "camera-unavailable": "Kamera bulunamadı veya başka uygulama kullanıyor.",
  "screen-denied": "Ekran paylaşımı reddedildi.",
  "capture-failed": "Yakalama başlatılamadı.",
  "asset-missing":
    "Bir görsel/video dosyası bulunamadı (kütüphaneden silinmiş olabilir).",
  unsupported: "Tarayıcınız bu özelliği desteklemiyor.",
};

export function SourceBar() {
  const rt = useStudio();
  const src = useSources();
  const snap = useRuntimeSnapshot();
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [camId, setCamId] = useState("");

  useEffect(() => {
    if (!src.webcam || !navigator.mediaDevices?.enumerateDevices) return;
    void navigator.mediaDevices
      .enumerateDevices()
      .then((d) => setCams(d.filter((x) => x.kind === "videoinput")));
  }, [src.webcam]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        className={
          src.webcam
            ? BTN
            : "inline-flex items-center gap-1.5 rounded-md bg-speaker-a px-3 py-1.5 text-xs font-bold text-background hover:opacity-90"
        }
        onClick={() =>
          src.webcam
            ? rt.sources.stopWebcam()
            : void rt.sources.startWebcam(camId || undefined)
        }
      >
        {src.webcam ? "📷 Kamerayı kapat" : "📷 Kamerayı aç"}
      </button>
      {src.webcam && cams.length > 1 && (
        <select
          aria-label="Kamera seç"
          className="rounded-md border bg-background px-2 py-1.5 text-xs"
          value={camId}
          onChange={(e) => {
            setCamId(e.target.value);
            void rt.sources.startWebcam(e.target.value || undefined);
          }}
        >
          <option value="">Varsayılan kamera</option>
          {cams.map((c) => (
            <option key={c.deviceId} value={c.deviceId}>
              {c.label || `Kamera ${c.deviceId.slice(0, 4)}`}
            </option>
          ))}
        </select>
      )}
      <button
        className={BTN}
        onClick={() =>
          src.screen ? rt.sources.stopScreen() : void rt.sources.startScreen()
        }
      >
        {src.screen ? "🖥 Paylaşımı durdur" : "🖥 Ekran paylaş"}
      </button>
      <button
        className={
          snap.micMuted
            ? "inline-flex items-center rounded-md bg-destructive px-3 py-1.5 text-xs font-bold text-primary-foreground"
            : BTN
        }
        aria-pressed={snap.micMuted}
        onClick={() => rt.toggleMicMuted()}
        title="Mikrofonu sustur (Shift+M)"
      >
        {snap.micMuted ? "🔇 Mikrofon kapalı" : "🎙 Mikrofon açık"}
      </button>
      {src.error && (
        <span
          role="alert"
          className="flex items-center gap-2 text-xs text-destructive"
        >
          {ERROR_TEXT[src.error.code] ?? "Bir hata oluştu."}
          <button className="underline" onClick={() => rt.sources.clearError()}>
            Kapat
          </button>
        </span>
      )}
    </div>
  );
}
