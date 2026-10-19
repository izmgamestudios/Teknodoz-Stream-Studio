// src/studio/sponsors/exposure.ts
// Counts how long each sponsor was actually ON SCREEN while the program was on air (recording or
// live). It is "screen time", not audience impressions: viewer numbers live in the platforms' own
// analytics. Driven by the compositor clock, so it needs no timers of its own.

/** Longest frame gap that still counts as continuous drawing (ms). */
const MAX_GAP_MS = 500;

export interface ExposureData {
  /** all time, ms per sponsor id */
  totalMs: Record<string, number>;
  /** the current / most recent on-air session, ms per sponsor id */
  sessionMs: Record<string, number>;
  /** wall clock of the session start (ms since epoch), null before the first one */
  sessionStartedAt: number | null;
}

export function emptyExposure(): ExposureData {
  return { totalMs: {}, sessionMs: {}, sessionStartedAt: null };
}

export class SponsorExposure {
  private d: ExposureData = emptyExposure();
  private last: number | null = null;
  private onAir = false;
  private dirty = false;

  /** Recording / live state; a new on-air period starts a new session. */
  setOnAir(on: boolean, wallNow = Date.now()): void {
    if (on === this.onAir) return;
    this.onAir = on;
    this.last = null;
    if (on) {
      this.d = { ...this.d, sessionMs: {}, sessionStartedAt: wallNow };
      this.dirty = true;
    }
  }

  /** Call once per drawn frame with the ids that were shown and the compositor time. */
  record(ids: readonly string[], nowMs: number): void {
    const prev = this.last;
    this.last = nowMs;
    if (!this.onAir || prev === null || ids.length === 0) return;
    const dt = nowMs - prev;
    if (!(dt > 0) || dt > MAX_GAP_MS) return;
    for (const id of ids) {
      this.d.totalMs[id] = (this.d.totalMs[id] ?? 0) + dt;
      this.d.sessionMs[id] = (this.d.sessionMs[id] ?? 0) + dt;
    }
    this.dirty = true;
  }

  get isOnAir(): boolean {
    return this.onAir;
  }
  snapshot(): ExposureData {
    return {
      totalMs: { ...this.d.totalMs },
      sessionMs: { ...this.d.sessionMs },
      sessionStartedAt: this.d.sessionStartedAt,
    };
  }
  /** True once since the last call when something changed (persist it). */
  takeDirty(): boolean {
    const was = this.dirty;
    this.dirty = false;
    return was;
  }
  /** Restore persisted data (ignores anything malformed). */
  restore(raw: unknown): void {
    const num = (v: unknown): v is number =>
      typeof v === "number" && Number.isFinite(v) && v >= 0;
    const map = (v: unknown): Record<string, number> => {
      const out: Record<string, number> = {};
      if (typeof v === "object" && v !== null)
        for (const [k, val] of Object.entries(v as Record<string, unknown>))
          if (k.length <= 128 && num(val)) out[k] = val;
      return out;
    };
    if (typeof raw !== "object" || raw === null) return;
    const r = raw as Record<string, unknown>;
    this.d = {
      totalMs: map(r["totalMs"]),
      sessionMs: map(r["sessionMs"]),
      sessionStartedAt: num(r["sessionStartedAt"])
        ? r["sessionStartedAt"]
        : null,
    };
  }
  /** Forget the data of removed sponsors. */
  prune(liveIds: ReadonlySet<string>): void {
    let changed = false;
    for (const m of [this.d.totalMs, this.d.sessionMs])
      for (const id of Object.keys(m))
        if (!liveIds.has(id)) {
          delete m[id];
          changed = true;
        }
    if (changed) this.dirty = true;
  }
  /** Start over (explicit "reset report"). */
  clear(): void {
    this.d = emptyExposure();
    this.dirty = true;
  }
}
