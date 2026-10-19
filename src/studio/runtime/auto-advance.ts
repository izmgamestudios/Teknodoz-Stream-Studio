// src/studio/runtime/auto-advance.ts
// Rundown automation: a scene with `autoAdvanceSec > 0` hands over to the next scene after that
// many seconds. Pure helpers (the runtime owns the timer).
import type { Scene } from "../types";

export interface AutoPlan {
  /** seconds the active scene stays on air */
  seconds: number;
  /** id of the scene to switch to; null when the active scene is the last one */
  nextId: string | null;
}

/** What should happen after the active scene? null = this scene has no automation. */
export function planAutoAdvance(
  scenes: readonly Scene[],
  activeId: string,
): AutoPlan | null {
  const i = scenes.findIndex((s) => s.id === activeId);
  const cur = scenes[i];
  if (!cur) return null;
  const seconds = Number(cur.autoAdvanceSec);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return {
    seconds: Math.min(3600, seconds),
    nextId: scenes[i + 1]?.id ?? null,
  };
}

/** Whole seconds left (ceil), never negative. */
export const secondsLeft = (deadlineMs: number, nowMs: number): number =>
  Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
