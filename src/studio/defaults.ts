// src/studio/defaults.ts
// Factories for default state. Pure, SSR-safe, no browser APIs at import time.
import {
  LOGICAL_H,
  LOGICAL_W,
  PROJECT_VERSION,
  type AppSettings,
  type ChromaKey,
  type Layer,
  type LayerKind,
  type OutputSettings,
  type PrompterSettings,
  type ProjectState,
  type Scene,
  type ShortcutMap,
  type Transform,
} from "./types";

let counter = 0;
/** Short unique id. Uses crypto.randomUUID when available, otherwise a counter+random fallback. */
export function uid(prefix = ""): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  const raw =
    c && typeof c.randomUUID === "function"
      ? c.randomUUID().replace(/-/g, "").slice(0, 12)
      : `${(counter++).toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}_${raw}` : raw;
}

export function defaultOutput(): OutputSettings {
  return {
    width: 1920,
    height: 1080,
    fps: 60,
    videoBitrate: 12_000_000,
    audioBitrate: 192_000,
    container: "auto",
    usePublicStun: true,
  };
}

export function defaultShortcuts(): ShortcutMap {
  return {
    "record.toggle": "Shift+R",
    "marker.add": "m",
    "prompter.toggle": "Space",
    "prompter.speedUp": "ArrowUp",
    "prompter.speedDown": "ArrowDown",
    "prompter.rewind": "r",
    "audio.muteMic": "Shift+M",
    "scene.next": "]",
    "scene.prev": "[",
  };
}

export function defaultSettings(): AppSettings {
  return { output: defaultOutput(), shortcuts: defaultShortcuts(), lang: "tr" };
}

export function defaultPrompterSettings(): PrompterSettings {
  return {
    speedPx: 60,
    fontSize: 44,
    lineHeight: 1.4,
    contrast: 1,
    mirror: false,
    display: "hud",
    burnIn: false,
    burnInMode: "subtitle",
    voiceFollow: false,
    voiceLang: "tr-TR",
  };
}

export function defaultChroma(): ChromaKey {
  return {
    enabled: false,
    key: "green",
    similarity: 0.4,
    smoothness: 0.08,
    spill: 0.1,
  };
}

let stage = { w: LOGICAL_W, h: LOGICAL_H };
/** Logical stage used by new layers ("full frame"); set when the output format changes. */
export function setDefaultStage(s: { w: number; h: number }): void {
  if (s.w > 0 && s.h > 0) stage = { w: s.w, h: s.h };
}
export function getDefaultStage(): { w: number; h: number } {
  return { ...stage };
}
const full = (): Transform => ({
  x: 0,
  y: 0,
  w: stage.w,
  h: stage.h,
  rotation: 0,
});

function box(x: number, y: number, w: number, h: number): Transform {
  return { x, y, w, h, rotation: 0 };
}

const NAMES: Record<LayerKind, string> = {
  webcam: "Kamera",
  screen: "Ekran",
  web: "Web prototip",
  guest: "Konuk",
  image: "Görsel",
  video: "Video",
  shape: "Şekil",
  text: "Yazı",
  prompter: "Prompter (burn-in)",
  chat: "Sohbet",
  sponsor: "Sponsorlar",
};

/**
 * Create a layer with sensible defaults for `kind`. `patch` is shallow-merged on top
 * (`transform` / `chroma` are merged one level deep). The result is always a valid Layer.
 */
export function createLayer<K extends LayerKind>(
  kind: K,
  patch: Partial<Extract<Layer, { kind: K }>> = {},
): Extract<Layer, { kind: K }> {
  const base = {
    id: uid("ly"),
    name: NAMES[kind],
    visible: true,
    locked: false,
    opacity: 100,
    blend: "source-over" as const,
    filter: "none",
    chroma: defaultChroma(),
  };
  let layer: Layer;
  switch (kind) {
    case "webcam":
      layer = { ...base, kind: "webcam", transform: full(), mirror: true };
      break;
    case "screen":
      layer = { ...base, kind: "screen", transform: full() };
      break;
    case "web":
      layer = {
        ...base,
        kind: "web",
        transform: box(660, 40, 600, 1000),
        url: "",
        frame: "mobile",
        ripples: true,
      };
      break;
    case "guest":
      layer = {
        ...base,
        kind: "guest",
        transform: box(1280, 560, 600, 340),
        peerId: "",
        label: "Konuk",
      };
      break;
    case "image":
      layer = {
        ...base,
        kind: "image",
        transform: box(60, 60, 320, 180),
        assetId: "",
      };
      break;
    case "video":
      layer = {
        ...base,
        kind: "video",
        transform: full(),
        assetId: "",
        loop: true,
        muted: false,
        volume: 0.5,
      };
      break;
    case "shape":
      layer = {
        ...base,
        kind: "shape",
        transform: box(60, 900, 700, 120),
        shape: "banner",
        fill: "#e0483c",
        stroke: "#ffffff",
        strokeWidth: 0,
        radius: 12,
        text: "🔴 CANLI",
        textColor: "#ffffff",
      };
      break;
    case "text":
      layer = {
        ...base,
        kind: "text",
        transform: box(160, 880, 1600, 140),
        text: "Yeni yazı",
        fontFamily: '"Space Grotesk", sans-serif',
        fontSize: 56,
        color: "#ffffff",
        bold: true,
        align: "center",
        background: "transparent",
        style: "plain",
      };
      break;
    case "prompter":
      layer = {
        ...base,
        kind: "prompter",
        transform: box(160, 860, 1600, 160),
        mode: "subtitle",
      };
      break;
    case "chat":
      layer = {
        ...base,
        kind: "chat",
        transform: box(160, 760, 1600, 200),
        mode: "spotlight",
        fontSize: 44,
        accent: "#e11d2e",
        maxMessages: 4,
      };
      break;
    case "sponsor":
      layer = {
        ...base,
        kind: "sponsor",
        transform: box(1320, 880, 560, 150),
        mode: "rotate",
        dwellMs: 6000,
        heading: "Sponsorlarımız",
        showTagline: true,
      };
      break;
    default:
      throw new Error(`Unknown layer kind: ${String(kind)}`);
  }
  const { transform, chroma, ...rest } = patch as Partial<Layer>;
  return {
    ...layer,
    ...rest,
    transform: { ...layer.transform, ...(transform ?? {}) },
    chroma: { ...layer.chroma, ...(chroma ?? {}) },
  } as Extract<Layer, { kind: K }>;
}

export function createScene(name = "Sahne", layers: Layer[] = []): Scene {
  return { id: uid("sc"), name, layers, transition: { type: "fade", ms: 400 } };
}

export function defaultProject(): ProjectState {
  const solo = createScene("Solo Kamera", [createLayer("webcam")]);
  solo.hotkey = "1";
  const mobile = createScene("Mobil Test + PiP", [
    createLayer("web", { name: "Mobil prototip" }),
    createLayer("webcam", {
      name: "Kamera (PiP)",
      transform: { x: 1360, y: 700, w: 480, h: 270, rotation: 0 },
    }),
  ]);
  mobile.hotkey = "2";
  const desktop = createScene("Masaüstü Prototip + Prompter", [
    createLayer("web", {
      name: "Masaüstü prototip",
      frame: "desktop",
      transform: { x: 160, y: 60, w: 1600, h: 900, rotation: 0 },
    }),
    createLayer("webcam", {
      name: "Kamera (PiP)",
      transform: { x: 1500, y: 780, w: 380, h: 214, rotation: 0 },
    }),
    createLayer("prompter"),
  ]);
  desktop.hotkey = "3";
  return {
    version: PROJECT_VERSION,
    name: "Adsız Proje",
    sponsors: [],
    scenes: [solo, mobile, desktop],
    activeSceneId: solo.id,
    prompter: { script: "", settings: defaultPrompterSettings() },
    settings: defaultSettings(),
  };
}
