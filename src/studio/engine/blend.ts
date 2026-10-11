// src/studio/engine/blend.ts
// Blend-mode validation / mapping to canvas `globalCompositeOperation`, a runtime support probe and
// a sanitizer for the per-layer CSS `filter` string. Pure except for the optional probe, which only
// touches a canvas lazily (never at module load), so the module is SSR-safe.

import type { BlendMode } from "../types";

/** Every blend mode the project format knows, in UI order (Normal first). */
export const BLEND_MODES: readonly BlendMode[] = [
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
];

const BLEND_SET: ReadonlySet<string> = new Set(BLEND_MODES);

/** The mode used whenever a requested mode is invalid or unsupported by the browser. */
export const DEFAULT_BLEND: BlendMode = "source-over";

/** Type guard: is `value` one of the known blend modes? */
export function isBlendMode(value: unknown): value is BlendMode {
  return typeof value === "string" && BLEND_SET.has(value);
}

/** Returns `value` if it is a valid BlendMode, otherwise `fallback` ("source-over"). */
export function parseBlendMode(
  value: unknown,
  fallback: BlendMode = DEFAULT_BLEND,
): BlendMode {
  return isBlendMode(value) ? value : fallback;
}

/**
 * Maps a BlendMode to the canvas composite operation. The names are identical (the project format
 * deliberately reuses the Canvas vocabulary) so this is a typed identity; it exists so callers do
 * not depend on that coincidence and so unknown values degrade to "source-over".
 */
export function toCompositeOperation(
  mode: BlendMode | string,
): GlobalCompositeOperation {
  return isBlendMode(mode) ? mode : DEFAULT_BLEND;
}

/** Minimal slice of a 2D context needed to probe blend support. */
export interface BlendProbeContext {
  globalCompositeOperation: GlobalCompositeOperation | string;
}

const globalSupport = new Map<BlendMode, boolean>();
const perContextSupport = new WeakMap<object, Map<BlendMode, boolean>>();

function probe(ctx: BlendProbeContext, mode: BlendMode): boolean {
  if (mode === DEFAULT_BLEND) return true; // mandatory in every canvas implementation
  const previous = ctx.globalCompositeOperation;
  try {
    // Browsers silently ignore unsupported values, so a read-back that differs means "unsupported".
    ctx.globalCompositeOperation = mode;
    return ctx.globalCompositeOperation === mode;
  } catch {
    return false;
  } finally {
    try {
      ctx.globalCompositeOperation = previous;
    } catch {
      /* nothing sensible left to do */
    }
  }
}

/** Creates a throw-away 1x1 2D context for the global probe, or null when no canvas exists. */
function createProbeContext(): BlendProbeContext | null {
  try {
    if (typeof OffscreenCanvas !== "undefined") {
      return new OffscreenCanvas(1, 1).getContext(
        "2d",
      ) as BlendProbeContext | null;
    }
    if (typeof document !== "undefined") {
      return document.createElement("canvas").getContext("2d");
    }
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Runtime probe: does this browser's canvas accept `mode`? Results are cached. Pass the context
 * you are about to draw with to probe exactly that implementation (cached per context); without
 * one a 1x1 scratch canvas is created once. When no canvas exists at all (SSR) only "source-over"
 * is reported as supported.
 */
export function isBlendSupported(
  mode: BlendMode,
  ctx?: BlendProbeContext,
): boolean {
  if (!isBlendMode(mode)) return false;
  if (mode === DEFAULT_BLEND) return true;
  if (ctx) {
    let map = perContextSupport.get(ctx);
    if (!map) {
      map = new Map();
      perContextSupport.set(ctx, map);
    }
    let cached = map.get(mode);
    if (cached === undefined) {
      cached = probe(ctx, mode);
      map.set(mode, cached);
    }
    return cached;
  }
  const hit = globalSupport.get(mode);
  if (hit !== undefined) return hit;
  const probeCtx = createProbeContext();
  const result = probeCtx ? probe(probeCtx, mode) : false;
  // Do not cache a negative answer caused by a missing canvas: it may exist later (post-hydration).
  if (probeCtx) globalSupport.set(mode, result);
  return result;
}

/**
 * Full resolution used by the compositor: validates `mode` (untrusted project data), checks browser
 * support and falls back to "source-over". Never throws.
 */
export function resolveBlend(
  mode: unknown,
  ctx?: BlendProbeContext,
): GlobalCompositeOperation {
  if (!isBlendMode(mode)) return DEFAULT_BLEND;
  return isBlendSupported(mode, ctx)
    ? toCompositeOperation(mode)
    : DEFAULT_BLEND;
}

/** Test helper: forget cached global probe results. */
export function resetBlendSupportCache(): void {
  globalSupport.clear();
}

/* ------------------------------------------------------------------ */
/* CSS filter sanitizing                                               */
/* ------------------------------------------------------------------ */

const MAX_FILTER_LENGTH = 240;
/** Allowed CSS filter functions (SVG `url(...)` filters are rejected on purpose). */
const FILTER_FN =
  /^(blur|brightness|contrast|drop-shadow|grayscale|hue-rotate|invert|opacity|saturate|sepia)$/;
/** Characters that may appear anywhere in a filter string (no quotes, no `;`, no `\\`). */
const FILTER_CHARS = /^[\w\s.,%#+\-/()]*$/;
const filterCache = new Map<string, string>();

/**
 * Validates a layer's CSS `filter` string for `ctx.filter`. Only a whitelist of standard filter
 * functions is accepted (no `url()` references, so a malicious project cannot make the canvas
 * fetch anything); anything else yields "none". Results are memoised, so calling this once per
 * layer per frame costs one Map lookup.
 */
export function sanitizeCssFilter(filter: unknown): string {
  if (typeof filter !== "string") return "none";
  const cached = filterCache.get(filter);
  if (cached !== undefined) return cached;
  const result = validateFilter(filter);
  if (filterCache.size > 256) filterCache.clear();
  filterCache.set(filter, result);
  return result;
}

function validateFilter(raw: string): string {
  const s = raw.trim();
  if (s === "" || s === "none") return "none";
  if (s.length > MAX_FILTER_LENGTH || !FILTER_CHARS.test(s)) return "none";
  // Walk "name(args)" groups at depth 0.
  let i = 0;
  let count = 0;
  while (i < s.length) {
    while (i < s.length && s[i] === " ") i++;
    if (i >= s.length) break;
    const open = s.indexOf("(", i);
    if (open < 0) return "none";
    const name = s.slice(i, open).trim().toLowerCase();
    if (!FILTER_FN.test(name)) return "none";
    let depth = 1;
    let j = open + 1;
    while (j < s.length && depth > 0) {
      if (s[j] === "(") depth++;
      else if (s[j] === ")") depth--;
      j++;
    }
    if (depth !== 0) return "none";
    count++;
    if (count > 8) return "none";
    i = j;
  }
  return count > 0 ? s : "none";
}
