// src/studio/p2p/signaling.ts
// Manual, serverless signaling codec.
//
//   code = PREFIX + base64url( body + crc32(body) )
//   body = deflate-raw( utf8( JSON {v:1, type?, role?, sdp} ) )     prefix "TKZ1."
//        | utf8( JSON ... )                                         prefix "TKZ1u." (fallback)
//
// - The prefix makes version and "this is not one of our codes" detectable.
// - The trailing CRC-32 (big endian, over `body`) catches truncated / mangled pastes before we
//   ever hand bytes to the inflater or the browser's SDP parser.
// - Decompression is capped (anti zip-bomb), the code length is capped, and the decoded JSON
//   goes through a strict zod schema.
//
// SDP size: we deliberately do NOT edit the SDP text. Stripping a=extmap (transport-wide-cc,
// mid) or rtcp-fb lines would silently degrade bandwidth estimation / loss recovery / demux and
// cannot be verified without real browsers. The host shrinks its OFFER the spec-sanctioned way
// instead (RTCRtpTransceiver.setCodecPreferences, see host.ts) and the answer is naturally the
// intersection. max-bundle (rtc.ts) keeps candidates to one transport. Typical result: ~0.7-1.4 KB
// of base64url per code.
//
// The invite travels in the URL FRAGMENT (`#c=...`), which browsers never send to a server.
import { z } from "zod";
import { P2PError, type SignalErrorCode } from "./errors";
import { DEFAULT_ICE_TIMEOUT_MS } from "./rtc";
import { MAX_SDP_CHARS } from "./protocol";
import type { PeerRole } from "../types";

export const CODE_PREFIX = "TKZ1.";
export const CODE_PREFIX_PLAIN = "TKZ1u.";
export const SIGNAL_VERSION = 1;
/** Maximum accepted code length in characters (generous: real codes are 1-3 KB). */
export const MAX_CODE_LENGTH = 16 * 1024;

const MAX_SDP_LINES = 2000;
const MAX_MEDIA_SECTIONS = 8;
/** Characters a code (prefix included) may contain: base64url + "." */
const CODE_CHARSET = /^[A-Za-z0-9._-]+$/;

export class SignalError extends P2PError<SignalErrorCode> {
  constructor(
    code: SignalErrorCode,
    message?: string,
    options?: { cause?: unknown },
  ) {
    super(code, message, options);
    this.name = "SignalError";
  }
}

export function isSignalError(value: unknown): value is SignalError {
  return value instanceof SignalError;
}

/** Decoded content of an invite (offer) or reply (answer) code. */
export interface SignalPayload {
  v: 1;
  /** Lets us reject an offer pasted where an answer is expected (and vice versa). */
  type?: "offer" | "answer";
  role?: PeerRole;
  sdp: string;
}

export interface EncodeSignalOptions {
  /** Force plain (uncompressed) output, mainly for tests. Default: compress when supported. */
  compress?: boolean;
}

const payloadSchema = z
  .object({
    v: z.literal(SIGNAL_VERSION),
    type: z.enum(["offer", "answer"]).optional(),
    role: z.enum(["viewer", "guest", "remote"]).optional(),
    sdp: z.string().min(3).max(MAX_SDP_CHARS),
  })
  .strict();

/* ------------------------------------------------------------------ */
/* Bytes: crc32, base64url                                             */
/* ------------------------------------------------------------------ */

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    crcTable = table;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crcTable[(crc ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x2000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1)
    throw new SignalError("corrupt");
  const padded =
    text.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (text.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch (cause) {
    throw new SignalError("corrupt", undefined, { cause });
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/* ------------------------------------------------------------------ */
/* Compression                                                         */
/* ------------------------------------------------------------------ */

let compressionSupported: boolean | null = null;

/** True when CompressionStream/DecompressionStream support "deflate-raw" in this runtime. */
export function isCompressionSupported(): boolean {
  if (compressionSupported !== null) return compressionSupported;
  try {
    if (
      typeof CompressionStream === "undefined" ||
      typeof DecompressionStream === "undefined"
    ) {
      compressionSupported = false;
    } else {
      new CompressionStream("deflate-raw");
      new DecompressionStream("deflate-raw");
      compressionSupported = true;
    }
  } catch {
    compressionSupported = false;
  }
  return compressionSupported;
}

interface ByteTransform {
  readonly writable: WritableStream<BufferSource>;
  readonly readable: ReadableStream<Uint8Array>;
}

/** Push `input` through a (de)compression stream, never producing more than `maxOut` bytes. */
async function runTransform(
  transform: ByteTransform,
  input: Uint8Array<ArrayBuffer>,
  maxOut: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const writer = transform.writable.getWriter();
  const reader = transform.readable.getReader();
  const writing = writer.write(input).then(() => writer.close());
  // Failures surface through the reader (or the explicit await below); avoid unhandled rejections.
  writing.catch(() => undefined);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxOut) throw new SignalError("too-large");
      chunks.push(value);
    }
    await writing;
  } catch (error) {
    writer.abort(error).catch(() => undefined);
    reader.cancel(error).catch(() => undefined);
    throw error;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* encode / decode                                                     */
/* ------------------------------------------------------------------ */

function assertSdpShape(sdp: string): void {
  if (sdp.length > MAX_SDP_CHARS) throw new SignalError("too-large");
  if (!sdp.startsWith("v=0")) throw new SignalError("corrupt");
  let lines = 0;
  let media = 0;
  for (const line of sdp.split("\n")) {
    lines++;
    if (lines > MAX_SDP_LINES) throw new SignalError("too-large");
    if (line.startsWith("m=")) media++;
  }
  if (media > MAX_MEDIA_SECTIONS) throw new SignalError("too-large");
}

/**
 * Pack an offer/answer into a copy-paste-able code. Compresses with deflate-raw when the
 * runtime supports it, otherwise emits the plain "TKZ1u." form (longer but equally valid).
 * @throws SignalError "too-large" (SDP or resulting code over the limits) | "corrupt" (not SDP)
 */
export async function encodeSignal(
  payload: Omit<SignalPayload, "v"> & { v?: 1 },
  options: EncodeSignalOptions = {},
): Promise<string> {
  assertSdpShape(payload.sdp);
  const json = JSON.stringify({
    v: SIGNAL_VERSION,
    ...(payload.type !== undefined ? { type: payload.type } : {}),
    ...(payload.role !== undefined ? { role: payload.role } : {}),
    sdp: payload.sdp,
  });
  const raw = new TextEncoder().encode(json);
  const useCompression = options.compress !== false && isCompressionSupported();
  let body: Uint8Array<ArrayBuffer> = raw;
  if (useCompression) {
    body = await runTransform(
      new CompressionStream("deflate-raw"),
      raw,
      MAX_CODE_LENGTH * 4,
    );
  }
  const framed = new Uint8Array(body.length + 4);
  framed.set(body, 0);
  new DataView(framed.buffer).setUint32(body.length, crc32(body), false);
  const code =
    (useCompression ? CODE_PREFIX : CODE_PREFIX_PLAIN) + toBase64Url(framed);
  if (code.length > MAX_CODE_LENGTH) throw new SignalError("too-large");
  return code;
}

/**
 * Pull the raw code out of whatever the user pasted: the bare code (whitespace/newlines from
 * chat apps are removed), surrounding quotes, or a full /join or /remote link with `#c=...`.
 */
export function extractCode(input: string): string {
  if (typeof input !== "string") throw new SignalError("corrupt");
  // generous slack for whitespace added by chat apps / terminals
  if (input.length > MAX_CODE_LENGTH * 2) throw new SignalError("too-large");
  let candidate = input.trim();
  const hash = candidate.indexOf("#");
  if (hash >= 0) {
    const fromFragment = parseFragment(candidate.slice(hash));
    if (fromFragment !== null) candidate = fromFragment;
  }
  return candidate.replace(/^["'`<(]+|[)"'`>]+$/g, "").replace(/\s+/g, "");
}

/**
 * Validate and unpack a code produced by `encodeSignal`.
 * @throws SignalError "bad-prefix" | "version" | "too-large" | "corrupt";
 *         P2PError "unsupported" when a compressed code is read on a runtime without
 *         DecompressionStream("deflate-raw").
 */
export async function decodeSignal(input: string): Promise<SignalPayload> {
  const code = extractCode(input);
  if (code.length > MAX_CODE_LENGTH) throw new SignalError("too-large");

  let compressed: boolean;
  let encoded: string;
  if (code.startsWith(CODE_PREFIX)) {
    compressed = true;
    encoded = code.slice(CODE_PREFIX.length);
  } else if (code.startsWith(CODE_PREFIX_PLAIN)) {
    compressed = false;
    encoded = code.slice(CODE_PREFIX_PLAIN.length);
  } else {
    // "TKZ2." / "TKZ12u." etc: a code from a different protocol version
    if (/^TKZ(?!1[.u])\d+[a-z]?\./.test(code)) throw new SignalError("version");
    throw new SignalError("bad-prefix");
  }

  const framed = fromBase64Url(encoded);
  if (framed.length < 5) throw new SignalError("corrupt");
  const body = framed.subarray(0, framed.length - 4);
  const expected = new DataView(
    framed.buffer,
    framed.byteOffset,
    framed.byteLength,
  ).getUint32(framed.length - 4, false);
  if (crc32(body) !== expected) throw new SignalError("corrupt");

  let jsonBytes: Uint8Array<ArrayBuffer> = body;
  if (compressed) {
    if (!isCompressionSupported()) throw new P2PError("unsupported");
    try {
      jsonBytes = await runTransform(
        new DecompressionStream("deflate-raw"),
        body,
        MAX_SDP_CHARS * 4,
      );
    } catch (error) {
      if (error instanceof SignalError) throw error;
      throw new SignalError("corrupt", undefined, { cause: error });
    }
  } else if (jsonBytes.length > MAX_SDP_CHARS * 4) {
    throw new SignalError("too-large");
  }

  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(jsonBytes),
    ) as unknown;
  } catch (cause) {
    throw new SignalError("corrupt", undefined, { cause });
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const version = record["v"];
    if (typeof version === "number" && version !== SIGNAL_VERSION)
      throw new SignalError("version");
    const sdp = record["sdp"];
    if (typeof sdp === "string" && sdp.length > MAX_SDP_CHARS)
      throw new SignalError("too-large");
  }
  const parsed = payloadSchema.safeParse(value);
  if (!parsed.success)
    throw new SignalError("corrupt", undefined, { cause: parsed.error });
  assertSdpShape(parsed.data.sdp);
  // exactOptionalPropertyTypes: rebuild so absent keys stay absent
  return {
    v: SIGNAL_VERSION,
    ...(parsed.data.type !== undefined ? { type: parsed.data.type } : {}),
    ...(parsed.data.role !== undefined ? { role: parsed.data.role } : {}),
    sdp: parsed.data.sdp,
  };
}

/* ------------------------------------------------------------------ */
/* ICE gathering                                                       */
/* ------------------------------------------------------------------ */

/** The slice of RTCPeerConnection `waitForIceGathering` needs (real and fake PCs fit). */
export interface IceGatheringTarget {
  readonly iceGatheringState: RTCIceGatheringState;
  addEventListener(type: "icegatheringstatechange", listener: () => void): void;
  removeEventListener(
    type: "icegatheringstatechange",
    listener: () => void,
  ): void;
}

/**
 * Resolve when ICE gathering completes (true) or after `timeoutMs` (false; the partial
 * candidate set already present in `localDescription` is still usable). We never trickle, so
 * the code we hand out must contain every candidate gathered so far. Aborting `signal`
 * resolves false immediately (used when the owner is disposed mid-gathering).
 */
export function waitForIceGathering(
  pc: IceGatheringTarget,
  timeoutMs: number = DEFAULT_ICE_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<boolean> {
  if (pc.iceGatheringState === "complete") return Promise.resolve(true);
  if (signal?.aborted) return Promise.resolve(false);
  const budget = Number.isFinite(timeoutMs)
    ? Math.max(0, timeoutMs)
    : DEFAULT_ICE_TIMEOUT_MS;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (complete: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", onChange);
      signal?.removeEventListener("abort", onAbort);
      resolve(complete);
    };
    const onChange = (): void => {
      if (pc.iceGatheringState === "complete") finish(true);
    };
    const onAbort = (): void => finish(false);
    pc.addEventListener("icegatheringstatechange", onChange);
    signal?.addEventListener("abort", onAbort, { once: true });
    // `finish` only runs after this line (events/abort/timeout are all asynchronous)
    const timer = setTimeout(() => finish(false), budget);
  });
}

/* ------------------------------------------------------------------ */
/* URL helpers (invite lives in the fragment, never sent to a server)  */
/* ------------------------------------------------------------------ */

function buildUrl(
  path: "join" | "remote",
  origin: string,
  code: string,
): string {
  if (!CODE_CHARSET.test(code) || code.length > MAX_CODE_LENGTH)
    throw new SignalError("corrupt");
  const base = origin.trim().replace(/\/+$/, "");
  return `${base}/${path}#c=${code}`;
}

/** `${origin}/join#c=<code>` (viewer / guest invite). */
export function buildJoinUrl(origin: string, code: string): string {
  return buildUrl("join", origin, code);
}

/** `${origin}/remote#c=<code>` (phone remote control invite). */
export function buildRemoteUrl(origin: string, code: string): string {
  return buildUrl("remote", origin, code);
}

/**
 * Read the invite code from `location.hash` (`"#c=TKZ1.xxxx"`; the leading "#" is optional and
 * other `&`-separated params are ignored). Returns null when absent or not URL-safe/too long.
 * The code is NOT validated further here - hand it to `decodeSignal`.
 */
export function parseFragment(hash: string): string | null {
  if (
    typeof hash !== "string" ||
    hash.length === 0 ||
    hash.length > MAX_CODE_LENGTH + 16
  ) {
    return null;
  }
  const params = new URLSearchParams(
    hash.startsWith("#") ? hash.slice(1) : hash,
  );
  const code = params.get("c");
  if (code === null || code.length === 0 || code.length > MAX_CODE_LENGTH)
    return null;
  return CODE_CHARSET.test(code) ? code : null;
}
