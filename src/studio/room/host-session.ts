// src/studio/room/host-session.ts
// Host side of a room: owns the short code, long-polls the relay, keeps the waiting pool and
// performs the WebRTC handshake with each approved guest through a small bridge to the P2P host.
import type { KvStore, PeerInfo, PeerRole } from "../types";
import {
  RoomApiError,
  buildRoomLink,
  createRoomApi,
  type HostEvent,
  type RoomApi,
  type RoomRole,
} from "./api";
import { loadLog, newLogId, saveLog, type LogEntry, type LogKind } from "./log";

/** What the session needs from the studio runtime (kept as an interface to avoid cycles). */
export interface HostBridge {
  createInvite(
    role: PeerRole,
    name?: string,
  ): Promise<{ peerId: string; code: string }>;
  acceptAnswer(peerId: string, code: string): Promise<void>;
  kickPeer(peerId: string): boolean;
  getPeers(): readonly PeerInfo[];
  subscribePeers(cb: () => void): () => void;
}

export type PoolState =
  | "waiting"
  | "approving"
  | "connecting"
  | "connected"
  | "failed"
  | "rejected"
  | "left";

export interface PoolEntry {
  guestId: string;
  name: string;
  role: RoomRole;
  requestedAt: number;
  state: PoolState;
  peerId?: string;
  note?: string;
  /** when the entry reached a terminal state (used to prune it from the list) */
  endedAt?: number;
}

export type RoomStatus = "idle" | "opening" | "open" | "unavailable" | "error";

export interface RoomSnapshot {
  readonly status: RoomStatus;
  readonly code: string | null;
  /** false while the long-poll cannot reach the relay */
  readonly online: boolean;
  readonly pool: readonly PoolEntry[];
  readonly waiting: number;
  readonly log: readonly LogEntry[];
  readonly autoApprove: Readonly<Record<RoomRole, boolean>>;
  readonly error: string | null;
}

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export interface HostSessionOptions {
  bridge: HostBridge;
  kv: KvStore;
  api?: RoomApi;
  storage?: StorageLike | null;
  now?: () => number;
  /** how long an approved guest may take to connect before it counts as failed */
  connectTimeoutMs?: number;
  /** how long finished entries stay visible */
  keepEndedMs?: number;
  waitSec?: number;
}

const STORE_KEY = "tkz.room.v1";
const AUTO_KEY = "tkz.room.auto.v1";
const ROLES: RoomRole[] = ["guest", "viewer", "remote"];
const ROLE_LABEL: Record<RoomRole, string> = {
  guest: "konuk",
  viewer: "izleyici",
  remote: "telefon kumandası",
};
const TERMINAL: ReadonlySet<PoolState> = new Set([
  "failed",
  "rejected",
  "left",
]);

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function errorCode(e: unknown): string {
  return e instanceof RoomApiError ? e.code : "error";
}

export class RoomHostSession {
  private readonly bridge: HostBridge;
  private readonly kv: KvStore;
  private readonly api: RoomApi;
  private readonly storage: StorageLike | null;
  private readonly now: () => number;
  private readonly connectTimeoutMs: number;
  private readonly keepEndedMs: number;
  private readonly waitSec: number;

  private status: RoomStatus = "idle";
  private code: string | null = null;
  private token: string | null = null;
  private since = 0;
  private online = true;
  private error: string | null = null;
  private pool = new Map<string, PoolEntry>();
  private log: LogEntry[] = [];
  private auto: Record<RoomRole, boolean> = {
    guest: false,
    viewer: false,
    remote: false,
  };
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private abort: AbortController | null = null;
  private runId = 0;
  private snap: RoomSnapshot;
  private listeners = new Set<() => void>();
  private unsubPeers: (() => void) | null = null;
  private logLoaded: Promise<void>;
  private disposed = false;

  constructor(opts: HostSessionOptions) {
    this.bridge = opts.bridge;
    this.kv = opts.kv;
    this.api = opts.api ?? createRoomApi();
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.now = opts.now ?? (() => Date.now());
    this.connectTimeoutMs = opts.connectTimeoutMs ?? 60_000;
    this.keepEndedMs = opts.keepEndedMs ?? 120_000;
    this.waitSec = opts.waitSec ?? 20;
    this.auto = this.readAuto();
    this.snap = this.build();
    this.logLoaded = loadLog(this.kv).then((l) => {
      // keep anything logged while loading
      this.log = [...l, ...this.log];
      this.emit();
    });
    this.unsubPeers = this.bridge.subscribePeers(() => this.onPeers());
  }

  /* ------------------------------- store ------------------------------- */

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getSnapshot = (): RoomSnapshot => this.snap;

  private build(): RoomSnapshot {
    const t = this.now();
    const pool = [...this.pool.values()]
      .filter(
        (e) => e.endedAt === undefined || t - e.endedAt < this.keepEndedMs,
      )
      .sort((a, b) => a.requestedAt - b.requestedAt);
    return {
      status: this.status,
      code: this.code,
      online: this.online,
      pool,
      waiting: pool.filter((e) => e.state === "waiting").length,
      log: this.log,
      autoApprove: { ...this.auto },
      error: this.error,
    };
  }
  private emit(): void {
    this.snap = this.build();
    for (const l of [...this.listeners]) l();
  }

  link(role?: RoomRole): string {
    const origin = typeof location === "undefined" ? "" : location.origin;
    return this.code ? buildRoomLink(origin, this.code, role) : "";
  }

  /* -------------------------------- log -------------------------------- */

  private record(kind: LogKind, text: string, guestId?: string): void {
    const at = this.now();
    this.log = [
      ...this.log,
      { id: newLogId(at), at, kind, text, ...(guestId ? { guestId } : {}) },
    ].slice(-500);
    void this.logLoaded.then(() => saveLog(this.kv, this.log));
  }

  async clearLog(): Promise<void> {
    this.log = [];
    await saveLog(this.kv, this.log);
    this.emit();
  }

  /* ----------------------------- auto approve ----------------------------- */

  private readAuto(): Record<RoomRole, boolean> {
    const out: Record<RoomRole, boolean> = {
      guest: false,
      viewer: false,
      remote: false,
    };
    try {
      const raw = this.storage?.getItem(AUTO_KEY);
      const p = raw
        ? (JSON.parse(raw) as Partial<Record<RoomRole, unknown>>)
        : {};
      for (const r of ROLES) out[r] = p[r] === true;
    } catch {
      // ignore corrupt storage
    }
    return out;
  }

  setAutoApprove(role: RoomRole, on: boolean): void {
    this.auto = { ...this.auto, [role]: on };
    try {
      this.storage?.setItem(AUTO_KEY, JSON.stringify(this.auto));
    } catch {
      // ignore
    }
    this.record(
      "room",
      `Otomatik onay (${ROLE_LABEL[role]}): ${on ? "açık" : "kapalı"}`,
    );
    this.emit();
    if (on)
      for (const e of this.pool.values())
        if (e.state === "waiting" && e.role === role)
          void this.approve(e.guestId);
  }

  /* ------------------------------ lifecycle ------------------------------ */

  /** Create a room (or resume the saved one) and start listening for requests. */
  async open(): Promise<boolean> {
    if (this.disposed || this.status === "opening")
      return this.status === "open";
    if (this.status === "open") return true;
    this.status = "opening";
    this.error = null;
    this.emit();
    try {
      let resumed = false;
      const saved = this.readSaved();
      if (saved) {
        try {
          await this.api.hostEvents(saved.code, saved.token, saved.since, 0);
          this.code = saved.code;
          this.token = saved.token;
          this.since = saved.since;
          resumed = true;
        } catch (e) {
          if (
            !(e instanceof RoomApiError) ||
            (e.code !== "forbidden" &&
              e.code !== "not-found" &&
              e.code !== "closed")
          )
            throw e;
          this.forgetSaved();
        }
      }
      if (!resumed) {
        const r = await this.api.createRoom();
        this.code = r.code;
        this.token = r.hostToken;
        this.since = 0;
        this.persist();
        this.record("room", `Oda oluşturuldu: ${r.code}`);
      } else {
        this.record("room", `Oda yeniden bağlandı: ${this.code}`);
      }
      this.status = "open";
      this.online = true;
      this.emit();
      void this.loop(++this.runId);
      return true;
    } catch (e) {
      const code = errorCode(e);
      this.status =
        code === "unavailable" || code === "network" ? "unavailable" : "error";
      this.error = code;
      this.record("error", `Oda açılamadı (${code})`);
      this.emit();
      return false;
    }
  }

  private readSaved(): { code: string; token: string; since: number } | null {
    try {
      const raw = this.storage?.getItem(STORE_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw) as {
        code?: unknown;
        token?: unknown;
        since?: unknown;
      };
      if (typeof p.code === "string" && typeof p.token === "string") {
        return {
          code: p.code,
          token: p.token,
          since: typeof p.since === "number" ? p.since : 0,
        };
      }
    } catch {
      // ignore
    }
    return null;
  }
  private persist(): void {
    if (!this.code || !this.token) return;
    try {
      this.storage?.setItem(
        STORE_KEY,
        JSON.stringify({
          code: this.code,
          token: this.token,
          since: this.since,
        }),
      );
    } catch {
      // ignore
    }
  }
  private forgetSaved(): void {
    try {
      this.storage?.removeItem(STORE_KEY);
    } catch {
      // ignore
    }
  }

  /** Close the room on the relay. Connected peers stay connected (they are direct). */
  async close(): Promise<void> {
    const code = this.code;
    const token = this.token;
    this.stopLoop();
    this.forgetSaved();
    this.code = null;
    this.token = null;
    this.status = "idle";
    this.pool.clear();
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    if (code && token) {
      this.record("room", `Oda kapatıldı: ${code}`);
      try {
        await this.api.closeRoom(code, token);
      } catch {
        // already gone
      }
    }
    this.emit();
  }

  /** Close and open a fresh room with a new code (invalidates every old link). */
  async newRoom(): Promise<boolean> {
    await this.close();
    return this.open();
  }

  private stopLoop(): void {
    this.runId++;
    this.abort?.abort();
    this.abort = null;
  }

  private async loop(run: number): Promise<void> {
    let backoff = 1000;
    while (run === this.runId && !this.disposed && this.code && this.token) {
      const ac = new AbortController();
      this.abort = ac;
      try {
        const r = await this.api.hostEvents(
          this.code,
          this.token,
          this.since,
          this.waitSec,
          ac.signal,
        );
        if (run !== this.runId) return;
        if (!this.online) {
          this.online = true;
          this.record("room", "Röle bağlantısı geri geldi");
        }
        backoff = 1000;
        this.since = r.next;
        this.persist();
        for (const ev of r.events) this.handleEvent(ev);
        if (r.closed) {
          this.status = "error";
          this.error = "closed";
          this.emit();
          return;
        }
        this.emit();
      } catch (e) {
        if (run !== this.runId) return;
        if ((e as { name?: string } | null)?.name === "AbortError") return;
        const code = errorCode(e);
        if (code === "forbidden" || code === "not-found" || code === "closed") {
          this.status = "error";
          this.error = code;
          this.record("error", `Oda kayboldu (${code})`);
          this.forgetSaved();
          this.emit();
          return;
        }
        if (this.online) {
          this.online = false;
          this.record("error", `Röle bağlantısı koptu (${code})`);
          this.emit();
        }
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 10_000);
      }
    }
  }

  /* ------------------------------- events ------------------------------- */

  private handleEvent(ev: HostEvent): void {
    if (ev.type === "join") {
      if (this.pool.has(ev.guestId)) return;
      const role = ev.role ?? "guest";
      const entry: PoolEntry = {
        guestId: ev.guestId,
        name: ev.name ?? "Konuk",
        role,
        requestedAt: ev.at ?? this.now(),
        state: "waiting",
      };
      this.pool.set(ev.guestId, entry);
      this.record(
        "request",
        `Katılma isteği: ${entry.name} (${ROLE_LABEL[role]})`,
        ev.guestId,
      );
      if (this.auto[role]) void this.approve(ev.guestId);
    } else if (ev.type === "answer") {
      const e = this.pool.get(ev.guestId);
      if (!e || !e.peerId || !ev.answer) return;
      const peerId = e.peerId;
      void this.bridge.acceptAnswer(peerId, ev.answer).catch((err) => {
        this.finish(e, "failed", `Yanıt işlenemedi (${errorCode(err)})`);
      });
    } else if (ev.type === "leave") {
      const e = this.pool.get(ev.guestId);
      if (!e) return;
      if (e.state === "waiting" || e.state === "approving") {
        this.finish(
          e,
          "left",
          ev.reason === "stale" ? "Sayfayı kapattı (zaman aşımı)" : "Vazgeçti",
        );
      }
    }
  }

  private finish(e: PoolEntry, state: PoolState, note: string): void {
    const t = this.timers.get(e.guestId);
    if (t) clearTimeout(t);
    this.timers.delete(e.guestId);
    e.state = state;
    e.note = note;
    e.endedAt = this.now();
    this.record(
      state === "rejected"
        ? "reject"
        : state === "failed"
          ? "error"
          : "disconnect",
      `${e.name}: ${note}`,
      e.guestId,
    );
    this.emit();
  }

  private onPeers(): void {
    const peers = this.bridge.getPeers();
    let changed = false;
    for (const e of this.pool.values()) {
      if (!e.peerId || TERMINAL.has(e.state)) continue;
      const p = peers.find((x) => x.id === e.peerId);
      if (!p) {
        if (e.state === "connected") {
          this.finish(e, "left", "Bağlantı koptu");
          changed = true;
        }
        continue;
      }
      if (p.status === "disconnected") {
        this.finish(
          e,
          e.state === "connected" ? "left" : "failed",
          e.state === "connected" ? "Bağlantı koptu" : "Bağlantı kurulamadı",
        );
        changed = true;
      } else if (p.status !== "connecting" && e.state === "connecting") {
        e.state = "connected";
        const t = this.timers.get(e.guestId);
        if (t) clearTimeout(t);
        this.timers.delete(e.guestId);
        this.record(
          "connect",
          `${e.name} bağlandı (${ROLE_LABEL[e.role]})`,
          e.guestId,
        );
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  /* ------------------------------- actions ------------------------------- */

  /** Approve a waiting guest: create the WebRTC offer and hand it over through the relay. */
  async approve(guestId: string): Promise<boolean> {
    const e = this.pool.get(guestId);
    if (!e || e.state !== "waiting" || !this.code || !this.token) return false;
    e.state = "approving";
    this.emit();
    try {
      const inv = await this.bridge.createInvite(e.role, e.name);
      e.peerId = inv.peerId;
      await this.api.hostOffer(this.code, this.token, guestId, inv.code);
      e.state = "connecting";
      this.record(
        "approve",
        `Onaylandı: ${e.name} (${ROLE_LABEL[e.role]})`,
        guestId,
      );
      this.timers.set(
        guestId,
        setTimeout(() => {
          if (e.state === "connecting") {
            if (e.peerId) this.bridge.kickPeer(e.peerId);
            this.finish(
              e,
              "failed",
              "Bağlantı zaman aşımı (NAT/güvenlik duvarı olabilir)",
            );
          }
        }, this.connectTimeoutMs),
      );
      this.emit();
      return true;
    } catch (err) {
      if (e.peerId) this.bridge.kickPeer(e.peerId);
      this.finish(e, "failed", `Onay gönderilemedi (${errorCode(err)})`);
      return false;
    }
  }

  async approveAll(): Promise<void> {
    const waiting = [...this.pool.values()].filter(
      (e) => e.state === "waiting",
    );
    for (const e of waiting) await this.approve(e.guestId);
  }

  async reject(guestId: string): Promise<boolean> {
    const e = this.pool.get(guestId);
    if (
      !e ||
      (e.state !== "waiting" && e.state !== "approving") ||
      !this.code ||
      !this.token
    )
      return false;
    try {
      await this.api.hostReject(this.code, this.token, guestId);
    } catch {
      // the guest may already be gone
    }
    this.finish(e, "rejected", "Reddedildi");
    return true;
  }

  /** Disconnect a connected guest/viewer/remote. */
  kick(guestId: string): void {
    const e = this.pool.get(guestId);
    if (!e?.peerId) return;
    this.bridge.kickPeer(e.peerId);
    this.finish(e, "left", "Yayıncı bağlantıyı kesti");
  }

  dispose(): void {
    this.disposed = true;
    this.stopLoop();
    this.unsubPeers?.();
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.listeners.clear();
  }
}
