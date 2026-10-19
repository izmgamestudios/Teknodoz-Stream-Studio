// src/studio/room/badge.ts
// Tiny global store with what needs the director's attention (guests waiting for approval and
// chat messages waiting for moderation), so the sidebar (which lives outside the studio runtime
// tree) can show badges and the tab title can announce them.
export interface RoomBadgeState {
  readonly waiting: number;
  readonly chat: number;
}

const ZERO: RoomBadgeState = Object.freeze({ waiting: 0, chat: 0 });
let state: RoomBadgeState = ZERO;
const listeners = new Set<() => void>();

export const roomBadge = {
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  /** Stable reference until a value changes (safe for useSyncExternalStore). */
  get: (): RoomBadgeState => state,
  getServer: (): RoomBadgeState => ZERO,
  set(next: Partial<RoomBadgeState>): void {
    const merged = { ...state, ...next };
    if (merged.waiting === state.waiting && merged.chat === state.chat) return;
    state = Object.freeze(merged);
    for (const l of [...listeners]) l();
  },
};
