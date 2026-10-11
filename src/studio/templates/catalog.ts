// src/studio/templates/catalog.ts
// The built-in broadcast frame templates. Geometry is in the 1920x1080 logical stage.
import type { PanelSpec, TemplateDef, TemplateOptions } from "./types";

const BLUE = "#1d4ed8";
const TEAL = "#0e9f8e";
const VIOLET = "#7c3aed";
const ORANGE = "#ea6a12";

const opts = (
  accent: string,
  title: string,
  tag: string,
  ticker: string,
): TemplateOptions => ({ accent, title, tag, ticker });

const TICKER =
  "Teknodoz Studio ile canlı yayındasınız • Ücretsiz, açık kaynak, tarayıcıda çalışır";

const cam = (
  id: string,
  label: string,
  x: number,
  y: number,
  w: number,
  h: number,
): PanelSpec => ({ id, kind: "webcam", label, rect: { x, y, w, h } });

const guest = (
  id: string,
  label: string,
  x: number,
  y: number,
  w: number,
  h: number,
): PanelSpec => ({ id, kind: "guest", label, rect: { x, y, w, h } });

export const TEMPLATES: readonly TemplateDef[] = [
  {
    id: "news",
    name: "Haber / Breaking News",
    description: "Sunucu + büyük görüntü paneli, alt bant ve kayan yazı.",
    group: "news",
    panels: [
      cam("presenter", "Sunucu", 80, 80, 600, 700),
      {
        id: "footage",
        kind: "screen",
        label: "Haber görüntüsü",
        rect: { x: 720, y: 80, w: 1120, h: 630 },
      },
    ],
    backdrop: true,
    frames: true,
    captions: false,
    topTitle: false,
    lowerThird: { x: 80, y: 800, w: 1000 },
    logo: { x: 1600, y: 790, w: 240, h: 170 },
    ticker: true,
    defaults: opts(BLUE, "BREAKING NEWS", "EXCLUSIVE coverage", TICKER),
  },
  {
    id: "solo",
    name: "Solo – yakın plan",
    description: "Tam ekran kamera, köşede isim bandı.",
    group: "talk",
    panels: [cam("host", "Sunucu", 0, 0, 1920, 1080)],
    backdrop: false,
    frames: false,
    captions: false,
    topTitle: false,
    lowerThird: { x: 100, y: 830, w: 900 },
    logo: { x: 1660, y: 40, w: 220, h: 120 },
    ticker: false,
    defaults: opts(TEAL, "Ad Soyad", "SUNUCU", TICKER),
  },
  {
    id: "mobile",
    name: "Mobil test",
    description: "Telefon çerçevesinde prototip + yanında sunucu kamerası.",
    group: "demo",
    panels: [
      {
        id: "phone",
        kind: "web",
        label: "Mobil prototip",
        rect: { x: 110, y: 60, w: 444, h: 960 },
        frame: "mobile",
      },
      cam("presenter", "Sunucu", 620, 80, 1180, 664),
    ],
    backdrop: true,
    frames: false,
    captions: false,
    topTitle: false,
    lowerThird: { x: 620, y: 790, w: 1000 },
    logo: { x: 1640, y: 790, w: 200, h: 160 },
    ticker: true,
    defaults: opts(VIOLET, "MOBİL TEST", "CANLI DEMO", TICKER),
  },
  {
    id: "desktop",
    name: "Masaüstü prototip",
    description: "Tarayıcı çerçevesinde prototip, sağda kamera.",
    group: "demo",
    panels: [
      {
        id: "browser",
        kind: "web",
        label: "Masaüstü prototip",
        rect: { x: 60, y: 60, w: 1440, h: 810 },
        frame: "desktop",
      },
      cam("presenter", "Sunucu", 1540, 60, 320, 320),
    ],
    backdrop: true,
    frames: false,
    captions: false,
    topTitle: false,
    lowerThird: { x: 60, y: 900, w: 1000 },
    logo: { x: 1540, y: 420, w: 320, h: 220 },
    ticker: false,
    defaults: opts(BLUE, "MASAÜSTÜ DEMO", "PROTOTİP", TICKER),
  },
  {
    id: "duo",
    name: "2'li konuşma",
    description: "İki eşit panel: sunucu ve konuk.",
    group: "talk",
    panels: [
      cam("host", "Sunucu", 40, 150, 900, 640),
      guest("guest1", "Konuk 1", 980, 150, 900, 640),
    ],
    backdrop: true,
    frames: true,
    captions: true,
    topTitle: true,
    logo: { x: 1640, y: 8, w: 260, h: 80 },
    ticker: true,
    defaults: opts(TEAL, "CANLI SOHBET", "", TICKER),
  },
  {
    id: "quad",
    name: "4'lü konuşma",
    description: "2×2 ızgara: sunucu + üç konuk.",
    group: "talk",
    panels: [
      cam("host", "Sunucu", 40, 20, 910, 512),
      guest("guest1", "Konuk 1", 970, 20, 910, 512),
      guest("guest2", "Konuk 2", 40, 548, 910, 512),
      guest("guest3", "Konuk 3", 970, 548, 910, 512),
    ],
    backdrop: true,
    frames: true,
    captions: false,
    topTitle: false,
    logo: { x: 1700, y: 30, w: 170, h: 90 },
    ticker: false,
    defaults: opts(VIOLET, "PANEL", "", TICKER),
  },
  {
    id: "podcast",
    name: "Podcast (3 kişi)",
    description: "Üç dikey panel, başlık şeridi ve kayan yazı.",
    group: "talk",
    panels: [
      cam("host", "Sunucu", 60, 120, 580, 720),
      guest("guest1", "Konuk 1", 670, 120, 580, 720),
      guest("guest2", "Konuk 2", 1280, 120, 580, 720),
    ],
    backdrop: true,
    frames: true,
    captions: true,
    topTitle: true,
    logo: { x: 1640, y: 8, w: 260, h: 80 },
    ticker: true,
    defaults: opts(ORANGE, "PODCAST", "", TICKER),
  },
  {
    id: "tutorial",
    name: "Eğitim videosu",
    description: "Büyük ekran paylaşımı, sağda eğitmen ve ders notları.",
    group: "learn",
    panels: [
      {
        id: "screen",
        kind: "screen",
        label: "Ekran paylaşımı",
        rect: { x: 40, y: 120, w: 1300, h: 731 },
      },
      cam("teacher", "Eğitmen", 1380, 120, 500, 731),
    ],
    backdrop: true,
    frames: true,
    captions: false,
    topTitle: true,
    lowerThird: { x: 40, y: 890, w: 1100 },
    logo: { x: 1640, y: 8, w: 260, h: 80 },
    ticker: false,
    defaults: opts(TEAL, "Bölüm 1 – Giriş", "DERS 1", TICKER),
  },
  {
    id: "dual-screen",
    name: "Çift ekran paylaşımı",
    description: "Yan yana iki ekran/prototip, altta sunucu.",
    group: "learn",
    panels: [
      {
        id: "screen1",
        kind: "screen",
        label: "Ekran 1",
        rect: { x: 40, y: 110, w: 900, h: 506 },
      },
      {
        id: "screen2",
        kind: "web",
        label: "Ekran 2",
        rect: { x: 980, y: 110, w: 900, h: 506 },
        frame: "desktop",
      },
      cam("presenter", "Sunucu", 40, 650, 330, 330),
    ],
    backdrop: true,
    frames: true,
    captions: false,
    topTitle: true,
    lowerThird: { x: 410, y: 894, w: 1100 },
    logo: { x: 1640, y: 8, w: 260, h: 80 },
    ticker: false,
    defaults: opts(BLUE, "ÇİFT EKRAN", "KARŞILAŞTIRMA", TICKER),
  },
  {
    id: "presentation",
    name: "Sunum + konuşmacı",
    description: "Slayt/ekran büyük, sağ üstte konuşmacı.",
    group: "learn",
    panels: [
      {
        id: "slides",
        kind: "screen",
        label: "Sunum",
        rect: { x: 40, y: 40, w: 1360, h: 765 },
      },
      cam("speaker", "Konuşmacı", 1440, 40, 440, 765),
    ],
    backdrop: true,
    frames: true,
    captions: false,
    topTitle: false,
    lowerThird: { x: 40, y: 840, w: 1360 },
    logo: { x: 1440, y: 850, w: 440, h: 130 },
    ticker: false,
    defaults: opts(ORANGE, "SUNUM BAŞLIĞI", "KONUŞMACI", TICKER),
  },
] as const;

export function getTemplate(id: string): TemplateDef | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export const TEMPLATE_GROUPS = [
  { id: "news", label: "Haber" },
  { id: "talk", label: "Konuşma" },
  { id: "demo", label: "Prototip" },
  { id: "learn", label: "Eğitim" },
] as const;
