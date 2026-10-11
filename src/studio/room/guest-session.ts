// src/studio/room/guest-session.ts
// Guest side of a room: asks to join, waits in the pool, and answers the host's offer
// automatically once approved. The guest never copies or pastes any code.
import { StudioClient } from "../p2p";
import { RoomChatClient } from "./chat-client";
import {
  RoomApiError,
  createRoomApi,
  type FetchLike,
  type RoomApi,
  type RoomRole,
} from "./api";

export type GuestPhase =
  | "idle"
  | "joining"
  | "waiting"
  | "connecting"
  | "connected"
  /** chat-only seat: no WebRTC, just the moderated chat */
  | "chatting"
  | "rejected"
  | "closed"
  | "error";

export interface GuestSnapshot {
  readonly phase: GuestPhase;
  readonly hostOnline: boolean;
  readonly error: string | null;
  readonly name: string;
  readonly role: RoomRole | null;
  readonly client: StudioClient | null;
}

export interface GuestSessionOptions {
  code: string;
  api?: RoomApi;
  fetch?: FetchLike;
  usePublicStun?: boolean;
  storage?: {
    getItem(k: string): string | null;
    setItem(k: string, v: string): void;
    removeItem(k: string): void;
  } | null;
  waitSec?: number;
  /** test seam */
  acceptOffer?: typeof StudioClient.acceptOffer;
}

interface Saved {
  guestId: string;
  token: string;
  name: string;
  role: RoomRole;
}

function defaultStorage(): GuestSessionOptions["storage"] {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export class RoomGuestSession {
  /** moderated room chat; connects once the host has accepted our answer */
  readonly chat: RoomChatClient;
  private readonly code: string;
  private readonly api: RoomApi;
  private readonly usePublicStun: boolean;
  private readonly storage: GuestSessionOptions["storage"];
  private readonly waitSec: number;
  private readonly acceptOffer: typeof StudioClient.acceptOffer;

  private phase: GuestPhase = "idle";
  private hostOnline = true;
  private error: string | null = null;
  private name = "";
  private role: RoomRole | null = null;
  private client: StudioClient | null = null;
  private guestId: string | null = null;
  private token: string | null = null;
  private since = 0;
  private runId = 0;
  private abort: AbortController | null = null;
  private snap: GuestSnapshot;
  private listeners = new Set<() => void>();
  private disposed = false;

  constructor(opts: GuestSessionOptions) {
    this.code = opts.code.toUpperCase();
    this.api =
      opts.api ?? createRoomApi(opts.fetch ? { fetch: opts.fetch } : {});
    this.usePublicStun = opts.usePublicStun ?? true;
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.waitSec = opts.waitSec ?? 20;
    this.acceptOffer =
      opts.acceptOffer ?? StudioClient.acceptOffer.bind(StudioClient);
    this.chat = new RoomChatClient({ api: this.api, waitSec: this.waitSec });
    this.snap = this.build();
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getSnapshot = (): GuestSnapshot => this.snap;

  private build(): GuestSnapshot {
    return {
      phase: this.phase,
      hostOnline: this.hostOnline,
      error: this.error,
      name: this.name,
      role: this.role,
      client: this.client,
    };
  }
  private set(
    p: Partial<{
      phase: GuestPhase;
      error: string | null;
      hostOnline: boolean;
    }>,
  ): void {
    if (p.phase !== undefined) this.phase = p.phase;
    if (p.error !== undefined) this.error = p.error;
    if (p.hostOnline !== undefined) this.hostOnline = p.hostOnline;
    this.snap = this.build();
    for (const l of [...this.listeners]) l();
  }

  private key(): string {
    return `tkz.guest.${this.code}`;
  }

  /** Is the room reachable and open? */
  async check(): Promise<"ok" | "missing" | "closed" | "unavailable"> {
    try {
      const i = await this.api.info(this.code);
      this.hostOnline = i.hostOnline;
      this.snap = this.build();
      return i.open ? "ok" : "closed";
    } catch (e) {
      if (e instanceof RoomApiError && e.code === "not-found") return "missing";
      if (e instanceof RoomApiError && e.code === "closed") return "closed";
      return "unavailable";
    }
  }

  /** Reload during the waiting phase: continue with the same pool entry if it is still valid. */
  async resume(): Promise<boolean> {
    try {
      const raw = this.storage?.getItem(this.key());
      if (!raw) return false;
      const s = JSON.parse(raw) as Saved;
      if (!s.guestId || !s.token) return false;
      if (s.role === "chat")
        await this.api.guestChatPoll(this.code, s.guestId, s.token, 0, 0);
      else await this.api.guestEvents(this.code, s.guestId, s.token, 0, 0);
      this.guestId = s.guestId;
      this.token = s.token;
      this.name = s.name;
      this.role = s.role;
      if (s.role === "chat") {
        this.enterChat();
        return true;
      }
      this.set({ phase: "waiting", error: null });
      void this.loop(++this.runId);
      return true;
    } catch {
      this.storage?.removeItem(this.key());
      return false;
    }
  }

  async join(name: string, role: RoomRole): Promise<boolean> {
    if (this.phase === "joining" || this.disposed) return false;
    this.name = name.trim();
    this.role = role;
    this.set({ phase: "joining", error: null });
    try {
      const r = await this.api.join(this.code, { name: this.name, role });
      this.guestId = r.guestId;
      this.token = r.guestToken;
      this.name = r.name;
      try {
        this.storage?.setItem(
          this.key(),
          JSON.stringify({
            guestId: r.guestId,
            token: r.guestToken,
            name: r.name,
            role,
          }),
        );
      } catch {
        // ignore
      }
      this.since = 0;
      if (role === "chat") {
        this.enterChat();
        return true;
      }
      this.set({ phase: "waiting" });
      void this.loop(++this.runId);
      return true;
    } catch (e) {
      this.set({
        phase: "error",
        error: e instanceof RoomApiError ? e.code : "network",
      });
      return false;
    }
  }

  /** Chat-only seat: the relay already treats us as approved; just open the chat. */
  private enterChat(): void {
    this.chat.connect(this.code, {
      kind: "guest",
      guestId: this.guestId as string,
      token: this.token as string,
    });
    this.set({ phase: "chatting", error: null });
  }

  private async loop(run: number): Promise<void> {
    let backoff = 1000;
    while (run === this.runId && !this.disposed && this.guestId && this.token) {
      const ac = new AbortController();
      this.abort = ac;
      try {
        const r = await this.api.guestEvents(
          this.code,
          this.guestId,
          this.token,
          this.since,
          this.waitSec,
          ac.signal,
        );
        if (run !== this.runId) return;
        backoff = 1000;
        this.since = r.next;
        if (r.hostOnline !== this.hostOnline)
          this.set({ hostOnline: r.hostOnline });
        for (const ev of r.events) {
          if (ev.type === "rejected") {
            this.storage?.removeItem(this.key());
            this.set({ phase: "rejected" });
            return;
          }
          if (ev.type === "closed") {
            this.storage?.removeItem(this.key());
            this.set({ phase: "closed" });
            return;
          }
          if (ev.type === "offer" && ev.offer) {
            await this.onOffer(ev.offer);
            return;
          }
        }
        if (r.closed) {
          this.set({ phase: "closed" });
          return;
        }
      } catch (e) {
        if (run !== this.runId) return;
        if ((e as { name?: string } | null)?.name === "AbortError") return;
        if (
          e instanceof RoomApiError &&
          (e.code === "forbidden" || e.code === "not-found")
        ) {
          this.storage?.removeItem(this.key());
          this.set({ phase: "error", error: e.code });
          return;
        }
        await new Promise((res) => setTimeout(res, backoff));
        backoff = Math.min(backoff * 2, 10_000);
      }
    }
  }

  private async onOffer(offer: string): Promise<void> {
    this.set({ phase: "connecting" });
    try {
      const { client, answerCode } = await this.acceptOffer(offer, {
        ...(this.name ? { name: this.name } : {}),
        usePublicStun: this.usePublicStun,
      });
      if (this.disposed) {
        client.dispose();
        return;
      }
      this.client = client;
      this.snap = this.build();
      client.onStatus((st) => {
        if (st !== "connecting" && this.phase === "connecting")
          this.set({ phase: "connected" });
        else if (st === "disconnected" && this.phase === "connected")
          this.set({ phase: "closed" });
      });
      if (client.status !== "connecting") this.set({ phase: "connected" });
      await this.api.guestAnswer(
        this.code,
        this.guestId as string,
        this.token as string,
        answerCode,
      );
      this.storage?.removeItem(this.key());
      if (this.role !== "remote")
        this.chat.connect(this.code, {
          kind: "guest",
          guestId: this.guestId as string,
          token: this.token as string,
        });
    } catch (e) {
      this.set({
        phase: "error",
        error: e instanceof RoomApiError ? e.code : "connect-failed",
      });
    }
  }

  /** Tell the relay we are gone (works from `pagehide` thanks to keepalive). */
  leave(): void {
    if (
      !this.guestId ||
      !this.token ||
      this.phase === "connected" ||
      this.phase === "connecting" ||
      this.phase === "chatting"
    )
      return;
    const id = this.guestId;
    const token = this.token;
    this.storage?.removeItem(this.key());
    void this.api.guestLeave(this.code, id, token).catch(() => undefined);
  }

  dispose(): void {
    this.disposed = true;
    this.runId++;
    this.abort?.abort();
    this.chat.dispose();
    this.client?.dispose();
    this.listeners.clear();
  }
}
