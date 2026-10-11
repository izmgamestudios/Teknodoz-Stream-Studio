// src/studio/room/badge.ts
// Tiny global store with the number of guests waiting for approval, so the sidebar (which lives
// outside the studio runtime tree) can show a badge and the tab title can announce requests.
let count = 0;
const listeners = new Set<() => void>();

export const roomBadge = {
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  get: (): number => count,
  getServer: (): number => 0,
  set(n: number): void {
    if (n === count) return;
    count = n;
    for (const l of [...listeners]) l();
  },
};
