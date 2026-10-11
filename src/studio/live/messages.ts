// src/studio/live/messages.ts
// Human readable (Turkish) text for live bridge errors. Pure, unit tested.
import type { LiveApiError } from "./api";
import type { LiveFailure } from "./streamer";

const REASON: Record<string, string> = {
  "host-not-allowed":
    "Bu sunucu adresi izinli değil. Yayın platformu adresleri yerleşiktir; başka bir ingest için sunucu yöneticisi LIVE_ALLOWED_HOSTS ayarına ekleyebilir.",
  "private-address":
    "Adres özel/yerel bir ağa çözülüyor; güvenlik nedeniyle engellendi.",
  "bad-url":
    "Sunucu adresi geçersiz. rtmps://host[:port]/uygulama biçiminde olmalı.",
  "bad-scheme":
    "Yalnızca rtmps:// (önerilir) veya rtmp:// adresleri kullanılabilir.",
  "bad-key": "Yayın anahtarı geçersiz karakter içeriyor ya da çok kısa/uzun.",
  "port-not-allowed":
    "Bu port izinli değil (80, 443, 1935, 1936, 3443, 8080, 8443).",
};

const CODE: Record<string, string> = {
  unavailable:
    "Bu barındırmada sunucu API'si yok (statik/serverless). Canlı yayın için tek bir Node süreci çalıştırın (bkz. docs/LIVE.md).",
  disabled:
    "Canlı yayın köprüsü bu sunucuda kapalı: LIVE_ADMIN_TOKEN tanımlı değil (en az 16 karakter).",
  network: "Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin.",
  forbidden: "Operatör anahtarı hatalı.",
  "rate-limited": "Çok fazla hatalı deneme. Biraz bekleyin.",
  busy: "Sunucuda zaten açık bir yayın var.",
  "bitrate-too-high": "Seçilen bit hızı sunucu sınırının üstünde.",
  "ffmpeg-missing":
    "Sunucuda ffmpeg bulunamadı: kurun (apt install ffmpeg) ya da root gerekmeyen statik derlemeyi kullanıp LIVE_FFMPEG_PATH ile gösterin (docs/LIVE.md).",
  ended: "Yayın sunucu tarafında sonlandı.",
  unsupported:
    "Bu tarayıcı tuval kaydını (MediaRecorder) desteklemiyor. Chrome/Edge/Firefox kullanın.",
  "no-video-track":
    "Program tuvalinden görüntü alınamadı. Stüdyo sayfasını bir kez açın.",
  "recorder-start-failed": "Tarayıcı kaydı başlatılamadı.",
  "recorder-error": "Tarayıcı kaydı hata verdi.",
  idle: "Tarayıcıdan uzun süre veri gelmedi; yayın durduruldu (sekme uykuya alınmış olabilir).",
  "max-duration": "Sunucudaki azami yayın süresi doldu.",
  ffmpeg: "Platform bağlantıyı reddetti ya da ffmpeg çöktü.",
  "not-found": "Yayın oturumu bulunamadı.",
  "bad-request": "İstek geçersiz.",
  server: "Sunucu hatası.",
};

export function describeCode(code: string, reason?: string): string {
  if (code === "bad-destination")
    return (reason && REASON[reason]) || "Hedef geçersiz.";
  if (code === "network" && reason === "backlog")
    return "Yükleme hızınız yetmedi (30 sn'den fazla birikti). Daha düşük kalite seçin.";
  return CODE[code] ?? "Beklenmeyen hata.";
}

export function describeApiError(e: LiveApiError): string {
  return describeCode(e.code, e.reason);
}

export function describeFailure(f: LiveFailure): string {
  const base = describeCode(f.code, f.reason);
  return f.index !== undefined && f.code === "bad-destination"
    ? `${String(f.index + 1)}. hedef: ${base}`
    : base;
}
