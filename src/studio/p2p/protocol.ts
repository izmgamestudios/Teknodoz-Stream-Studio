// src/studio/p2p/protocol.ts
// zod schemas for the "ctl" DataChannel protocol. They mirror HostToPeer / PeerToHost /
// RemoteState / RemoteCommand from ../types exactly. Everything arriving over the wire is
// untrusted: parse functions never throw, they return null for anything that is not one
// well-formed, size-bounded message.
//
// Hardening:
//  - raw payload must be a string of at most MAX_MESSAGE_BYTES UTF-8 bytes
//  - every object schema is `.strict()` (unknown keys, including `__proto__`, are rejected, so
//    nothing attacker-controlled is ever spread/merged into application state)
//  - every string/array has an explicit upper bound
import { z } from "zod";
import { P2PError } from "./errors";
import type {
  HostToPeer,
  PeerToHost,
  RemoteCommand,
  RemoteState,
} from "../types";

/** Hard upper bound for one ctl message (UTF-8 bytes). */
export const MAX_MESSAGE_BYTES = 64 * 1024;
/** Max SDP length accepted in an in-band `sdp` message. */
export const MAX_SDP_CHARS = 32 * 1024;
/** Max length of a display name on the wire (it is sanitized again before display). */
export const MAX_WIRE_NAME_CHARS = 80;
/** Max length of a display name after sanitizing. */
export const MAX_DISPLAY_NAME_CHARS = 40;

const MAX_ID_CHARS = 128;
const MAX_SCENES = 256;

/* ------------------------------------------------------------------ */
/* Building blocks                                                     */
/* ------------------------------------------------------------------ */

const peerRoleSchema = z.enum(["viewer", "guest", "remote"]);
const idSchema = z.string().min(1).max(MAX_ID_CHARS);
const nameSchema = z.string().max(MAX_WIRE_NAME_CHARS);

const descriptionSchema = z
  .object({
    type: z.enum(["offer", "answer"]),
    sdp: z.string().min(1).max(MAX_SDP_CHARS),
  })
  .strict();

const candidateSchema = z
  .object({
    // "" is a legal end-of-candidates marker
    candidate: z.string().max(2048),
    sdpMid: z.string().max(256).nullable().optional(),
    sdpMLineIndex: z.number().int().min(0).max(255).nullable().optional(),
  })
  .strict();

/** Podcast guest prompter: one message must fit MAX_MESSAGE_BYTES even with 3-byte characters. */
export const MAX_PROMPTER_CHARS = 20_000;

export const prompterStateSchema = z
  .object({
    text: z.string().max(MAX_PROMPTER_CHARS),
    playing: z.boolean(),
    speed: z.number().finite().min(0).max(2000),
    pos: z.number().finite().min(0).max(1),
    size: z.number().finite().min(12).max(160),
  })
  .strict();

export const remoteStateSchema = z
  .object({
    scenes: z
      .array(
        z
          .object({
            id: idSchema,
            name: z.string().max(200),
            hotkey: z.string().max(40).optional(),
          })
          .strict(),
      )
      .max(MAX_SCENES),
    activeSceneId: z.string().max(MAX_ID_CHARS),
    recording: z.boolean(),
    micMuted: z.boolean(),
    prompterPlaying: z.boolean(),
    prompterSpeed: z.number().finite(),
    recordingMs: z.number().finite().min(0),
  })
  .strict();

export const remoteCommandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("scene"), id: idSchema }).strict(),
  z
    .object({
      kind: z.literal("scene-index"),
      index: z.number().int().min(0).max(1023),
    })
    .strict(),
  z
    .object({
      kind: z.literal("prompter"),
      action: z.enum(["toggle", "speedUp", "speedDown", "rewind"]),
    })
    .strict(),
  z.object({ kind: z.literal("mute"), value: z.boolean().optional() }).strict(),
  z
    .object({
      kind: z.literal("record"),
      action: z.enum(["toggle", "start", "stop"]),
    })
    .strict(),
  z.object({ kind: z.literal("marker") }).strict(),
]);

/* ------------------------------------------------------------------ */
/* Message schemas                                                     */
/* ------------------------------------------------------------------ */

export const hostMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), peerId: idSchema }).strict(),
  z.object({ type: z.literal("guest-approved") }).strict(),
  z.object({ type: z.literal("guest-on-air") }).strict(),
  z.object({ type: z.literal("guest-off-air") }).strict(),
  z.object({ type: z.literal("guest-rejected") }).strict(),
  z
    .object({ type: z.literal("prompter"), state: prompterStateSchema })
    .strict(),
  z.object({ type: z.literal("mute"), muted: z.boolean() }).strict(),
  z
    .object({ type: z.literal("remote-state"), state: remoteStateSchema })
    .strict(),
  z.object({ type: z.literal("sdp"), description: descriptionSchema }).strict(),
  z.object({ type: z.literal("ice"), candidate: candidateSchema }).strict(),
]);

export const peerMessageSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("role"), role: peerRoleSchema, name: nameSchema })
    .strict(),
  z.object({ type: z.literal("join-request"), name: nameSchema }).strict(),
  z.object({ type: z.literal("mic"), muted: z.boolean() }).strict(),
  z
    .object({ type: z.literal("remote-cmd"), cmd: remoteCommandSchema })
    .strict(),
  z.object({ type: z.literal("sdp"), description: descriptionSchema }).strict(),
  z.object({ type: z.literal("ice"), candidate: candidateSchema }).strict(),
]);

// Compile-time contract check: every message the shared types allow must be accepted by the
// schemas' static shape (the schemas may add `| undefined` to optional keys, which JSON can
// never produce). If types.ts changes and this line stops compiling, update the schemas.
const hostContractHolds: HostToPeer extends z.input<typeof hostMessageSchema>
  ? true
  : false = true;
const peerContractHolds: PeerToHost extends z.input<typeof peerMessageSchema>
  ? true
  : false = true;
const stateContractHolds: RemoteState extends z.input<typeof remoteStateSchema>
  ? true
  : false = true;
const commandContractHolds: RemoteCommand extends z.input<
  typeof remoteCommandSchema
>
  ? true
  : false = true;
void [
  hostContractHolds,
  peerContractHolds,
  stateContractHolds,
  commandContractHolds,
];

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

/** UTF-8 byte length without allocating when the string is short enough to be safe. */
function utf8Length(text: string): number {
  // UTF-16 code units * 3 is a hard upper bound of the UTF-8 size
  if (text.length * 3 <= MAX_MESSAGE_BYTES) return text.length * 3;
  if (typeof TextEncoder !== "undefined")
    return new TextEncoder().encode(text).length;
  return Number.POSITIVE_INFINITY;
}

/** Parse one ctl frame into a JSON value; undefined for anything oversized/non-JSON. */
function parseFrame(raw: unknown): unknown {
  if (typeof raw !== "string") return undefined;
  if (raw.length === 0 || raw.length > MAX_MESSAGE_BYTES) return undefined;
  if (utf8Length(raw) > MAX_MESSAGE_BYTES) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** Validate a host -> peer ctl message. Returns null for anything invalid. */
export function parseHostMessage(raw: unknown): HostToPeer | null {
  const value = parseFrame(raw);
  if (value === undefined) return null;
  const result = hostMessageSchema.safeParse(value);
  // JSON never yields `undefined` values, so the schema output equals the declared type.
  return result.success ? (result.data as HostToPeer) : null;
}

/** Validate a peer -> host ctl message. Returns null for anything invalid. */
export function parsePeerMessage(raw: unknown): PeerToHost | null {
  const value = parseFrame(raw);
  if (value === undefined) return null;
  const result = peerMessageSchema.safeParse(value);
  return result.success ? (result.data as PeerToHost) : null;
}

/** Validate an already-parsed RemoteCommand value. */
export function parseRemoteCommand(value: unknown): RemoteCommand | null {
  const result = remoteCommandSchema.safeParse(value);
  return result.success ? (result.data as RemoteCommand) : null;
}

/** Validate an already-parsed RemoteState value. */
export function parseRemoteState(value: unknown): RemoteState | null {
  const result = remoteStateSchema.safeParse(value);
  return result.success ? (result.data as RemoteState) : null;
}

/**
 * Serialize an outgoing ctl message. Throws `P2PError("too-large")` if it would exceed
 * MAX_MESSAGE_BYTES (the receiver would drop it anyway).
 */
export function encodeMessage(message: HostToPeer | PeerToHost): string {
  const text = JSON.stringify(message);
  if (utf8Length(text) > MAX_MESSAGE_BYTES) throw new P2PError("too-large");
  return text;
}

/* ------------------------------------------------------------------ */
/* Display names                                                       */
/* ------------------------------------------------------------------ */

/**
 * UTF-16 code units that must never appear in a display name: C0/C1 controls, zero-width and
 * bidi override/isolate characters, line/paragraph separators and the BOM. (All are in the BMP;
 * surrogate halves of astral characters such as emoji are untouched.)
 */
function isUnsafeNameUnit(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x206f) ||
    code === 0xfeff
  );
}

/**
 * Make a peer-supplied name safe to show: strips control/bidi characters, collapses
 * whitespace, trims and clamps to MAX_DISPLAY_NAME_CHARS code points. React escapes text, but
 * this keeps spoofing characters and absurd lengths out of the UI and the recording.
 */
export function sanitizeName(raw: unknown, fallback = ""): string {
  if (typeof raw !== "string") return fallback;
  const bounded = raw.slice(0, MAX_WIRE_NAME_CHARS * 2);
  let masked = "";
  for (let i = 0; i < bounded.length; i++) {
    masked += isUnsafeNameUnit(bounded.charCodeAt(i)) ? " " : bounded.charAt(i);
  }
  const cleaned = masked.replace(/\s+/g, " ").trim();
  const clamped = Array.from(cleaned)
    .slice(0, MAX_DISPLAY_NAME_CHARS)
    .join("")
    .trim();
  return clamped.length > 0 ? clamped : fallback;
}
