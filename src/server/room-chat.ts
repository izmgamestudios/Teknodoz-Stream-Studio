// src/server/room-chat.ts
// Moderated chat of one room. HTTP-free state machine used by the relay (rooms.ts).
//
// Roles: participants (approved guests/viewers) post -> message is `pending` until an editor or
// the director ("reji") approves it -> participants then see it -> only the director puts a
// message "on air" (the studio draws it on the program output). Nothing is persisted.

export type ChatMode = "moderated" | "open" | "off";
export type ChatStatus = "pending" | "approved" | "rejected";
export type ChatAuthorRole = "guest" | "viewer" | "reji" | "editor";
export type ChatAction = "approve" | "reject" | "edit" | "onair" | "offair";
/** Who is acting: the director (host token) or an editor (rotatable key). */
export type Moderator = "host" | "editor";

export interface ChatMessage {
  id: number;
  /** revision of the last change; clients poll with `since=<rev>` */
  rev: number;
  at: number;
  authorId: string;
  author: string;
  role: ChatAuthorRole;
  text: string;
  status: ChatStatus;
  edited: boolean;
}

interface Entry extends ChatMessage {
  /** was shown to participants at some point (so a later hide must be propagated) */
  wasVisible: boolean;
}

export const CHAT_LIMITS = {
  maxChars: 280,
  keep: 400,
  maxPending: 100,
  maxPendingPerAuthor: 5,
  minGapMs: 1_500,
  perMinute: 15,
} as const;

export class ChatError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

/** Drop control / zero-width characters, collapse whitespace, cap the length. */
export function cleanLine(raw: string, max: number): string {
  let out = "";
  for (const ch of raw) {
    const c = ch.codePointAt(0) ?? 0;
    const bad =
      c <= 0x1f ||
      c === 0x7f ||
      (c >= 0x200b && c <= 0x200f) ||
      c === 0x2028 ||
      c === 0x2029 ||
      c === 0xfeff;
    out += bad ? " " : ch;
  }
  return out.replace(/\s+/g, " ").trim().slice(0, max);
}

export type ChatViewer =
  { kind: "moderator" } | { kind: "participant"; id: string };

export class RoomChat {
  mode: ChatMode = "moderated";
  /** starts at 1 so a first poll (`since=0`) always answers immediately with the meta */
  rev = 1;
  onAir: number | null = null;
  readonly waiters = new Set<() => void>();

  private msgs: Entry[] = [];
  private nextId = 1;
  private times = new Map<string, number[]>();

  constructor(private readonly now: () => number) {}

  private notify(): void {
    for (const w of [...this.waiters]) w();
  }

  private touch(m: Entry): void {
    m.rev = ++this.rev;
    this.notify();
  }

  /** Meta changed (mode / on-air): bump the revision so pollers wake up. */
  private bump(): void {
    this.rev++;
    this.notify();
  }

  pendingCount(): number {
    let n = 0;
    for (const m of this.msgs) if (m.status === "pending") n++;
    return n;
  }

  setMode(mode: ChatMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.bump();
  }

  /** Post a message. Participants may be refused; moderators always post pre-approved. */
  post(
    author: { id: string; name: string; role: ChatAuthorRole },
    rawText: string,
  ): ChatMessage {
    const moderator = author.role === "reji" || author.role === "editor";
    const text = cleanLine(rawText, CHAT_LIMITS.maxChars);
    if (!text) throw new ChatError(400, "bad-request");
    const t = this.now();
    if (!moderator) {
      if (this.mode === "off") throw new ChatError(403, "chat-closed");
      if (this.pendingCount() >= CHAT_LIMITS.maxPending)
        throw new ChatError(429, "queue-full");
      if (
        this.msgs.filter(
          (m) => m.authorId === author.id && m.status === "pending",
        ).length >= CHAT_LIMITS.maxPendingPerAuthor
      )
        throw new ChatError(429, "rate-limited");
      this.throttle(author.id, t);
    }
    const approved = moderator || this.mode === "open";
    const m: Entry = {
      id: this.nextId++,
      rev: 0,
      at: t,
      authorId: author.id,
      author: author.name,
      role: author.role,
      text,
      status: approved ? "approved" : "pending",
      edited: false,
      wasVisible: approved,
    };
    this.msgs.push(m);
    this.trim();
    this.touch(m);
    return this.publicView(m);
  }

  private throttle(id: string, t: number): void {
    const list = (this.times.get(id) ?? []).filter((x) => t - x < 60_000);
    const last = list[list.length - 1];
    if (
      list.length >= CHAT_LIMITS.perMinute ||
      (last !== undefined && t - last < CHAT_LIMITS.minGapMs)
    ) {
      this.times.set(id, list);
      throw new ChatError(429, "rate-limited");
    }
    list.push(t);
    this.times.set(id, list);
    if (this.times.size > 500) {
      for (const [k, v] of this.times)
        if (v.every((x) => t - x >= 60_000)) this.times.delete(k);
    }
  }

  private trim(): void {
    while (this.msgs.length > CHAT_LIMITS.keep) {
      const i = this.msgs.findIndex((m) => m.status !== "pending");
      const [gone] = this.msgs.splice(i < 0 ? 0 : i, 1);
      if (gone && gone.id === this.onAir) {
        this.onAir = null;
        this.bump();
      }
    }
  }

  moderate(
    id: number,
    action: ChatAction,
    by: Moderator,
    text?: string,
  ): ChatMessage {
    const m = this.msgs.find((x) => x.id === id);
    if (!m) throw new ChatError(404, "not-found");
    switch (action) {
      case "approve":
        if (m.status === "approved") return this.publicView(m);
        m.status = "approved";
        m.wasVisible = true;
        this.touch(m);
        break;
      case "reject":
        if (m.status === "rejected") return this.publicView(m);
        m.status = "rejected";
        if (this.onAir === m.id) this.onAir = null;
        this.touch(m);
        break;
      case "edit": {
        const next = cleanLine(text ?? "", CHAT_LIMITS.maxChars);
        if (!next) throw new ChatError(400, "bad-request");
        if (next !== m.text) {
          m.text = next;
          m.edited = true;
          this.touch(m);
        }
        break;
      }
      case "onair":
        if (by !== "host") throw new ChatError(403, "forbidden");
        if (m.status !== "approved") throw new ChatError(409, "bad-state");
        if (this.onAir !== m.id) {
          this.onAir = m.id;
          this.bump();
        }
        break;
      case "offair":
        if (by !== "host") throw new ChatError(403, "forbidden");
        if (this.onAir !== null) {
          this.onAir = null;
          this.bump();
        }
        break;
    }
    return this.publicView(m);
  }

  private publicView(m: Entry): ChatMessage {
    const { wasVisible: _w, ...rest } = m;
    return rest;
  }

  /** Messages changed after `since`, as the given viewer is allowed to see them. */
  view(since: number, viewer: ChatViewer): ChatMessage[] {
    const out: ChatMessage[] = [];
    for (const m of this.msgs) {
      if (m.rev <= since) continue;
      if (viewer.kind === "moderator") {
        out.push(this.publicView(m));
        continue;
      }
      const own = m.authorId === viewer.id;
      if (m.status === "approved" || own) out.push(this.publicView(m));
      else if (m.status === "rejected" && m.wasVisible)
        // hidden after being shown: tell clients to drop it, without the text
        out.push({ ...this.publicView(m), text: "" });
    }
    return out;
  }

  /** Drop everything (room closed). */
  clear(): void {
    this.msgs = [];
    this.times.clear();
    this.onAir = null;
    this.bump();
  }
}
