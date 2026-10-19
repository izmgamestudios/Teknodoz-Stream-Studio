// src/studio/live/platforms.ts
// Destination presets for the RTMP(S) live bridge. Only YouTube and Facebook have a fixed,
// well-known ingest address; the other platforms hand out account/session specific server URLs
// (copy "Server URL" + "Stream key" from the platform's own live dashboard).

export type PlatformId =
  | "youtube"
  | "facebook"
  | "twitch"
  | "kick"
  | "instagram"
  | "tiktok"
  | "custom";

export interface Platform {
  id: PlatformId;
  name: string;
  icon: string;
  /** prefilled server URL ("" = copy it from the platform dashboard) */
  server: string;
  /** where to find the stream key */
  where: string;
  /** honest caveats shown under the form */
  note: string;
}

export const PLATFORMS: readonly Platform[] = [
  {
    id: "youtube",
    name: "YouTube",
    icon: "▶️",
    server: "rtmps://a.rtmps.youtube.com:443/live2",
    where:
      "YouTube Studio → Oluştur → Canlı yayın yap → Yayın ayarları → Yayın anahtarı",
    note: "Yedek sunucu: rtmps://b.rtmps.youtube.com:443/live2?backup=1. Kanalda canlı yayın etkin olmalı (ilk etkinleştirme ~24 saat sürebilir).",
  },
  {
    id: "facebook",
    name: "Facebook",
    icon: "📘",
    server: "rtmps://live-api-s.facebook.com:443/rtmp/",
    where: "Facebook Canlı Yayın Üreticisi → “Yayın anahtarı kullan”",
    note: "Anahtar kısa ömürlüdür; kalıcı anahtar seçeneğini açabilirsiniz.",
  },
  {
    id: "twitch",
    name: "Twitch",
    icon: "🎮",
    server: "",
    where:
      "Twitch → Creator Dashboard → Ayarlar → Yayın → Birincil yayın anahtarı; sunucu: dashboard'daki ingest listesi",
    note: "Sunucu adresini Twitch'in ingest listesinden kopyalayın (RTMPS destekli olanı tercih edin).",
  },
  {
    id: "kick",
    name: "Kick",
    icon: "🟢",
    server: "",
    where: "kick.com → Dashboard → Stream → RTMP URL ve Stream Key",
    note: "Sunucu adresi hesaba özeldir (…global-contribute.live-video.net).",
  },
  {
    id: "instagram",
    name: "Instagram",
    icon: "📸",
    server: "",
    where:
      "instagram.com → Oluştur → Canlı yayın → yayın anahtarı ve sunucu URL'si (Live Producer)",
    note: "Instagram bu seçeneği yalnızca uygun (genelde ≥1000 takipçili, herkese açık) hesaplara verir. Her yayında yeni anahtar üretilebilir.",
  },
  {
    id: "tiktok",
    name: "TikTok",
    icon: "🎵",
    server: "",
    where:
      "TikTok LIVE Producer / LIVE Studio → Akış ayarları → Sunucu URL'si ve Yayın anahtarı",
    note: "TikTok anahtarı yalnızca uygun hesaplara/bölgelere verir ve genellikle her oturumda yenilenir. Sunucu çoğu zaman şifresiz rtmp:// olur.",
  },
  {
    id: "custom",
    name: "Özel RTMP(S)",
    icon: "🔧",
    server: "",
    where:
      "Kendi ingest sunucunuzun (SRS, nginx-rtmp, Restream…) adresi ve anahtarı",
    note: "Sunucu yöneticisi bu ana bilgisayarı LIVE_ALLOWED_HOSTS ile izinli yapmış olmalıdır.",
  },
];

export function getPlatform(id: string): Platform {
  return (
    PLATFORMS.find((p) => p.id === id) ??
    (PLATFORMS[PLATFORMS.length - 1] as Platform)
  );
}

import { orientedSize } from "../format";

export interface Quality {
  id: string;
  label: string;
  width: number;
  height: number;
  fps: number;
  kbps: number;
  hint: string;
}

export const QUALITIES: readonly Quality[] = [
  {
    id: "480p30",
    label: "480p · 30 fps · 1,2 Mbps",
    width: 854,
    height: 480,
    fps: 30,
    kbps: 1200,
    hint: "Zayıf internet / çok düşük sunucu CPU'su",
  },
  {
    id: "720p30",
    label: "720p · 30 fps · 3 Mbps",
    width: 1280,
    height: 720,
    fps: 30,
    kbps: 3000,
    hint: "Önerilen başlangıç",
  },
  {
    id: "1080p30",
    label: "1080p · 30 fps · 6 Mbps",
    width: 1920,
    height: 1080,
    fps: 30,
    kbps: 6000,
    hint: "≈3 sunucu çekirdeği (x264 veryfast)",
  },
  {
    id: "1080p60",
    label: "1080p · 60 fps · 9 Mbps",
    width: 1920,
    height: 1080,
    fps: 60,
    kbps: 9000,
    hint: "Güçlü sunucu + ≥15 Mbps yükleme gerekir",
  },
];

/** The quality at the output's aspect ratio (vertical 9:16 swaps the axes, square uses the short side). */
export function orientQuality(q: Quality, outW: number, outH: number): Quality {
  const { width, height } = orientedSize(q, outW, outH);
  const tag =
    outH > outW * 1.02
      ? " · dikey"
      : Math.abs(outW / outH - 1) < 0.02
        ? " · kare"
        : "";
  return { ...q, width, height, label: `${q.label}${tag}` };
}

export function getQuality(id: string): Quality {
  return QUALITIES.find((q) => q.id === id) ?? (QUALITIES[1] as Quality);
}
