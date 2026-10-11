// src/studio/p2p/qr-render.ts
// Renderers for QrMatrix (see qr.ts): compact SVG string, SVG data URL and 2D canvas.
// SSR-safe: nothing here touches window/document at import time, and the canvas renderer only
// uses the canvas object it is handed. The quiet zone (margin, in modules) is added here.
import { QrError, type QrMatrix } from "./qr";

/** Quiet zone width required by ISO 18004. Scanners get unreliable below this. */
export const QR_DEFAULT_MARGIN = 4;

const MAX_MARGIN = 64;
const MAX_SCALE = 64;
const MAX_SVG_PX = 16384;
/** Conservative limit shared by all browsers for one canvas edge. */
const MAX_CANVAS_PX = 16384;
const MAX_MATRIX_SIZE = 1024;

export interface QrSvgOptions {
  /** Quiet zone in modules, integer 0..64; default 4. */
  margin?: number | undefined;
  /** Colour of dark modules; default "#000". */
  dark?: string | undefined;
  /** Background colour; default "#fff". "transparent"/"none" omit the background. */
  light?: string | undefined;
  /** Fixed width/height attributes in CSS pixels. Omit to let the SVG scale to its container. */
  sizePx?: number | undefined;
}

export interface QrCanvasOptions {
  /** Pixels per module, integer 1..64; default 4. */
  scale?: number | undefined;
  /** Quiet zone in modules, integer 0..64; default 4. */
  margin?: number | undefined;
  dark?: string | undefined;
  light?: string | undefined;
}

/** The slice of CanvasRenderingContext2D the renderer needs (also fits OffscreenCanvas). */
export interface QrCanvasContextLike {
  fillStyle: string | CanvasGradient | CanvasPattern;
  imageSmoothingEnabled: boolean;
  fillRect(x: number, y: number, width: number, height: number): void;
}

/** The slice of HTMLCanvasElement / OffscreenCanvas the renderer needs. */
export interface QrCanvasLike {
  width: number;
  height: number;
  getContext(contextId: "2d"): QrCanvasContextLike | null;
}

// --- validation -----------------------------------------------------------------------------

// Only plain CSS colour syntax: hex, a keyword, or a flat rgb()/hsl() function. No quotes,
// angle brackets, ampersands or nested parentheses, so the value is safe inside an SVG
// attribute.
const COLOR_RE =
  /^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|[a-z]{3,24}|(?:rgb|rgba|hsl|hsla)\([0-9a-z.%,/+\-\s]{1,60}\))$/i;

function resolveColor(
  value: string | undefined,
  fallback: string,
  name: string,
): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !COLOR_RE.test(value.trim())) {
    throw new QrError(
      "bad-options",
      `QR ${name} colour is not a plain CSS colour`,
    );
  }
  return value.trim();
}

function isTransparent(color: string): boolean {
  return /^(?:transparent|none)$/i.test(color);
}

function resolveIntOption(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new QrError(
      "bad-options",
      `QR ${name} must be an integer ${min}..${max}`,
    );
  }
  return value;
}

function checkMatrix(matrix: QrMatrix): void {
  const size = matrix?.size;
  if (
    typeof size !== "number" ||
    !Number.isInteger(size) ||
    size < 1 ||
    size > MAX_MATRIX_SIZE ||
    !ArrayBuffer.isView(matrix.modules) ||
    matrix.modules.BYTES_PER_ELEMENT !== 1 ||
    matrix.modules.length !== size * size
  ) {
    throw new QrError("bad-options", "Not a valid QR matrix");
  }
}

/** Calls `emit` for every maximal horizontal run of dark modules (matrix coordinates). */
function forEachDarkRun(
  matrix: QrMatrix,
  emit: (x: number, y: number, length: number) => void,
): void {
  const { size, modules } = matrix;
  for (let y = 0; y < size; y++) {
    const row = y * size;
    let x = 0;
    while (x < size) {
      if (modules[row + x] !== 1) {
        x++;
        continue;
      }
      const start = x;
      while (x < size && modules[row + x] === 1) x++;
      emit(start, y, x - start);
    }
  }
}

// --- SVG ------------------------------------------------------------------------------------

/**
 * Standalone SVG document: one background `<rect>` (unless `light` is transparent) and a single
 * `<path>` of merged horizontal runs. No external references, scripts or styles. Scales
 * freely via viewBox; pass `sizePx` for fixed dimensions.
 * @throws QrError "bad-options" for an invalid margin / colour / size / matrix.
 */
export function qrToSvg(matrix: QrMatrix, opts: QrSvgOptions = {}): string {
  checkMatrix(matrix);
  const margin = resolveIntOption(
    opts.margin,
    QR_DEFAULT_MARGIN,
    0,
    MAX_MARGIN,
    "margin",
  );
  const dark = resolveColor(opts.dark, "#000", "dark");
  const light = resolveColor(opts.light, "#fff", "light");
  const sizePx = resolveIntOption(opts.sizePx, 0, 1, MAX_SVG_PX, "sizePx");

  const total = matrix.size + margin * 2;
  const path: string[] = [];
  forEachDarkRun(matrix, (x, y, length) => {
    path.push(`M${x + margin} ${y + margin}h${length}v1h-${length}z`);
  });

  const dimensions = sizePx > 0 ? ` width="${sizePx}" height="${sizePx}"` : "";
  const background = isTransparent(light)
    ? ""
    : `<rect width="${total}" height="${total}" fill="${light}"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}"${dimensions} ` +
    `shape-rendering="crispEdges">${background}<path fill="${dark}" d="${path.join("")}"/></svg>`
  );
}

/**
 * `data:image/svg+xml` URL of `qrToSvg(matrix, opts)`, percent-encoded (no base64, no
 * btoa dependency) and safe inside `<img src>` as well as CSS `url(...)`.
 */
export function qrToDataUrl(matrix: QrMatrix, opts: QrSvgOptions = {}): string {
  const encoded = encodeURIComponent(qrToSvg(matrix, opts)).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `data:image/svg+xml;charset=utf-8,${encoded}`;
}

// --- canvas ---------------------------------------------------------------------------------

/**
 * Draws the matrix with its quiet zone onto `canvas`, resizing it to
 * `(size + 2 * margin) * scale` pixels per edge (which also clears it). Modules are drawn as
 * merged crisp rectangles; no image smoothing.
 * @returns the canvas edge length in pixels.
 * @throws QrError "bad-options" (invalid option, or the result would exceed 16384 px) or
 *   "unsupported" (no canvas / no 2D context, e.g. during SSR).
 */
export function qrToCanvas(
  canvas: QrCanvasLike,
  matrix: QrMatrix,
  opts: QrCanvasOptions = {},
): number {
  checkMatrix(matrix);
  const scale = resolveIntOption(opts.scale, 4, 1, MAX_SCALE, "scale");
  const margin = resolveIntOption(
    opts.margin,
    QR_DEFAULT_MARGIN,
    0,
    MAX_MARGIN,
    "margin",
  );
  const dark = resolveColor(opts.dark, "#000", "dark");
  const light = resolveColor(opts.light, "#fff", "light");
  const px = (matrix.size + margin * 2) * scale;
  if (px > MAX_CANVAS_PX) {
    throw new QrError(
      "bad-options",
      `QR canvas would be ${px}px (limit ${MAX_CANVAS_PX}px)`,
    );
  }
  if (!canvas || typeof canvas.getContext !== "function") {
    throw new QrError("unsupported", "No canvas available");
  }

  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new QrError("unsupported", "2D canvas context unavailable");

  ctx.imageSmoothingEnabled = false;
  if (!isTransparent(light)) {
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, px, px);
  }
  ctx.fillStyle = dark;
  forEachDarkRun(matrix, (x, y, length) => {
    ctx.fillRect(
      (x + margin) * scale,
      (y + margin) * scale,
      length * scale,
      scale,
    );
  });
  return px;
}
