// src/studio/podcast/prompter.ts
// Podcast prompter maths (pure): default state, clamping, the scroll step and the resync rule.
import { MAX_PROMPTER_CHARS } from "../p2p/protocol";
import type { PodcastPrompter } from "../types";

export const DEFAULT_PROMPTER: Readonly<PodcastPrompter> = {
  text: "",
  playing: false,
  speed: 40,
  pos: 0,
  size: 40,
};

export const SPEED_STEPS = [10, 20, 30, 40, 60, 80, 120, 160] as const;
export const SIZE_MIN = 20;
export const SIZE_MAX = 96;

const clamp = (n: number, lo: number, hi: number): number =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;

/** A state that is always valid for the wire (text capped, numbers clamped). */
export function normalizePrompter(
  p: Partial<PodcastPrompter>,
): PodcastPrompter {
  return {
    text: (p.text ?? DEFAULT_PROMPTER.text).slice(0, MAX_PROMPTER_CHARS),
    playing: p.playing ?? false,
    speed: clamp(p.speed ?? DEFAULT_PROMPTER.speed, 0, 2000),
    pos: clamp(p.pos ?? 0, 0, 1),
    size: clamp(p.size ?? DEFAULT_PROMPTER.size, 12, 160),
  };
}

/** Next scroll offset after `dtMs` of playback; stops at the end (returns `done`). */
export function nextScroll(
  scrollTop: number,
  maxScroll: number,
  speed: number,
  dtMs: number,
  playing: boolean,
): { top: number; done: boolean } {
  if (!playing || maxScroll <= 0) return { top: scrollTop, done: false };
  const top = Math.min(
    maxScroll,
    scrollTop + (speed * Math.max(0, dtMs)) / 1000,
  );
  return { top, done: top >= maxScroll };
}

export const scrollRatio = (scrollTop: number, maxScroll: number): number =>
  maxScroll > 0 ? clamp(scrollTop / maxScroll, 0, 1) : 0;

/**
 * A remote position only moves the local scroll when it differs noticeably (otherwise the local
 * smooth scrolling is left alone), or when playback is paused (manual positioning).
 */
export function shouldResync(
  localRatio: number,
  remoteRatio: number,
  playing: boolean,
  tolerance = 0.03,
): boolean {
  return !playing || Math.abs(localRatio - remoteRatio) > tolerance;
}

/** Speed one step up / down in SPEED_STEPS (stays inside the list). */
export function stepSpeed(speed: number, dir: 1 | -1): number {
  const i = SPEED_STEPS.findIndex((s) => s >= speed);
  const at = i === -1 ? SPEED_STEPS.length - 1 : i;
  const next = Math.min(SPEED_STEPS.length - 1, Math.max(0, at + dir));
  return SPEED_STEPS[next] as number;
}

/** Words per minute for display (about 6 px of travel per word at the default font size). */
export const wordCount = (text: string): number =>
  text.trim() ? text.trim().split(/\s+/).length : 0;
