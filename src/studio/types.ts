// src/studio/types.ts
// Shared contracts for the whole studio. Every module imports types from here.
// Rule: this file is the single source of truth. Do NOT redefine these types elsewhere.
// Coordinate space: every layer transform is expressed in LOGICAL canvas pixels of a
// 1920x1080 stage. The compositor scales to the real output resolution.

export const LOGICAL_W = 1920;
export const LOGICAL_H = 1080;
export const PROJECT_VERSION = 1;

/* ------------------------------------------------------------------ */
/* Layers                                                              */
/* ------------------------------------------------------------------ */

export type LayerKind =
  | "webcam"
  | "screen"
  | "web"
  | "guest"
  | "image"
  | "video"
  | "shape"
  | "text"
  | "prompter"
  | "chat"
  | "sponsor";

export type BlendMode =
  | "source-over"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";

/** Top-left anchored box in logical px; rotation in degrees around the box center. */
export interface Transform {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

export interface ChromaKey {
  enabled: boolean;
  /** "green" | "blue" | custom "#rrggbb" */
  key: "green" | "blue" | string;
  /** 0..1 how close to the key color is fully transparent */
  similarity: number;
  /** 0..1 soft edge width */
  smoothness: number;
  /** 0..1 spill suppression */
  spill: number;
}

/** Effects beyond CSS filters (see engine/fx.ts). All 0 = off. */
export interface LayerFx {
  /** 0..100 unsharp-mask strength */
  sharpen: number;
  /** 0..100 edge darkening */
  vignette: number;
  /** -100 (cool) .. 100 (warm) */
  warmth: number;
}

export interface LayerBase {
  id: string;
  name: string;
  kind: LayerKind;
  visible: boolean;
  locked: boolean;
  /** 0..100 */
  opacity: number;
  blend: BlendMode;
  transform: Transform;
  /** CSS filter string, "none" for no filter */
  filter: string;
  /** extra per-layer effects; absent = none */
  fx?: LayerFx;
  chroma: ChromaKey;
}

export interface WebcamLayer extends LayerBase {
  kind: "webcam";
  deviceId?: string;
  mirror: boolean;
}
export interface ScreenLayer extends LayerBase {
  kind: "screen";
}

export type DeviceFrameKind = "none" | "mobile" | "desktop";
export interface WebLayer extends LayerBase {
  kind: "web";
  url: string;
  frame: DeviceFrameKind;
  /** draw animated touch/click ripples on the canvas */
  ripples: boolean;
}
export interface GuestLayer extends LayerBase {
  kind: "guest";
  /** peer id from the P2P host; the layer is empty until that guest is on air */
  peerId: string;
  label: string;
}
export interface ImageLayer extends LayerBase {
  kind: "image";
  assetId: string;
  /** `contain` (default) keeps the whole image, `cover` fills the box and crops the overflow */
  fit?: "contain" | "cover";
}
export interface VideoLayer extends LayerBase {
  kind: "video";
  assetId: string;
  loop: boolean;
  muted: boolean;
  /** 0..1 */
  volume: number;
}
export type ShapeKind = "rect" | "ellipse" | "banner";
export interface ShapeLayer extends LayerBase {
  kind: "shape";
  shape: ShapeKind;
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius: number;
  text: string;
  textColor: string;
}
export type TextStyle = "plain" | "banner" | "subtitle" | "ticker";
export interface TextLayer extends LayerBase {
  kind: "text";
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  bold: boolean;
  align: "left" | "center" | "right";
  background: string; // CSS color or "transparent"
  style: TextStyle;
}
/** Burn-in prompter (text is written into the recording). */
export type BurnInMode = "ticker" | "subtitle" | "notch";
export interface PrompterLayer extends LayerBase {
  kind: "prompter";
  mode: BurnInMode;
}

/**
 * Room chat on the program output. `spotlight` shows only the message the director put on
 * air; `feed` shows the latest approved messages. Empty (draws nothing) while there is none.
 */
export type ChatLayerMode = "spotlight" | "feed";
export interface ChatLayer extends LayerBase {
  kind: "chat";
  mode: ChatLayerMode;
  /** logical px */
  fontSize: number;
  /** author tag / accent bar color */
  accent: string;
  /** feed mode: how many messages to show (1..8) */
  maxMessages: number;
}

/**
 * Sponsors / partners on the program output, taken from `ProjectState.sponsors` (those marked
 * `onAir`). `rotate` shows one at a time (weighted by tier), `strip` shows all logos together.
 */
export type SponsorLayerMode = "rotate" | "strip";
export interface SponsorLayer extends LayerBase {
  kind: "sponsor";
  mode: SponsorLayerMode;
  /** how long one weight unit is shown in `rotate` mode, ms */
  dwellMs: number;
  /** small caption above the logos, e.g. "Sponsorlarımız" */
  heading: string;
  showTagline: boolean;
}

export type Layer =
  | WebcamLayer
  | ScreenLayer
  | WebLayer
  | GuestLayer
  | ImageLayer
  | VideoLayer
  | ShapeLayer
  | TextLayer
  | PrompterLayer
  | ChatLayer
  | SponsorLayer;

/* ------------------------------------------------------------------ */
/* Scenes                                                              */
/* ------------------------------------------------------------------ */

/** "gl:<name>" selects a WebGL transition from the open-source gl-transitions set. */
export type TransitionType = "cut" | "fade" | "slide" | `gl:${string}`;
export interface Transition {
  type: TransitionType;
  /** ms, ignored for "cut" */
  ms: number;
}

export interface Scene {
  id: string;
  name: string;
  /** Bottom -> top. Index 0 is drawn first. */
  layers: Layer[];
  /** Single key like "1".."9" (or custom combo like "Shift+F1"); optional */
  hotkey?: string;
  transition: Transition;
  /** rundown automation: seconds on air before the next scene takes over (absent / 0 = manual) */
  autoAdvanceSec?: number;
}

/* ------------------------------------------------------------------ */
/* Prompter                                                            */
/* ------------------------------------------------------------------ */

export type PrompterDisplay = "hud" | "notch";
export interface PrompterSettings {
  /** px per second for the scroll engine */
  speedPx: number;
  fontSize: number;
  lineHeight: number;
  /** 0..1 text opacity/contrast */
  contrast: number;
  mirror: boolean;
  /** where the HUD shows: full overlay HUD or compact eyeline notch under the camera */
  display: PrompterDisplay;
  /** burn-in on/off: when true the prompter text is drawn onto the program canvas */
  burnIn: boolean;
  burnInMode: BurnInMode;
  voiceFollow: boolean;
  /** BCP-47, e.g. "tr-TR" */
  voiceLang: string;
}
export interface PrompterState {
  script: string;
  settings: PrompterSettings;
}

/* ------------------------------------------------------------------ */
/* Settings / shortcuts                                                */
/* ------------------------------------------------------------------ */

export interface OutputSettings {
  width: number; // default 1920
  height: number; // default 1080
  fps: number; // default 60
  videoBitrate: number; // bits/s
  audioBitrate: number;
  /** preferred container; "auto" picks mp4 if MediaRecorder supports it, else webm */
  container: "auto" | "mp4" | "webm";
  /** allow public STUN for WebRTC (leaks IP to the STUN operator only; no media) */
  usePublicStun: boolean;
}

export type ShortcutAction =
  | "record.toggle"
  | "marker.add"
  | "prompter.toggle"
  | "prompter.speedUp"
  | "prompter.speedDown"
  | "prompter.rewind"
  | "audio.muteMic"
  | "scene.next"
  | "scene.prev";
/** action -> key combo string, e.g. "Space", "Shift+M" */
export type ShortcutMap = Record<ShortcutAction, string>;

export interface AppSettings {
  output: OutputSettings;
  shortcuts: ShortcutMap;
  /** UI language */
  lang: "tr" | "en";
}

/* ------------------------------------------------------------------ */
/* Project (the .pptdz payload)                                        */
/* ------------------------------------------------------------------ */

/** Who supports the broadcast: shown on air (optional) and listed in the exposure report. */
export type SupporterKind = "sponsor" | "partner" | "collaborator" | "investor";
export type SponsorTier = "title" | "gold" | "silver" | "supporter";
export interface Sponsor {
  id: string;
  name: string;
  kind: SupporterKind;
  tier: SponsorTier;
  /** https website, "" when none */
  url: string;
  tagline: string;
  /** image asset id of the logo, "" when none */
  logoAssetId: string;
  /** include in the on-air sponsor layer */
  onAir: boolean;
}

export interface ProjectState {
  version: typeof PROJECT_VERSION;
  name: string;
  /** sponsors / partners of this broadcast (optional in old files, defaults to []) */
  sponsors: Sponsor[];
  scenes: Scene[];
  activeSceneId: string;
  prompter: PrompterState;
  settings: AppSettings;
}

/* ------------------------------------------------------------------ */
/* Assets (IndexedDB)                                                  */
/* ------------------------------------------------------------------ */

export type AssetType = "image" | "video" | "audio";
export interface AssetMeta {
  id: string;
  name: string;
  type: AssetType;
  mime: string;
  size: number;
  createdAt: number;
}
export interface AssetRecord extends AssetMeta {
  blob: Blob;
}
/** Implemented by src/studio/storage/idb.ts, consumed by pptdz + runtime. */
export interface AssetStore {
  put(
    blob: Blob,
    meta: { name: string; type: AssetType },
    id?: string,
  ): Promise<AssetMeta>;
  get(id: string): Promise<AssetRecord | undefined>;
  getUrl(id: string): Promise<string | undefined>; // object URL, cached; revoke on delete/dispose
  list(): Promise<AssetMeta[]>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
  dispose(): void;
}

/** Tiny async key-value store (IndexedDB-backed, in-memory fallback). Used for project autosave. */
export interface KvStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/* ------------------------------------------------------------------ */
/* Recording markers / chapters                                        */
/* ------------------------------------------------------------------ */

export interface Marker {
  /** ms since recording start */
  t: number;
  label: string;
}

/* ------------------------------------------------------------------ */
/* P2P: roles, protocol                                                */
/* ------------------------------------------------------------------ */

export type PeerRole = "viewer" | "guest" | "remote";
export type PeerStatus =
  | "connecting"
  | "connected" // viewer: watching
  | "waiting" // guest in green room, not on air
  | "on-air"
  | "disconnected";

export interface PeerInfo {
  id: string;
  role: PeerRole;
  name: string;
  status: PeerStatus;
  /** 0..1.5 gain for guest audio */
  gain: number;
  muted: boolean;
}

/** Messages sent over the WebRTC DataChannel named "ctl". JSON, one object per message. */
export type HostToPeer =
  | { type: "hello"; peerId: string }
  | { type: "guest-approved" }
  | { type: "guest-on-air" }
  | { type: "guest-off-air" }
  | { type: "guest-rejected" }
  | { type: "remote-state"; state: RemoteState }
  /** optional in-band renegotiation (the ctl channel is the only signaling path once connected) */
  | { type: "sdp"; description: { type: "offer" | "answer"; sdp: string } }
  | {
      type: "ice";
      candidate: {
        candidate: string;
        sdpMid?: string | null;
        sdpMLineIndex?: number | null;
      };
    };

export type PeerToHost =
  | { type: "role"; role: PeerRole; name: string }
  | { type: "join-request"; name: string }
  | { type: "remote-cmd"; cmd: RemoteCommand }
  | { type: "sdp"; description: { type: "offer" | "answer"; sdp: string } }
  | {
      type: "ice";
      candidate: {
        candidate: string;
        sdpMid?: string | null;
        sdpMLineIndex?: number | null;
      };
    };

export interface RemoteState {
  scenes: { id: string; name: string; hotkey?: string }[];
  activeSceneId: string;
  recording: boolean;
  micMuted: boolean;
  prompterPlaying: boolean;
  prompterSpeed: number;
  recordingMs: number;
}

export type RemoteCommand =
  | { kind: "scene"; id: string }
  | { kind: "scene-index"; index: number } // 0-based
  | { kind: "prompter"; action: "toggle" | "speedUp" | "speedDown" | "rewind" }
  | { kind: "mute"; value?: boolean } // omit value to toggle
  | { kind: "record"; action: "toggle" | "start" | "stop" }
  | { kind: "marker" };

/* ------------------------------------------------------------------ */
/* Engine hook contracts (compositor <-> everything else)              */
/* ------------------------------------------------------------------ */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A drawable pixel source for a layer. Dimensions are the intrinsic size of `source`. */
export interface FrameSource {
  source: CanvasImageSource;
  width: number;
  height: number;
  /** horizontally flip when drawing (selfie mirror) */
  mirror?: boolean;
  /** false while the underlying media has no frame yet (compositor skips drawing) */
  ready: boolean;
}

/**
 * Everything the compositor needs from the outside world. The compositor itself never
 * touches getUserMedia, IndexedDB, WebRTC, the prompter or the DOM.
 * All draw hooks receive coordinates already in OUTPUT canvas pixels (the compositor has
 * applied the logical->output scale) with the layer's rotation/opacity/blend applied via
 * ctx state; hooks must restore any ctx state they change.
 */
export interface CompositorHooks {
  resolveSource(layer: Layer): FrameSource | null;
  /** Burn-in prompter text. `box` is the layer transform in output px. */
  drawPrompter?(
    ctx: CanvasRenderingContext2D,
    layer: PrompterLayer,
    box: Rect,
    nowMs: number,
  ): void;
  /** Sponsor overlay (see `SponsorLayer`). `box` is the layer transform in output px. */
  drawSponsors?(
    ctx: CanvasRenderingContext2D,
    layer: SponsorLayer,
    box: Rect,
    nowMs: number,
  ): void;
  /** Room chat overlay (see `ChatLayer`). `box` is the layer transform in output px. */
  drawChat?(
    ctx: CanvasRenderingContext2D,
    layer: ChatLayer,
    box: Rect,
    nowMs: number,
  ): void;
  /**
   * Web (prototype) layers: draw the device frame chrome for `layer.frame` and return the
   * inner "screen" rect where the captured source will be drawn. Return `box` for "none".
   */
  drawWebChrome?(
    ctx: CanvasRenderingContext2D,
    layer: WebLayer,
    box: Rect,
    nowMs: number,
  ): Rect;
  /** Web layers: touch/click ripples drawn over the screen rect. */
  drawWebOverlay?(
    ctx: CanvasRenderingContext2D,
    layer: WebLayer,
    screen: Rect,
    nowMs: number,
  ): void;
}
