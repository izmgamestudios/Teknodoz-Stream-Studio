// src/lib/studio/templates.ts
import { type Item, type Scene, emptyScene, uid } from "./types";

export type Template = {
  id: string;
  name: string;
  emoji: string;
  hint: string;
  build: () => Scene;
};

const item = (i: Omit<Item, "id">): Item => ({ id: uid(), ...i });

const make = (patch: Partial<Scene>, items: Omit<Item, "id">[]): Scene => ({
  ...emptyScene(),
  ...patch,
  items: items.map(item),
});

export const TEMPLATES: Template[] = [
  {
    id: "clean",
    name: "Sade Kamera",
    emoji: "📷",
    hint: "Tam ekran kamera, hiçbir şey yok",
    build: () => make({}, []),
  },
  {
    id: "podcast",
    name: "Podcast Röportaj",
    emoji: "🎙",
    hint: "Konuşmacı bandı + CANLI rozeti",
    build: () =>
      make({ frame: "#f5c04a" }, [
        {
          kind: "badge",
          text: "CANLI",
          x: 9,
          y: 9,
          w: 12,
          color: "#e0483c",
          size: 26,
        },
        {
          kind: "lower",
          text: "Konuk Adı",
          sub: "Unvan · Şirket",
          x: 27,
          y: 84,
          w: 44,
          color: "#f5c04a",
          size: 34,
        },
      ]),
  },
  {
    id: "news",
    name: "Haber Bülteni",
    emoji: "📰",
    hint: "Alt bant + kayan yazı",
    build: () =>
      make({ filter: "contrast(1.1) saturate(1.1)" }, [
        {
          kind: "badge",
          text: "SON DAKİKA",
          x: 12,
          y: 9,
          w: 18,
          color: "#c62828",
          size: 26,
        },
        {
          kind: "lower",
          text: "Manşet başlığı buraya",
          sub: "Detay satırı",
          x: 50,
          y: 78,
          w: 86,
          color: "#1565c0",
          size: 36,
        },
        {
          kind: "ticker",
          text: "Teknodoz Stream Studio · Canlı yayın · Bu bir kayan yazı örneğidir · Abone olmayı unutma",
          x: 50,
          y: 94,
          w: 100,
          color: "#111111",
          size: 26,
        },
      ]),
  },
  {
    id: "present",
    name: "Ekran Sunumu",
    emoji: "🖥",
    hint: "Ekran + köşede kamera + başlık",
    build: () =>
      make({ base: "screen", layout: "pip", corner: "br", frame: "#38bdf8" }, [
        {
          kind: "text",
          text: "Sunum Başlığı",
          x: 24,
          y: 7,
          w: 36,
          color: "#0ea5e9",
          size: 30,
        },
      ]),
  },
  {
    id: "split",
    name: "Yan Yana",
    emoji: "◧",
    hint: "Ekran/video solda, kamera sağda",
    build: () =>
      make({ base: "screen", layout: "split", bg: ["#1e1b4b", "#0f172a"] }, [
        {
          kind: "badge",
          text: "CANLI",
          x: 8,
          y: 8,
          w: 11,
          color: "#e0483c",
          size: 24,
        },
        {
          kind: "subtitle",
          text: "Altyazı buraya gelir",
          x: 50,
          y: 92,
          w: 80,
          size: 28,
        },
      ]),
  },
  {
    id: "gaming",
    name: "Oyun Yayını",
    emoji: "🎮",
    hint: "Neon çerçeve, kamera köşede",
    build: () =>
      make(
        {
          base: "screen",
          layout: "pip",
          corner: "bl",
          filter: "saturate(1.3) contrast(1.1)",
          frame: "#a855f7",
        },
        [
          {
            kind: "badge",
            text: "LIVE",
            x: 91,
            y: 8,
            w: 10,
            color: "#a855f7",
            size: 24,
          },
          {
            kind: "ticker",
            text: "Takip et · Beğen · Yorum yaz · Teknodoz",
            x: 50,
            y: 95,
            w: 100,
            color: "#2e1065",
            size: 24,
          },
        ],
      ),
  },
  {
    id: "cinema",
    name: "Sinematik Video",
    emoji: "🎞",
    hint: "Arka plan video + altyazı",
    build: () =>
      make(
        {
          base: "video",
          layout: "pip",
          corner: "tr",
          filter: "contrast(1.15) saturate(1.1)",
          frame: "",
        },
        [
          {
            kind: "subtitle",
            text: "Altyazı metni",
            x: 50,
            y: 88,
            w: 80,
            size: 30,
          },
        ],
      ),
  },
  {
    id: "retro",
    name: "Retro VHS",
    emoji: "📼",
    hint: "Sepya ton + REC rozeti",
    build: () =>
      make(
        {
          filter: "sepia(0.5) contrast(1.2) saturate(0.8) brightness(0.95)",
          frame: "#e8dcc0",
        },
        [
          {
            kind: "badge",
            text: "● REC",
            x: 9,
            y: 9,
            w: 12,
            color: "#b91c1c",
            size: 26,
          },
          {
            kind: "text",
            text: "PLAY ▶",
            x: 90,
            y: 92,
            w: 14,
            color: "#00000000",
            size: 28,
          },
        ],
      ),
  },
];

export const ITEM_PRESETS: Record<string, Omit<Item, "id">> = {
  text: {
    kind: "text",
    text: "Yeni yazı",
    x: 50,
    y: 50,
    w: 30,
    color: "#e0483c",
    size: 30,
  },
  banner: {
    kind: "text",
    text: "🔴 CANLI · Podcast",
    x: 50,
    y: 12,
    w: 40,
    color: "#e0483c",
    size: 30,
  },
  sub: {
    kind: "subtitle",
    text: "Altyazı metni",
    x: 50,
    y: 88,
    w: 80,
    size: 28,
  },
  lower: {
    kind: "lower",
    text: "Ad Soyad",
    sub: "Unvan",
    x: 27,
    y: 84,
    w: 44,
    color: "#f5c04a",
    size: 34,
  },
  badge: {
    kind: "badge",
    text: "CANLI",
    x: 9,
    y: 9,
    w: 12,
    color: "#e0483c",
    size: 26,
  },
  ticker: {
    kind: "ticker",
    text: "Kayan yazı buraya · Teknodoz Stream Studio",
    x: 50,
    y: 94,
    w: 100,
    color: "#111111",
    size: 26,
  },
};
