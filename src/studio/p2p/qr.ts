// src/studio/p2p/qr.ts
// Dependency-free QR Code (ISO/IEC 18004) encoder: versions 1-40, ECC levels L/M/Q/H,
// numeric / alphanumeric / byte (UTF-8) modes with automatic selection, Reed-Solomon over
// GF(256), standard block interleaving, function patterns, all 8 masks scored with the
// 4-rule penalty, BCH-protected format and version information.
//
// Pure and SSR-safe: no DOM, no TextEncoder, no top-level side effects beyond table building.
// The quiet zone is NOT part of the matrix; renderers add it (see qr-render.ts).
import {
  ALPHANUMERIC_CHARSET,
  ECC_FORMAT_BITS,
  GF_EXP,
  GF_LOG,
  MODE_INDICATOR,
  QR_MAX_VERSION,
  QR_MIN_VERSION,
  alignmentPatternPositions,
  charCountBits,
  eccCodewordsPerBlock,
  isQrEcc,
  isQrVersion,
  numDataCodewords,
  numErrorCorrectionBlocks,
  numRawCodewords,
  symbolSize,
  type QrEcc,
  type QrMode,
} from "./qr-tables";

export { QR_ECC_LEVELS, QR_MAX_VERSION, QR_MIN_VERSION } from "./qr-tables";
export type { QrEcc, QrMode } from "./qr-tables";

// --- errors ---------------------------------------------------------------------------------

export type QrErrorCode =
  /** The payload does not fit into the allowed versions / ECC level. */
  | "too-long"
  /** An option (ecc, version range, colour, scale, margin...) is invalid. */
  | "bad-options"
  /** The runtime lacks a needed API (e.g. no 2D canvas context). */
  | "unsupported";

const MESSAGES: Record<QrErrorCode, string> = {
  "too-long": "Veri QR koduna sığmıyor",
  "bad-options": "Geçersiz QR ayarı",
  unsupported: "Bu ortam QR çizimini desteklemiyor",
};

export class QrError extends Error {
  readonly code: QrErrorCode;

  constructor(code: QrErrorCode, message?: string) {
    super(message ?? MESSAGES[code]);
    this.name = "QrError";
    this.code = code;
  }
}

/** Thrown by `encodeQr` when the data does not fit (`code` is always "too-long"). */
export class QrCapacityError extends QrError {
  declare readonly code: "too-long";
  /** UTF-8 size of the payload in bytes (a lower bound when rejected before encoding). */
  readonly payloadBytes: number;
  /** Byte-mode capacity of the largest allowed version at the requested ECC level. */
  readonly maxBytes: number;

  constructor(payloadBytes: number, maxBytes: number) {
    super(
      "too-long",
      `${MESSAGES["too-long"]} (${payloadBytes} B > ${maxBytes} B)`,
    );
    this.name = "QrCapacityError";
    this.payloadBytes = payloadBytes;
    this.maxBytes = maxBytes;
  }
}

// --- public types ---------------------------------------------------------------------------

export interface QrMatrix {
  /** Edge length in modules (21..177), without quiet zone. */
  readonly size: number;
  readonly version: number;
  readonly ecc: QrEcc;
  /** Data mask (0..7) the encoder picked. */
  readonly mask: number;
  /** Mode the payload was encoded in. */
  readonly mode: QrMode;
  /** Module at column `x`, row `y` (0,0 = top-left); false when out of range. */
  get(x: number, y: number): boolean;
  /** Row-major `size * size` bytes, 1 = dark. Shared, read-only by contract. */
  readonly modules: Uint8Array;
}

export interface EncodeQrOptions {
  /** Error correction level; default "M". */
  ecc?: QrEcc | undefined;
  /** Smallest version to consider (1..40); default 1. */
  minVersion?: number | undefined;
  /** Largest version to consider (1..40); default 40. */
  maxVersion?: number | undefined;
  /** Force data mask 0..7 instead of picking the lowest-penalty one (tests / debugging). */
  mask?: number | undefined;
}

// --- capacity -------------------------------------------------------------------------------

function assertVersionEcc(version: number, ecc: QrEcc): void {
  if (!isQrVersion(version))
    throw new QrError("bad-options", "QR version must be 1..40");
  if (!isQrEcc(ecc))
    throw new QrError("bad-options", "QR ecc must be L, M, Q or H");
}

/**
 * Maximum number of characters of `mode` (default "byte": UTF-8 bytes) that fit into one
 * symbol of `version` at `ecc`. Respects the width of the character count field.
 */
export function qrCapacity(
  version: number,
  ecc: QrEcc,
  mode: QrMode = "byte",
): number {
  assertVersionEcc(version, ecc);
  const ccBits = charCountBits(mode, version);
  const bits = numDataCodewords(version, ecc) * 8 - 4 - ccBits;
  if (bits < 0) return 0;
  let chars: number;
  if (mode === "numeric") {
    const groups = Math.floor(bits / 10);
    const rest = bits - groups * 10;
    chars = groups * 3 + (rest >= 7 ? 2 : rest >= 4 ? 1 : 0);
  } else if (mode === "alphanumeric") {
    const groups = Math.floor(bits / 11);
    chars = groups * 2 + (bits - groups * 11 >= 6 ? 1 : 0);
  } else {
    chars = Math.floor(bits / 8);
  }
  return Math.min(chars, 2 ** ccBits - 1);
}

/** Maximum UTF-8 payload size in bytes (byte mode) of `version` at `ecc`. */
export function qrCapacityBytes(version: number, ecc: QrEcc): number {
  return qrCapacity(version, ecc, "byte");
}

/** Absolute upper bound on UTF-16 length: numeric capacity of v40-L. Longer never fits. */
const MAX_TEXT_LENGTH = 7089;

// --- UTF-8 ----------------------------------------------------------------------------------

/** UTF-8 encoder (lone surrogates become U+FFFD, like TextEncoder). Exported for tests. */
export function utf8Encode(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 3);
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    let cp = text.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff) {
      const lo = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
        i++;
      } else {
        cp = 0xfffd;
      }
    } else if (cp >= 0xdc00 && cp <= 0xdfff) {
      cp = 0xfffd;
    }
    if (cp < 0x80) {
      out[n++] = cp;
    } else if (cp < 0x800) {
      out[n++] = 0xc0 | (cp >> 6);
      out[n++] = 0x80 | (cp & 0x3f);
    } else if (cp < 0x10000) {
      out[n++] = 0xe0 | (cp >> 12);
      out[n++] = 0x80 | ((cp >> 6) & 0x3f);
      out[n++] = 0x80 | (cp & 0x3f);
    } else {
      out[n++] = 0xf0 | (cp >> 18);
      out[n++] = 0x80 | ((cp >> 12) & 0x3f);
      out[n++] = 0x80 | ((cp >> 6) & 0x3f);
      out[n++] = 0x80 | (cp & 0x3f);
    }
  }
  return out.slice(0, n);
}

// --- Reed-Solomon over GF(256) --------------------------------------------------------------

const generatorCache = new Map<number, Uint8Array>();

/** Shared (cached, never handed out) generator polynomial; see `reedSolomonGenerator`. */
function generatorFor(degree: number): Uint8Array {
  if (!Number.isInteger(degree) || degree < 1 || degree > 255) {
    throw new QrError("bad-options", "Reed-Solomon degree must be 1..255");
  }
  const cached = generatorCache.get(degree);
  if (cached) return cached;
  const result = new Uint8Array(degree);
  result[degree - 1] = 1; // start with the monic polynomial "1"
  let root = 1;
  for (let i = 0; i < degree; i++) {
    // multiply the running polynomial by (x - root)
    for (let j = 0; j < degree; j++) {
      const c = result[j]!;
      let v = c === 0 ? 0 : GF_EXP[GF_LOG[c]! + GF_LOG[root]!]!;
      if (j + 1 < degree) v ^= result[j + 1]!;
      result[j] = v;
    }
    root = GF_EXP[GF_LOG[root]! + 1]!; // root *= alpha (0x02); root is never 0
  }
  generatorCache.set(degree, result);
  return result;
}

/**
 * Coefficients of the monic generator polynomial (x - a^0)...(x - a^(degree-1)), highest power
 * first, WITHOUT the leading 1 coefficient (so `degree` entries). Returns a fresh copy.
 */
export function reedSolomonGenerator(degree: number): Uint8Array {
  return generatorFor(degree).slice();
}

/** Reed-Solomon remainder (the `degree` error correction codewords) of `data`. */
export function reedSolomonRemainder(
  data: ArrayLike<number>,
  degree: number,
): Uint8Array {
  const gen = generatorFor(degree);
  const result = new Uint8Array(degree);
  for (let i = 0; i < data.length; i++) {
    const factor = (data[i]! & 0xff) ^ result[0]!;
    result.copyWithin(0, 1);
    result[degree - 1] = 0;
    if (factor === 0) continue;
    const logFactor = GF_LOG[factor]!;
    for (let j = 0; j < degree; j++) {
      const g = gen[j]!;
      if (g !== 0) result[j] = result[j]! ^ GF_EXP[GF_LOG[g]! + logFactor]!;
    }
  }
  return result;
}

// --- segment (single mode) and data codewords -----------------------------------------------

const ALNUM_VALUE = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < ALPHANUMERIC_CHARSET.length; i++) {
    table[ALPHANUMERIC_CHARSET.charCodeAt(i)] = i;
  }
  return table;
})();

function alnumValue(code: number): number {
  return code < 128 ? ALNUM_VALUE[code]! : -1;
}

interface Segment {
  mode: QrMode;
  /** Character count written into the count field (bytes for byte mode). */
  count: number;
  /** Number of data bits, excluding mode indicator and count field. */
  dataBits: number;
  text: string;
  bytes: Uint8Array | null;
}

function makeSegment(text: string, ecc: QrEcc, maxVersion: number): Segment {
  if (text.length > MAX_TEXT_LENGTH) {
    throw new QrCapacityError(text.length, qrCapacityBytes(maxVersion, ecc));
  }
  let numeric = text.length > 0;
  let alnum = text.length > 0;
  for (let i = 0; i < text.length && (numeric || alnum); i++) {
    const c = text.charCodeAt(i);
    if (c < 48 || c > 57) numeric = false;
    if (alnum && alnumValue(c) < 0) alnum = false;
  }
  const n = text.length;
  if (numeric) {
    const rest = n % 3;
    return {
      mode: "numeric",
      count: n,
      dataBits: Math.floor(n / 3) * 10 + (rest === 0 ? 0 : rest === 1 ? 4 : 7),
      text,
      bytes: null,
    };
  }
  if (alnum) {
    return {
      mode: "alphanumeric",
      count: n,
      dataBits: Math.floor(n / 2) * 11 + (n % 2) * 6,
      text,
      bytes: null,
    };
  }
  const bytes = utf8Encode(text);
  return {
    mode: "byte",
    count: bytes.length,
    dataBits: bytes.length * 8,
    text,
    bytes,
  };
}

class BitWriter {
  readonly bytes: Uint8Array;
  pos = 0;

  constructor(byteLength: number) {
    this.bytes = new Uint8Array(byteLength);
  }

  /** Append the low `length` bits of `value`, MSB first. */
  write(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) {
      if ((value >>> i) & 1)
        this.bytes[this.pos >>> 3]! |= 0x80 >>> (this.pos & 7);
      this.pos++;
    }
  }
}

function buildDataCodewords(
  seg: Segment,
  version: number,
  ecc: QrEcc,
): Uint8Array {
  const capacityBits = numDataCodewords(version, ecc) * 8;
  const w = new BitWriter(capacityBits >>> 3);
  w.write(MODE_INDICATOR[seg.mode], 4);
  w.write(seg.count, charCountBits(seg.mode, version));
  const text = seg.text;
  if (seg.mode === "numeric") {
    for (let i = 0; i < text.length;) {
      const take = Math.min(3, text.length - i);
      w.write(Number(text.substr(i, take)), take * 3 + 1);
      i += take;
    }
  } else if (seg.mode === "alphanumeric") {
    for (let i = 0; i < text.length; i += 2) {
      const a = alnumValue(text.charCodeAt(i));
      if (i + 1 < text.length)
        w.write(a * 45 + alnumValue(text.charCodeAt(i + 1)), 11);
      else w.write(a, 6);
    }
  } else {
    const bytes = seg.bytes!;
    for (let i = 0; i < bytes.length; i++) w.write(bytes[i]!, 8);
  }
  // Terminator (up to 4 zero bits), byte alignment, then alternating pad codewords.
  w.pos += Math.min(4, capacityBits - w.pos);
  w.pos = (w.pos + 7) & ~7;
  for (let pad = 0xec; w.pos < capacityBits; pad ^= 0xec ^ 0x11)
    w.write(pad, 8);
  return w.bytes;
}

/** Smallest version in [min, max] that fits the segment, or null. */
function chooseVersion(
  seg: Segment,
  ecc: QrEcc,
  min: number,
  max: number,
): number | null {
  for (let version = min; version <= max; version++) {
    const ccBits = charCountBits(seg.mode, version);
    if (seg.count >= 2 ** ccBits) continue;
    if (4 + ccBits + seg.dataBits <= numDataCodewords(version, ecc) * 8)
      return version;
  }
  return null;
}

// --- block splitting + interleaving ---------------------------------------------------------

/** Appends Reed-Solomon codewords to each block and interleaves per ISO 18004 section 7.6. */
export function addEccAndInterleave(
  data: Uint8Array,
  version: number,
  ecc: QrEcc,
): Uint8Array {
  assertVersionEcc(version, ecc);
  if (data.length !== numDataCodewords(version, ecc)) {
    throw new QrError(
      "bad-options",
      "Data codeword count does not match version/ecc",
    );
  }
  const numBlocks = numErrorCorrectionBlocks(version, ecc);
  const eccLen = eccCodewordsPerBlock(version, ecc);
  const rawCodewords = numRawCodewords(version);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortDataLen = Math.floor(rawCodewords / numBlocks) - eccLen;

  const blocks: Uint8Array[] = [];
  const eccBlocks: Uint8Array[] = [];
  let k = 0;
  for (let b = 0; b < numBlocks; b++) {
    const len = shortDataLen + (b < numShortBlocks ? 0 : 1);
    const block = data.subarray(k, k + len);
    k += len;
    blocks.push(block);
    eccBlocks.push(reedSolomonRemainder(block, eccLen));
  }

  const result = new Uint8Array(rawCodewords);
  let out = 0;
  for (let i = 0; i <= shortDataLen; i++) {
    for (let b = 0; b < numBlocks; b++) {
      const block = blocks[b]!;
      if (i < block.length) result[out++] = block[i]!;
    }
  }
  for (let i = 0; i < eccLen; i++) {
    for (let b = 0; b < numBlocks; b++) result[out++] = eccBlocks[b]![i]!;
  }
  return result;
}

// --- format / version information -----------------------------------------------------------

/** 15-bit format information: BCH(15,5) remainder over (ecc, mask), XOR 0x5412. */
export function formatBits(ecc: QrEcc, mask: number): number {
  const data = (ECC_FORMAT_BITS[ecc] << 3) | (mask & 7);
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** 18-bit version information (versions >= 7): BCH(18,6) with generator 0x1F25. */
export function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

// --- matrix construction --------------------------------------------------------------------

interface Grid {
  size: number;
  modules: Uint8Array;
  /** 1 for function patterns / reserved areas (never data, never masked). */
  isFunction: Uint8Array;
}

function setFunction(g: Grid, x: number, y: number, dark: boolean): void {
  const i = y * g.size + x;
  g.modules[i] = dark ? 1 : 0;
  g.isFunction[i] = 1;
}

function drawFormat(g: Grid, ecc: QrEcc, mask: number): void {
  const bits = formatBits(ecc, mask);
  const bit = (i: number): boolean => ((bits >>> i) & 1) !== 0;
  const size = g.size;
  // First copy, around the top-left finder.
  for (let i = 0; i <= 5; i++) setFunction(g, 8, i, bit(i));
  setFunction(g, 8, 7, bit(6));
  setFunction(g, 8, 8, bit(7));
  setFunction(g, 7, 8, bit(8));
  for (let i = 9; i < 15; i++) setFunction(g, 14 - i, 8, bit(i));
  // Second copy, split between the other two finders.
  for (let i = 0; i < 8; i++) setFunction(g, size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) setFunction(g, 8, size - 15 + i, bit(i));
  setFunction(g, 8, size - 8, true); // the always-dark module
}

function drawVersion(g: Grid, version: number): void {
  if (version < 7) return;
  const bits = versionBits(version);
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) !== 0;
    const a = g.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    setFunction(g, a, b, dark);
    setFunction(g, b, a, dark);
  }
}

function drawFinder(g: Grid, cx: number, cy: number): void {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= g.size || y >= g.size) continue;
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      setFunction(g, x, y, dist !== 2 && dist !== 4); // ring layout incl. light separator
    }
  }
}

function drawAlignment(g: Grid, cx: number, cy: number): void {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      setFunction(
        g,
        cx + dx,
        cy + dy,
        Math.max(Math.abs(dx), Math.abs(dy)) !== 1,
      );
    }
  }
}

function drawFunctionPatterns(g: Grid, version: number, ecc: QrEcc): void {
  const size = g.size;
  for (let i = 0; i < size; i++) {
    setFunction(g, 6, i, i % 2 === 0);
    setFunction(g, i, 6, i % 2 === 0);
  }
  drawFinder(g, 3, 3);
  drawFinder(g, size - 4, 3);
  drawFinder(g, 3, size - 4);
  const pos = alignmentPatternPositions(version);
  const last = pos.length - 1;
  for (let i = 0; i <= last; i++) {
    for (let j = 0; j <= last; j++) {
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === last) ||
        (i === last && j === 0)
      )
        continue;
      drawAlignment(g, pos[i]!, pos[j]!);
    }
  }
  drawFormat(g, ecc, 0); // reserve the area; real bits are drawn once the mask is known
  drawVersion(g, version);
}

/** Zigzag placement of codeword bits into the non-function modules. */
function placeCodewords(g: Grid, codewords: Uint8Array): void {
  const size = g.size;
  const totalBits = codewords.length * 8;
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip the vertical timing column
    const upward = ((right + 1) & 2) === 0;
    for (let vert = 0; vert < size; vert++) {
      const y = upward ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const i = y * size + x;
        if (g.isFunction[i] === 0 && bitIndex < totalBits) {
          g.modules[i] =
            (codewords[bitIndex >>> 3]! >>> (7 - (bitIndex & 7))) & 1;
          bitIndex++;
        }
        // remainder bits (if any) stay light
      }
    }
  }
}

/**
 * Data mask pattern `mask` (0..7) for a `size` x `size` symbol: 1 where the mask inverts the
 * module (function patterns are NOT excluded here). Formulas are ISO 18004 table 10 with
 * i = row (y), j = column (x), evaluated through small lookup tables because this runs for
 * all 8 masks on every encode. Exported for tests.
 */
export function dataMaskPattern(mask: number, size: number): Uint8Array {
  const out = new Uint8Array(size * size);
  const mod3 = new Uint8Array(size);
  const div3Odd = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    mod3[i] = i % 3;
    div3Odd[i] = Math.floor(i / 3) & 1;
  }
  for (let y = 0; y < size; y++) {
    const row = y * size;
    const y3 = mod3[y]!;
    const yHalfOdd = (y >> 1) & 1;
    for (let x = 0; x < size; x++) {
      const x3 = mod3[x]!;
      let invert: boolean;
      switch (mask) {
        case 0: // (i + j) mod 2 = 0
          invert = ((x ^ y) & 1) === 0;
          break;
        case 1: // i mod 2 = 0
          invert = (y & 1) === 0;
          break;
        case 2: // j mod 3 = 0
          invert = x3 === 0;
          break;
        case 3: // (i + j) mod 3 = 0
          invert = (x3 + y3) % 3 === 0;
          break;
        case 4: // (floor(i / 2) + floor(j / 3)) mod 2 = 0
          invert = (div3Odd[x]! ^ yHalfOdd) === 0;
          break;
        case 5: // (i * j) mod 2 + (i * j) mod 3 = 0
          invert = (x & y & 1) === 0 && (x3 === 0 || y3 === 0);
          break;
        case 6: // ((i * j) mod 2 + (i * j) mod 3) mod 2 = 0
          invert = (((x & y & 1) + ((x3 * y3) % 3)) & 1) === 0;
          break;
        default: // 7: ((i + j) mod 2 + (i * j) mod 3) mod 2 = 0
          invert = ((((x ^ y) & 1) + ((x3 * y3) % 3)) & 1) === 0;
          break;
      }
      if (invert) out[row + x] = 1;
    }
  }
  return out;
}

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

/** True when positions [from, to) of a line are light or outside the symbol (quiet zone). */
function lightRun(
  m: Uint8Array,
  base: number,
  step: number,
  n: number,
  from: number,
  to: number,
): boolean {
  for (let i = from; i < to; i++) {
    if (i >= 0 && i < n && m[base + i * step] !== 0) return false;
  }
  return true;
}

/** Rule 1 (runs of >= 5) and rule 3 (finder-like 1:1:3:1:1 pattern) along one row/column. */
function linePenalty(
  m: Uint8Array,
  base: number,
  step: number,
  n: number,
): number {
  let result = 0;
  let runColor = m[base]!;
  let runLength = 1;
  for (let i = 1; i < n; i++) {
    const c = m[base + i * step]!;
    if (c === runColor) {
      runLength++;
    } else {
      if (runLength >= 5) result += PENALTY_N1 + runLength - 5;
      runColor = c;
      runLength = 1;
    }
  }
  if (runLength >= 5) result += PENALTY_N1 + runLength - 5;

  for (let s = 0; s + 7 <= n; s++) {
    const p = base + s * step;
    if (
      m[p] === 1 &&
      m[p + step] === 0 &&
      m[p + 2 * step] === 1 &&
      m[p + 3 * step] === 1 &&
      m[p + 4 * step] === 1 &&
      m[p + 5 * step] === 0 &&
      m[p + 6 * step] === 1
    ) {
      if (lightRun(m, base, step, n, s - 4, s)) result += PENALTY_N3;
      if (lightRun(m, base, step, n, s + 7, s + 11)) result += PENALTY_N3;
    }
  }
  return result;
}

/**
 * ISO 18004 section 7.8.3 penalty. Rule 1: runs >= 5; rule 2: 2x2 blocks; rule 3: 1:1:3:1:1
 * finder-like pattern with 4 light modules on a side (the quiet zone counts as light);
 * rule 4: dark/light balance. Exported for tests.
 */
export function penaltyScore(m: Uint8Array, n: number): number {
  let result = 0;
  let dark = 0;
  for (let y = 0; y < n; y++) {
    const base = y * n;
    result += linePenalty(m, base, 1, n);
    const hasNextRow = y + 1 < n;
    dark += m[base + n - 1]!;
    for (let x = 0; x + 1 < n; x++) {
      const i = base + x;
      const c = m[i]!;
      dark += c;
      if (
        hasNextRow &&
        c === m[i + 1] &&
        c === m[i + n] &&
        c === m[i + n + 1]
      ) {
        result += PENALTY_N2;
      }
    }
  }
  for (let x = 0; x < n; x++) result += linePenalty(m, x, n, n);

  const total = n * n;
  result += Math.floor(Math.abs(dark * 20 - total * 10) / total) * PENALTY_N4;
  return result;
}

function buildMatrix(
  codewords: Uint8Array,
  version: number,
  ecc: QrEcc,
  mode: QrMode,
  forcedMask: number | null,
): QrMatrix {
  const size = symbolSize(version);
  const base: Grid = {
    size,
    modules: new Uint8Array(size * size),
    isFunction: new Uint8Array(size * size),
  };
  drawFunctionPatterns(base, version, ecc);
  placeCodewords(base, codewords);

  // `work` is rebuilt from the unmasked `base` for every candidate mask (no undo pass needed).
  const work: Grid = {
    size,
    modules: new Uint8Array(size * size),
    isFunction: base.isFunction,
  };
  const render = (mask: number): void => {
    const pattern = dataMaskPattern(mask, size);
    for (let i = 0; i < work.modules.length; i++) {
      work.modules[i] =
        base.modules[i]! ^ (pattern[i]! & (base.isFunction[i]! ^ 1));
    }
    drawFormat(work, ecc, mask);
  };

  let bestMask = forcedMask ?? 0;
  if (forcedMask === null) {
    let bestScore = Number.POSITIVE_INFINITY;
    for (let mask = 0; mask < 8; mask++) {
      render(mask);
      const score = penaltyScore(work.modules, size);
      if (score < bestScore) {
        bestScore = score;
        bestMask = mask;
      }
    }
  }
  render(bestMask);

  const modules = work.modules;
  return Object.freeze({
    size,
    version,
    ecc,
    mask: bestMask,
    mode,
    modules,
    get(x: number, y: number): boolean {
      return (
        x >= 0 && y >= 0 && x < size && y < size && modules[y * size + x] === 1
      );
    },
  });
}

// --- public entry point ---------------------------------------------------------------------

/** Result of the data-encoding half of `encodeQr` (everything before the matrix is drawn). */
export interface QrCodewords {
  version: number;
  ecc: QrEcc;
  mode: QrMode;
  /** Data codewords: header, payload, terminator and pad bytes (before error correction). */
  data: Uint8Array;
  /** Final stream placed into the matrix: data and error correction, block-interleaved. */
  codewords: Uint8Array;
}

interface ResolvedOptions {
  ecc: QrEcc;
  minVersion: number;
  maxVersion: number;
  mask: number | null;
}

function resolveOptions(opts: EncodeQrOptions): ResolvedOptions {
  const ecc = opts.ecc ?? "M";
  const minVersion = opts.minVersion ?? QR_MIN_VERSION;
  const maxVersion = opts.maxVersion ?? QR_MAX_VERSION;
  const mask = opts.mask ?? null;
  if (!isQrEcc(ecc))
    throw new QrError("bad-options", "QR ecc must be L, M, Q or H");
  if (
    !isQrVersion(minVersion) ||
    !isQrVersion(maxVersion) ||
    minVersion > maxVersion
  ) {
    throw new QrError(
      "bad-options",
      "QR version range must be within 1..40 (min <= max)",
    );
  }
  if (mask !== null && !(Number.isInteger(mask) && mask >= 0 && mask <= 7)) {
    throw new QrError("bad-options", "QR mask must be an integer 0..7");
  }
  return { ecc, minVersion, maxVersion, mask };
}

function prepareCodewords(text: string, o: ResolvedOptions): QrCodewords {
  if (typeof text !== "string")
    throw new QrError("bad-options", "QR text must be a string");
  const seg = makeSegment(text, o.ecc, o.maxVersion);
  const version = chooseVersion(seg, o.ecc, o.minVersion, o.maxVersion);
  if (version === null) {
    // numeric / alphanumeric text is pure ASCII, so its byte size equals its length
    throw new QrCapacityError(
      seg.mode === "byte" ? seg.count : text.length,
      qrCapacityBytes(o.maxVersion, o.ecc),
    );
  }
  const data = buildDataCodewords(seg, version, o.ecc);
  const codewords = addEccAndInterleave(data, version, o.ecc);
  return { version, ecc: o.ecc, mode: seg.mode, data, codewords };
}

/**
 * Data encoding only: mode selection, version choice, padding and error correction, without
 * drawing the matrix. Same errors and options as `encodeQr`. Exported for tests / tooling.
 */
export function encodeQrCodewords(
  text: string,
  opts: EncodeQrOptions = {},
): QrCodewords {
  return prepareCodewords(text, resolveOptions(opts));
}

/**
 * Encode `text` as a QR Code. Mode (numeric / alphanumeric / UTF-8 byte) is chosen
 * automatically; the smallest version in [minVersion, maxVersion] that fits is used.
 * @throws QrCapacityError (`code` "too-long") when the data does not fit.
 * @throws QrError (`code` "bad-options") for an invalid ecc / version range / mask / non-string.
 */
export function encodeQr(text: string, opts: EncodeQrOptions = {}): QrMatrix {
  const options = resolveOptions(opts);
  const { version, ecc, mode, codewords } = prepareCodewords(text, options);
  return buildMatrix(codewords, version, ecc, mode, options.mask);
}
