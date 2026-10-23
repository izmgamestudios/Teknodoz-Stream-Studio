// src/studio/viz/draw.ts
// Audio visualiser drawing (pure canvas 2D, no browser globals): turns frequency bytes into bars
// and paints bars / mirrored bars / a wave line / a ring for one or several voices (host and
// guests), each in its own colour and lane. Used by the "audioviz" layer on the program output.

export type VizStyle = "bars" | "mirror" | "wave" | "ring";

export const VIZ_STYLES: readonly VizStyle[] = [
  "bars",
  "mirror",
  "wave",
  "ring",
];

export interface VizSeries {
  label: string;
  color: string;
  /** bar heights 0..1 */
  bars: number[];
  /** overall level 0..1 (for the label dot) */
  level: number;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Frequency bytes (linear bins from 0 to Nyquist) -> `count` bars on a logarithmic frequency
 * axis between `minHz` and `maxHz`, so the low voice range gets room. Each bar is the loudest
 * bin of its band, 0..1, with a gentle expansion so speech fills the height.
 */
export function binSpectrum(
  data: ArrayLike<number>,
  count: number,
  sampleRate = 48_000,
  minHz = 70,
  maxHz = 9_000,
): number[] {
  const n = Math.max(1, Math.floor(count));
  const bins = data.length;
  const out = new Array<number>(n).fill(0);
  if (bins === 0) return out;
  const nyquist = sampleRate / 2;
  const hzPerBin = nyquist / bins;
  const lo = Math.log(Math.max(20, minHz));
  const hi = Math.log(Math.min(nyquist, maxHz));
  for (let i = 0; i < n; i++) {
    const a = Math.exp(lo + ((hi - lo) * i) / n);
    const b = Math.exp(lo + ((hi - lo) * (i + 1)) / n);
    const from = Math.min(bins - 1, Math.max(0, Math.floor(a / hzPerBin)));
    const to = Math.min(bins - 1, Math.max(from, Math.ceil(b / hzPerBin)));
    let peak = 0;
    for (let k = from; k <= to; k++) peak = Math.max(peak, data[k] as number);
    out[i] = Math.pow(clamp01(peak / 255), 1.35);
  }
  return out;
}

/** Exponential smoothing with a faster attack than release (bars jump up, fall gently). */
export function smoothBars(
  prev: readonly number[] | undefined,
  next: readonly number[],
  release = 0.8,
): number[] {
  const r = clamp01(release);
  return next.map((v, i) => {
    const p = prev?.[i] ?? 0;
    return v >= p ? p * 0.35 + v * 0.65 : p * r + v * (1 - r);
  });
}

/** Colours for the voices: the layer accents first, then distinct hues. */
export function seriesColors(
  count: number,
  accent: string,
  accent2: string,
): string[] {
  const extra = [
    "#f59e0b",
    "#22c55e",
    "#ec4899",
    "#38bdf8",
    "#a78bfa",
    "#f97316",
  ];
  return Array.from({ length: count }, (_, i) =>
    i === 0
      ? accent
      : i === 1
        ? accent2
        : (extra[(i - 2) % extra.length] as string),
  );
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface VizDrawOptions {
  style: VizStyle;
  labels: boolean;
  /** CSS color of the panel behind the lanes; "transparent" draws none */
  background: string;
}

const MAX_LANES = 6;

/** Draws every series into its own lane of `box` (stacked; rings sit side by side). */
export function drawViz(
  ctx: Ctx,
  box: Box,
  series: readonly VizSeries[],
  opts: VizDrawOptions,
): void {
  if (box.w < 4 || box.h < 4) return;
  if (opts.background !== "transparent") {
    ctx.fillStyle = opts.background;
    ctx.fillRect(box.x, box.y, box.w, box.h);
  }
  const lanes = series.slice(0, MAX_LANES);
  if (lanes.length === 0) return;
  const ring = opts.style === "ring";
  const cols = ring ? lanes.length : 1;
  const rows = ring ? 1 : lanes.length;
  const lw = box.w / cols;
  const lh = box.h / rows;
  lanes.forEach((s, i) => {
    const lane: Box = {
      x: box.x + (ring ? i * lw : 0),
      y: box.y + (ring ? 0 : i * lh),
      w: lw,
      h: lh,
    };
    drawLane(ctx, lane, s, opts.style);
    if (opts.labels && s.label) drawLabel(ctx, lane, s);
  });
}

function drawLane(ctx: Ctx, b: Box, s: VizSeries, style: VizStyle): void {
  const n = s.bars.length;
  if (n === 0) return;
  const pad = Math.min(b.w, b.h) * 0.06;
  const x0 = b.x + pad;
  const w = b.w - pad * 2;
  const y0 = b.y + pad;
  const h = b.h - pad * 2;
  ctx.save();
  ctx.fillStyle = s.color;
  ctx.strokeStyle = s.color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (style === "bars" || style === "mirror") {
    const gap = w / n;
    const bw = Math.max(1, gap * 0.68);
    const mid = y0 + h / 2;
    for (let i = 0; i < n; i++) {
      const v = clamp01(s.bars[i] as number);
      const bh = Math.max(2, v * (style === "mirror" ? h / 2 : h));
      const x = x0 + i * gap + (gap - bw) / 2;
      if (style === "mirror") {
        roundRect(ctx, x, mid - bh, bw, bh * 2, bw / 2);
      } else {
        roundRect(ctx, x, y0 + h - bh, bw, bh, bw / 2);
      }
    }
  } else if (style === "wave") {
    const mid = y0 + h / 2;
    ctx.lineWidth = Math.max(2, h * 0.025);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = x0 + (w * i) / Math.max(1, n - 1);
      const v = clamp01(s.bars[i] as number) * (h / 2) * (i % 2 === 0 ? 1 : -1);
      if (i === 0) ctx.moveTo(x, mid + v);
      else ctx.lineTo(x, mid + v);
    }
    ctx.stroke();
  } else {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const r0 = Math.min(w, h) * 0.22;
    const rMax = Math.min(w, h) / 2;
    ctx.lineWidth = Math.max(2, (Math.PI * 2 * r0) / n / 1.8);
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n - Math.PI / 2;
      const v = clamp01(s.bars[i] as number);
      const r1 = r0 + (rMax - r0) * Math.max(0.04, v);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawLabel(ctx: Ctx, b: Box, s: VizSeries): void {
  const size = Math.max(14, Math.min(b.h * 0.16, 44));
  ctx.save();
  ctx.font = `600 ${size}px "Space Grotesk", sans-serif`;
  ctx.textBaseline = "top";
  const text = s.label.slice(0, 40);
  const tw = ctx.measureText(text).width;
  const x = b.x + size * 0.5;
  const y = b.y + size * 0.4;
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  roundRect(
    ctx,
    x - size * 0.35,
    y - size * 0.15,
    tw + size * 1.2,
    size * 1.3,
    size * 0.3,
  );
  ctx.fillStyle = s.color;
  ctx.beginPath();
  ctx.arc(
    x + size * 0.12,
    y + size * 0.5,
    size * (0.1 + clamp01(s.level) * 0.1),
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, x + size * 0.45, y);
  ctx.restore();
}

function roundRect(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
  ctx.fill();
}
