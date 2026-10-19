// src/studio/project/schema.ts
// zod schemas for the whole ProjectState. Untrusted input (imported .pptdz, autosave) is
// parsed through `parseProject`, which REPAIRS where reasonable instead of rejecting.
import { z } from "zod";

import {
  createScene,
  defaultPrompterSettings,
  defaultProject,
  uid,
} from "../defaults";
import { parseSettings } from "../storage/settings-schema";
import {
  PROJECT_VERSION,
  type BlendMode,
  type Layer,
  type TransitionType,
  type PrompterSettings,
  type ProjectState,
  type Scene,
  type Sponsor,
} from "../types";
import { ProjectSchemaError } from "./errors";

export const LIMITS = {
  scenes: 100,
  layersPerScene: 200,
  scriptChars: 2_000_000,
  nameChars: 200,
  urlChars: 2048,
  textChars: 20_000,
  coord: 100_000,
} as const;

const BLEND_MODES = [
  "source-over",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const satisfies readonly BlendMode[];

const num = (min: number = -LIMITS.coord, max: number = LIMITS.coord) =>
  z.number().finite().min(min).max(max);
const name = z.string().max(LIMITS.nameChars);

/** CSS color: hex / rgb(a) / hsl(a) / named / "transparent". No url(), no ';', no braces. */
const cssColor = z
  .string()
  .max(64)
  .regex(/^[#a-zA-Z0-9\s(),.%/-]*$/, "invalid color");

/** CSS filter list such as "grayscale(1) blur(4px)". No url(), no ';', no braces. */
const cssFilter = z
  .string()
  .max(200)
  .regex(/^[a-zA-Z0-9\s().,%-]*$/, "invalid filter")
  .refine((s) => !/url\s*\(/i.test(s), "url() not allowed");

const fontFamily = z
  .string()
  .max(120)
  .regex(/^[a-zA-Z0-9\s"',-]*$/, "invalid font");

const transform = z.object({
  x: num(),
  y: num(),
  w: num(0),
  h: num(0),
  rotation: num(-3600, 3600),
});

const chroma = z.object({
  enabled: z.boolean(),
  key: z.string().regex(/^(green|blue|#[0-9a-fA-F]{6})$/),
  similarity: num(0, 1),
  smoothness: num(0, 1),
  spill: num(0, 1),
});

const fxSchema = z.object({
  sharpen: num(0, 100),
  vignette: num(0, 100),
  warmth: num(-100, 100),
});

const layerBase = {
  id: z.string().min(1).max(128),
  name,
  visible: z.boolean(),
  locked: z.boolean(),
  opacity: num(0, 100),
  blend: z.enum(BLEND_MODES),
  transform,
  filter: cssFilter,
  fx: fxSchema.optional(),
  chroma,
};

const assetId = z.string().max(128);

export const layerSchema = z.discriminatedUnion("kind", [
  z.object({
    ...layerBase,
    kind: z.literal("webcam"),
    deviceId: z.string().max(256).optional(),
    mirror: z.boolean(),
  }),
  z.object({ ...layerBase, kind: z.literal("screen") }),
  z.object({
    ...layerBase,
    kind: z.literal("web"),
    url: z.string().max(LIMITS.urlChars),
    frame: z.enum(["none", "mobile", "desktop"]),
    ripples: z.boolean(),
  }),
  z.object({
    ...layerBase,
    kind: z.literal("guest"),
    peerId: z.string().max(128),
    label: name,
  }),
  z.object({
    ...layerBase,
    kind: z.literal("image"),
    assetId,
    fit: z.enum(["contain", "cover"]).optional(),
  }),
  z.object({
    ...layerBase,
    kind: z.literal("video"),
    assetId,
    loop: z.boolean(),
    muted: z.boolean(),
    volume: num(0, 1),
  }),
  z.object({
    ...layerBase,
    kind: z.literal("shape"),
    shape: z.enum(["rect", "ellipse", "banner"]),
    fill: cssColor,
    stroke: cssColor,
    strokeWidth: num(0, 200),
    radius: num(0, 2000),
    text: z.string().max(LIMITS.textChars),
    textColor: cssColor,
  }),
  z.object({
    ...layerBase,
    kind: z.literal("text"),
    text: z.string().max(LIMITS.textChars),
    fontFamily,
    fontSize: num(1, 1000),
    color: cssColor,
    bold: z.boolean(),
    align: z.enum(["left", "center", "right"]),
    background: cssColor,
    style: z.enum(["plain", "banner", "subtitle", "ticker"]),
  }),
  z.object({
    ...layerBase,
    kind: z.literal("prompter"),
    mode: z.enum(["ticker", "subtitle", "notch"]),
  }),
  z.object({
    ...layerBase,
    kind: z.literal("sponsor"),
    mode: z.enum(["rotate", "strip"]),
    dwellMs: num(1500, 60_000),
    heading: z.string().max(60),
    showTagline: z.boolean(),
  }),
  z.object({
    ...layerBase,
    kind: z.literal("chat"),
    mode: z.enum(["spotlight", "feed"]),
    fontSize: num(8, 400),
    accent: cssColor,
    maxMessages: num(1, 8),
  }),
]);

export const MAX_SPONSORS = 40;

function httpUrlOrEmpty(v: string): boolean {
  if (v === "") return true;
  try {
    const u = new URL(v);
    return (
      (u.protocol === "https:" || u.protocol === "http:") &&
      !u.username &&
      !u.password
    );
  } catch {
    return false;
  }
}

export const sponsorSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["sponsor", "partner", "collaborator", "investor"]),
  tier: z.enum(["title", "gold", "silver", "supporter"]),
  url: z.string().max(300).refine(httpUrlOrEmpty, "bad url"),
  tagline: z.string().max(140),
  logoAssetId: z.string().max(128),
  onAir: z.boolean(),
});

const sceneSchema = z.object({
  id: z.string().min(1).max(128),
  name,
  layers: z.array(z.unknown()).max(LIMITS.layersPerScene),
  hotkey: z.string().max(32).optional(),
  transition: z.object({
    type: z.union([
      z.enum(["cut", "fade", "slide"]),
      z.string().regex(/^gl:[A-Za-z0-9_]{1,40}$/),
    ]) as z.ZodType<TransitionType>,
    ms: num(0, 10_000),
  }),
});

const prompterSettingsSchema = z.object({
  speedPx: num(0, 600),
  fontSize: num(8, 300),
  lineHeight: num(0.8, 4),
  contrast: num(0, 1),
  mirror: z.boolean(),
  display: z.enum(["hud", "notch"]),
  burnIn: z.boolean(),
  burnInMode: z.enum(["ticker", "subtitle", "notch"]),
  voiceFollow: z.boolean(),
  voiceLang: z.string().regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/),
});

export type ParseProjectResult =
  | { ok: true; project: ProjectState; warnings: string[] }
  | { ok: false; error: ProjectSchemaError };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Per-field repair of prompter settings: invalid fields fall back to defaults. */
function repairPrompterSettings(raw: unknown): PrompterSettings {
  const base = defaultPrompterSettings();
  if (!isRecord(raw)) return base;
  const out: Record<string, unknown> = { ...base };
  const shape = prompterSettingsSchema.shape;
  for (const key of Object.keys(shape) as (keyof typeof shape)[]) {
    if (!(key in raw)) continue;
    const r = shape[key].safeParse(raw[key]);
    if (r.success) out[key] = r.data;
  }
  return out as unknown as PrompterSettings;
}

/** Version hook. Only v1 exists; anything else is rejected with a clear error. */
export function migrateProject(raw: unknown): unknown {
  if (!isRecord(raw)) throw new ProjectSchemaError("not-an-object");
  const v = raw["version"];
  if (v !== PROJECT_VERSION) {
    throw new ProjectSchemaError(
      "unsupported-version",
      `Proje sürümü desteklenmiyor: ${String(v)}`,
    );
  }
  return raw;
}

/**
 * Validate and REPAIR an untrusted project. Invalid layers/scenes are dropped (reported in
 * `warnings`), missing fields take defaults, ids are made unique, and the result always has
 * at least one scene and a valid `activeSceneId`.
 */
export function parseProject(input: unknown): ParseProjectResult {
  let raw: Record<string, unknown>;
  try {
    raw = migrateProject(input) as Record<string, unknown>;
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof ProjectSchemaError
          ? e
          : new ProjectSchemaError("invalid", undefined, { cause: e }),
    };
  }

  const warnings: string[] = [];
  const sceneIds = new Set<string>();
  const layerIds = new Set<string>();
  const hotkeys = new Set<string>();
  const scenes: Scene[] = [];

  const rawScenes = Array.isArray(raw["scenes"]) ? raw["scenes"] : [];
  if (rawScenes.length > LIMITS.scenes) {
    warnings.push(`Sahne sayısı ${LIMITS.scenes} ile sınırlandı`);
  }
  for (const rs of rawScenes.slice(0, LIMITS.scenes)) {
    const sp = sceneSchema.safeParse(rs);
    if (!sp.success) {
      warnings.push("Geçersiz bir sahne atlandı");
      continue;
    }
    const s = sp.data;
    let id = s.id;
    if (sceneIds.has(id)) id = uid("sc");
    sceneIds.add(id);

    const layers: Layer[] = [];
    for (const rl of s.layers) {
      const lp = layerSchema.safeParse(rl);
      if (!lp.success) {
        warnings.push(`"${s.name}" sahnesinde geçersiz bir katman atlandı`);
        continue;
      }
      let lid = lp.data.id;
      if (layerIds.has(lid)) lid = uid("ly");
      layerIds.add(lid);
      layers.push({ ...lp.data, id: lid } as Layer);
    }

    const scene: Scene = {
      id,
      name: s.name,
      layers,
      transition: s.transition,
    };
    if (s.hotkey && !hotkeys.has(s.hotkey)) {
      hotkeys.add(s.hotkey);
      scene.hotkey = s.hotkey;
    }
    scenes.push(scene);
  }
  if (scenes.length === 0) {
    warnings.push("Sahne bulunamadı; varsayılan sahne oluşturuldu");
    scenes.push(createScene("Sahne 1"));
  }

  const first = scenes[0] as Scene;
  const active =
    typeof raw["activeSceneId"] === "string" &&
    sceneIds.has(raw["activeSceneId"])
      ? raw["activeSceneId"]
      : first.id;

  const rawPrompter = isRecord(raw["prompter"]) ? raw["prompter"] : {};
  let script =
    typeof rawPrompter["script"] === "string" ? rawPrompter["script"] : "";
  if (script.length > LIMITS.scriptChars) {
    script = script.slice(0, LIMITS.scriptChars);
    warnings.push("Prompter metni kısaltıldı");
  }

  const projectName =
    typeof raw["name"] === "string" && raw["name"].trim()
      ? raw["name"].slice(0, LIMITS.nameChars)
      : defaultProject().name;

  return {
    ok: true,
    warnings,
    project: {
      version: PROJECT_VERSION,
      name: projectName,
      scenes,
      activeSceneId: active,
      prompter: {
        script,
        settings: repairPrompterSettings(rawPrompter["settings"]),
      },
      settings: parseSettings(raw["settings"]),
      sponsors: parseSponsors(raw["sponsors"], warnings),
    },
  };
}

/** Per-item repair: invalid sponsors are dropped, ids made unique, count capped. */
function parseSponsors(raw: unknown, warnings: string[]): Sponsor[] {
  if (!Array.isArray(raw)) return [];
  const out: Sponsor[] = [];
  const ids = new Set<string>();
  for (const item of raw) {
    if (out.length >= MAX_SPONSORS) {
      warnings.push(`Sponsor sayısı ${MAX_SPONSORS} ile sınırlandı`);
      break;
    }
    const r = sponsorSchema.safeParse(item);
    if (!r.success) {
      warnings.push("Geçersiz bir sponsor kaydı atlandı");
      continue;
    }
    const id = ids.has(r.data.id) ? uid("sp") : r.data.id;
    ids.add(id);
    out.push({ ...r.data, id });
  }
  return out;
}
