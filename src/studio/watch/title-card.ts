// src/studio/watch/title-card.ts
// Renders an intro / outro title card to a PNG with a canvas, in the browser. Text is drawn here
// (not by an ffmpeg filter), so any alphabet works and nothing user-typed reaches the server's
// command line.

export interface TitleCard {
  title: string;
  subtitle: string;
  background: string;
  foreground: string;
  width: number;
  height: number;
}

export const DEFAULT_CARD: Omit<TitleCard, "width" | "height"> = {
  title: "",
  subtitle: "",
  background: "#0b1220",
  foreground: "#ffffff",
};

/** Greedy word wrap with a pluggable measure function (testable without a canvas). */
export function wrapLines(
  measure: (s: string) => number,
  text: string,
  maxWidth: number,
): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next) > maxWidth) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export function drawTitleCard(
  ctx: CanvasRenderingContext2D,
  card: TitleCard,
): void {
  const { width: W, height: H } = card;
  const bg = HEX.test(card.background)
    ? card.background
    : DEFAULT_CARD.background;
  const fg = HEX.test(card.foreground)
    ? card.foreground
    : DEFAULT_CARD.foreground;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // a thin accent bar keeps flat colours from looking unfinished
  ctx.fillStyle = fg;
  ctx.globalAlpha = 0.25;
  ctx.fillRect(W * 0.1, H * 0.5 + H * 0.12, W * 0.8, Math.max(2, H * 0.004));
  ctx.globalAlpha = 1;

  const family = '"Space Grotesk", system-ui, sans-serif';
  const maxW = W * 0.8;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = fg;

  const tSize = Math.round(Math.min(W, H) * 0.09);
  ctx.font = `700 ${tSize}px ${family}`;
  const tLines = wrapLines(
    (s) => ctx.measureText(s).width,
    card.title.trim(),
    maxW,
  ).slice(0, 3);
  const sSize = Math.round(tSize * 0.5);
  ctx.font = `400 ${sSize}px ${family}`;
  const sLines = card.subtitle.trim()
    ? wrapLines(
        (s) => ctx.measureText(s).width,
        card.subtitle.trim(),
        maxW,
      ).slice(0, 2)
    : [];

  const gap = tSize * 0.4;
  const blockH =
    tLines.length * tSize * 1.15 +
    (sLines.length ? gap + sLines.length * sSize * 1.2 : 0);
  let y = (H - blockH) / 2 + tSize;
  ctx.font = `700 ${tSize}px ${family}`;
  for (const l of tLines) {
    ctx.fillText(l, W / 2, y);
    y += tSize * 1.15;
  }
  y += gap - tSize * 0.15 + sSize * 0.2;
  ctx.font = `400 ${sSize}px ${family}`;
  ctx.globalAlpha = 0.85;
  for (const l of sLines) {
    ctx.fillText(l, W / 2, y);
    y += sSize * 1.2;
  }
  ctx.globalAlpha = 1;
}

export function renderTitleCard(card: TitleCard): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = card.width;
  canvas.height = card.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  drawTitleCard(ctx, card);
  return new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/png"),
  );
}
