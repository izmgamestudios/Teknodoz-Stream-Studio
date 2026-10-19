// src/studio/p2p/qr-tables.ts
// Constant tables and table-derived helpers for the QR Code (ISO/IEC 18004) encoder in qr.ts:
// error correction block structure for versions 1-40, alignment pattern positions, character
// count field widths, the alphanumeric charset and the GF(256) log/antilog tables used by the
// Reed-Solomon coder. Everything here is pure and SSR-safe (no browser APIs).

export type QrEcc = "L" | "M" | "Q" | "H";
export type QrMode = "numeric" | "alphanumeric" | "byte";

export const QR_ECC_LEVELS: readonly QrEcc[] = ["L", "M", "Q", "H"];
export const QR_MIN_VERSION = 1;
export const QR_MAX_VERSION = 40;

/** Two-bit ECC level indicator stored in the format information (note: L=01, M=00). */
export const ECC_FORMAT_BITS: Readonly<Record<QrEcc, number>> = {
  L: 1,
  M: 0,
  Q: 3,
  H: 2,
};

/** Mode indicators (4 bits) written in front of every segment. */
export const MODE_INDICATOR: Readonly<Record<QrMode, number>> = {
  numeric: 0b0001,
  alphanumeric: 0b0010,
  byte: 0b0100,
};

/** The 45 characters of alphanumeric mode, in value order (index = code value). */
export const ALPHANUMERIC_CHARSET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

// Per-version tables below are indexed by `version - 1` (versions 1..40, so 40 entries each).

/** Error correction codewords per block (same for every block of a version/level). */
const ECC_CODEWORDS_PER_BLOCK: Readonly<Record<QrEcc, readonly number[]>> = {
  L: [
    7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28,
    28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
    30, 30,
  ],
  M: [
    10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26,
    26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
    28, 28,
  ],
  Q: [
    13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26,
    30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
    30, 30,
  ],
  H: [
    17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26,
    28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
    30, 30,
  ],
};

/** Total number of error correction blocks (data is split into this many blocks). */
const NUM_ERROR_CORRECTION_BLOCKS: Readonly<Record<QrEcc, readonly number[]>> =
  {
    L: [
      1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10,
      12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
    ],
    M: [
      1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17,
      18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
    ],
    Q: [
      1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23,
      23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65,
      68,
    ],
    H: [
      1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25,
      34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77,
      81,
    ],
  };

export function isQrEcc(value: unknown): value is QrEcc {
  return value === "L" || value === "M" || value === "Q" || value === "H";
}

export function isQrVersion(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= QR_MIN_VERSION &&
    value <= QR_MAX_VERSION
  );
}

/** Symbol edge length in modules: 21 (v1) ... 177 (v40). */
export function symbolSize(version: number): number {
  return version * 4 + 17;
}

/** Error correction codewords in each block. Caller guarantees a valid version/level. */
export function eccCodewordsPerBlock(version: number, ecc: QrEcc): number {
  return ECC_CODEWORDS_PER_BLOCK[ecc][version - 1] ?? 0;
}

/** Number of error correction blocks. Caller guarantees a valid version/level. */
export function numErrorCorrectionBlocks(version: number, ecc: QrEcc): number {
  return NUM_ERROR_CORRECTION_BLOCKS[ecc][version - 1] ?? 0;
}

/**
 * Number of modules that can carry codewords (everything except function patterns, format
 * and version information). Includes the 0/3/4/7 remainder bits of the version.
 */
export function numRawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

/** Total codewords (data + error correction) of a version. */
export function numRawCodewords(version: number): number {
  return Math.floor(numRawDataModules(version) / 8);
}

/** Data codewords (before error correction) available at a version/level. */
export function numDataCodewords(version: number, ecc: QrEcc): number {
  return (
    numRawCodewords(version) -
    eccCodewordsPerBlock(version, ecc) * numErrorCorrectionBlocks(version, ecc)
  );
}

/**
 * Alignment pattern centre coordinates (used for both axes) in ascending order; empty for
 * version 1. Version 32 is the one irregular case of the standard (step 26 instead of 28).
 */
export function alignmentPatternPositions(version: number): number[] {
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  const size = symbolSize(version);
  const step =
    version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step)
    result.splice(1, 0, pos);
  return result;
}

/** Width in bits of the character count field for a mode at a version. */
export function charCountBits(mode: QrMode, version: number): number {
  const band = version <= 9 ? 0 : version <= 26 ? 1 : 2;
  switch (mode) {
    case "numeric":
      return [10, 12, 14][band] ?? 14;
    case "alphanumeric":
      return [9, 11, 13][band] ?? 13;
    case "byte":
      return [8, 16, 16][band] ?? 16;
  }
}

// --- GF(256) with the QR primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11D) -------------

/** Antilog table, doubled (512 entries) so products need no modulo 255. */
export const GF_EXP = new Uint8Array(512);
/** Log table; GF_LOG[0] is unused (0). */
export const GF_LOG = new Uint8Array(256);

(function buildGaloisTables(): void {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]!;
})();

/** Multiplication in GF(256). Inputs must be bytes (0..255). */
export function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a]! + GF_LOG[b]!]!;
}
