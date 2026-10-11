// src/studio/room/chat-client.ts
// Long-polling client of the moderated room chat. One class serves three seats:
//   - director (host token)  : sees everything, approves, puts messages on air
//   - editor (editor key)    : sees everything, approves / rejects / edits
//   - participant (guest)    : sees approved messages + its own, posts into the queue
// It exposes a tiny external store (`subscribe` / `getSnapshot`) for React.
import {
  RoomApiError,
  createRoomApi,
  type ChatAction,
  type ChatMessage,
  type ChatMode,
  type RoomApi,
} from "./api";

export type ChatAuth =
  | { kind: "bearer"; token: string }
  | { kind: "guest"; guestId: string; token: string };

export type ChatStatus =
  | "idle"
  | "live"
  | "offline"
  | "closed"
  /** key revoked / not allowed to chat */
  | "denied";

export interface ChatSnapshot {
  readonly status: ChatStatus;
  /** oldest first; hidden/rejected messages of other authors are already dropped for participants */
  readonly messages: readonly ChatMessage[];
  readonly mode: ChatMode;
  readonly onAir: ChatMessage | null;
  /** messages waiting for moderation (moderators only) */
  readonly pending: number;
  /** chat-only participants currently present (moderators only) */
  readonly audience: number;
  readonly as: "host" | "editor" | "participant" | null;
}

const EMPTY: ChatSnapshot = Object.freeze({
  status: "idle",
  messages: Object.freeze([]) as readonly ChatMessage[],
  mode: "moderated",
  onAir: null,
  pending: 0,
  audience: 0,
  as: null,
});

export const EMPTY_CHAT: ChatSnapshot = EMPTY;
const KEEP = 500;

export interface ChatClientOptions {
  api?: RoomApi;
  waitSec?: number;
  /** backoff after a failed poll, ms */
  retryMs?: number;
}

export class RoomChatClient {
  private readonly api: RoomApi;
  private readonly waitSec: number;
  private readonly retryMs: number;

  private code: string | null = null;
  private auth: ChatAuth | null = null;
  private status: ChatStatus = "idle";
  private msgs = new Map<number, ChatMessage>();
  private mode: ChatMode = "moderated";
  private onAirId: number | null = null;
  private pending = 0;
  private audience = 0;
  private as: ChatSnapshot["as"] = null;
  private since = 0;
  private runId = 0;
  private abort: AbortController | null = null;
  private snap: ChatSnapshot = EMPTY;
  private listeners = new Set<() => void>();

  constructor(opts: ChatClientOptions = {}) {
    this.api = opts.api ?? createRoomApi();
    this.waitSec = opts.waitSec ?? 20;
    this.retryMs = opts.retryMs ?? 2_000;
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getSnapshot = (): ChatSnapshot => this.snap;

  private emit(): void {
    const messages = [...this.msgs.values()].sort((a, b) => a.id - b.id);
    this.snap = {
      status: this.status,
      messages,
      mode: this.mode,
      onAir:
        this.onAirId === null ? null : (this.msgs.get(this.onAirId) ?? null),
      pending: this.pending,
      audience: this.audience,
      as: this.as,
    };
    for (const l of [...this.listeners]) l();
  }

  /** Guest id of the participant seat (to recognise own messages), else null. */
  get selfId(): string | null {
    return this.auth?.kind === "guest" ? this.auth.guestId : null;
  }

  /** Start polling `code` with the given seat. Restarts when called again. */
  connect(code: string, auth: ChatAuth): void {
    this.disconnect();
    this.code = code.toUpperCase();
    this.auth = auth;
    this.status = "live";
    this.as = auth.kind === "guest" ? "participant" : null;
    this.since = 0;
    this.msgs.clear();
    this.onAirId = null;
    this.pending = 0;
    this.audience = 0;
    this.emit();
    void this.loop(++this.runId);
  }

  disconnect(): void {
    this.runId++;
    this.abort?.abort();
    this.abort = null;
    if (this.status !== "idle") {
      this.status = "idle";
      this.code = null;
      this.auth = null;
      this.msgs.clear();
      this.onAirId = null;
      this.pending = 0;
      this.audience = 0;
      this.as = null;
      this.emit();
    }
  }

  dispose(): void {
    this.disconnect();
    this.listeners.clear();
  }

  private apply(messages: readonly ChatMessage[]): void {
    const mine = this.auth?.kind === "guest" ? this.auth.guestId : null;
    for (const m of messages) {
      const hidden =
        m.status === "rejected" && mine !== null && m.authorId !== mine;
      if (hidden) this.msgs.delete(m.id);
      else this.msgs.set(m.id, m);
    }
    if (this.msgs.size > KEEP) {
      const ids = [...this.msgs.keys()].sort((a, b) => a - b);
      for (const id of ids.slice(0, this.msgs.size - KEEP))
        this.msgs.delete(id);
    }
  }

  private async loop(run: number): Promise<void> {
    const a = this.auth;
    const code = this.code;
    if (!a || !code) return;
    let failures = 0;
    while (run === this.runId) {
      const ctl = new AbortController();
      this.abort = ctl;
      try {
        const r =
          a.kind === "bearer"
            ? await this.api.chatPoll(
                code,
                a.token,
                this.since,
                this.waitSec,
                ctl.signal,
              )
            : await this.api.guestChatPoll(
                code,
                a.guestId,
                a.token,
                this.since,
                this.waitSec,
                ctl.signal,
              );
        if (run !== this.runId) return;
        failures = 0;
        this.since = r.rev;
        this.apply(r.messages);
        this.mode = r.mode;
        this.onAirId = r.onAir;
        this.pending = r.pending ?? 0;
        this.audience = r.audience ?? 0;
        if (r.as) this.as = r.as;
        this.status = r.closed ? "closed" : "live";
        this.emit();
        if (r.closed) return;
      } catch (e) {
        if (run !== this.runId) return;
        if ((e as { name?: string } | null)?.name === "AbortError") return;
        if (e instanceof RoomApiError) {
          if (e.code === "forbidden" || e.code === "not-found") {
            this.status = "denied";
            this.emit();
            return;
          }
          if (e.code === "closed") {
            this.status = "closed";
            this.emit();
            return;
          }
        }
        failures++;
        if (this.status !== "offline") {
          this.status = "offline";
          this.emit();
        }
        await sleep(Math.min(10_000, this.retryMs * failures), ctl.signal);
      }
    }
  }

  /* ------------------------------ actions ------------------------------ */

  private seat(): { code: string; auth: ChatAuth } {
    if (!this.code || !this.auth) throw new RoomApiError("unavailable");
    return { code: this.code, auth: this.auth };
  }

  /** Post a message (participants: lands in the queue; moderators: published at once). */
  async post(text: string): Promise<ChatMessage> {
    const { code, auth } = this.seat();
    const r =
      auth.kind === "bearer"
        ? await this.api.chatPost(code, auth.token, text)
        : await this.api.guestChatPost(code, auth.guestId, auth.token, text);
    this.apply([r.message]);
    this.emit();
    return r.message;
  }

  async moderate(
    id: number,
    action: ChatAction,
    text?: string,
  ): Promise<ChatMessage> {
    const { code, auth } = this.seat();
    if (auth.kind !== "bearer") throw new RoomApiError("forbidden", 403);
    const r = await this.api.chatAction(code, auth.token, id, action, text);
    this.apply([r.message]);
    this.onAirId = r.onAir;
    this.emit();
    return r.message;
  }

  /** Director only. */
  async setMode(mode: ChatMode): Promise<void> {
    const { code, auth } = this.seat();
    if (auth.kind !== "bearer") throw new RoomApiError("forbidden", 403);
    const r = await this.api.setChatMode(code, auth.token, mode);
    this.mode = r.mode;
    this.emit();
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}
