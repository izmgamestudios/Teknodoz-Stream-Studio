// src/studio/p2p/qr.test.ts
// Part A (always runs): reference vectors from ISO/IEC 18004 and the QR tutorials, spec tables,
// GF(256) / Reed-Solomon properties, structural checks of the drawn symbol, penalty scoring
// against a spec-literal oracle, and the renderers.
// Part B (skipped when the dev-only `jsqr` package is not installed): decode round trips.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  QrCapacityError,
  QrError,
  addEccAndInterleave,
  dataMaskPattern,
  encodeQr,
  encodeQrCodewords,
  formatBits,
  penaltyScore,
  qrCapacity,
  qrCapacityBytes,
  reedSolomonGenerator,
  reedSolomonRemainder,
  utf8Encode,
  versionBits,
  type QrEcc,
  type QrMatrix,
} from "./qr";
import {
  qrToCanvas,
  qrToDataUrl,
  qrToSvg,
  type QrCanvasContextLike,
  type QrCanvasLike,
} from "./qr-render";
import {
  GF_EXP,
  GF_LOG,
  alignmentPatternPositions,
  charCountBits,
  eccCodewordsPerBlock,
  gfMul,
  numDataCodewords,
  numErrorCorrectionBlocks,
  numRawCodewords,
  numRawDataModules,
  symbolSize,
} from "./qr-tables";

const ECCS: readonly QrEcc[] = ["L", "M", "Q", "H"];

// --- helpers --------------------------------------------------------------------------------

function at<T>(list: ArrayLike<T>, index: number): T {
  const value = list[index];
  if (value === undefined) throw new Error(`index ${index} out of range`);
  return value;
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Printable ASCII containing a lowercase letter, so it is always encoded in byte mode. */
function byteModeText(length: number, seed: number): string {
  const rand = lcg(seed);
  const alphabet =
    "abcdefghijklmnopqrstuvwxyz0123456789 !#$%&()*+,-./:;<=>?@[]^_{|}~";
  let text = "";
  for (let i = 0; i < length; i++)
    text += alphabet.charAt(Math.floor(rand() * alphabet.length));
  return length > 0 ? `q${text.slice(1)}` : text;
}

function hex(bytes: ArrayLike<number>): string {
  return Array.from({ length: bytes.length }, (_, i) =>
    at(bytes, i).toString(16).padStart(2, "0"),
  ).join(" ");
}

function readBits(
  bytes: ArrayLike<number>,
  position: number,
  length: number,
): number {
  let value = 0;
  for (let i = 0; i < length; i++) {
    const p = position + i;
    value = (value << 1) | ((at(bytes, p >>> 3) >>> (7 - (p & 7))) & 1);
  }
  return value;
}

function popcount(value: number): number {
  let n = 0;
  for (let v = value; v !== 0; v >>>= 1) n += v & 1;
  return n;
}

// --- A1: GF(256) and Reed-Solomon -----------------------------------------------------------

describe("GF(256) tables (primitive polynomial 0x11D)", () => {
  it("has the textbook anchor values", () => {
    expect(GF_EXP[0]).toBe(1);
    expect(GF_EXP[1]).toBe(2);
    expect(GF_EXP[7]).toBe(128);
    expect(GF_EXP[8]).toBe(0x1d); // x^8 = x^4 + x^3 + x^2 + 1
    expect(GF_EXP[9]).toBe(0x3a);
    expect(GF_EXP[255]).toBe(1); // period 255
    expect(GF_EXP[254]).toBe(0x8e);
  });

  it("enumerates every non-zero element exactly once and log inverts exp", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 255; i++) {
      seen.add(at(GF_EXP, i));
      expect(GF_LOG[at(GF_EXP, i)]).toBe(i);
    }
    expect(seen.size).toBe(255);
    expect(seen.has(0)).toBe(false);
    for (let i = 255; i < 512; i++) expect(GF_EXP[i]).toBe(at(GF_EXP, i - 255));
  });

  it("multiplies like a field", () => {
    expect(gfMul(0, 77)).toBe(0);
    expect(gfMul(77, 0)).toBe(0);
    expect(gfMul(1, 200)).toBe(200);
    expect(gfMul(2, 128)).toBe(0x1d);
    expect(gfMul(0x57, 0x83)).toBe(gfMul(0x83, 0x57));
    for (let a = 1; a < 256; a++) {
      const inverse = at(GF_EXP, 255 - at(GF_LOG, a)); // a^-1
      expect(gfMul(a, inverse)).toBe(1);
    }
    // distributivity over xor (field addition)
    expect(gfMul(0x1b, 0x35 ^ 0x4c)).toBe(
      gfMul(0x1b, 0x35) ^ gfMul(0x1b, 0x4c),
    );
  });
});

describe("Reed-Solomon", () => {
  it("builds the generator polynomials of the QR tutorials (exponent form)", () => {
    // x^7 + a87 x^6 + a229 x^5 + a146 x^4 + a149 x^3 + a238 x^2 + a102 x + a21
    expect(Array.from(reedSolomonGenerator(7), (c) => at(GF_LOG, c))).toEqual([
      87, 229, 146, 149, 238, 102, 21,
    ]);
    expect(Array.from(reedSolomonGenerator(10), (c) => at(GF_LOG, c))).toEqual([
      251, 67, 46, 61, 118, 70, 64, 94, 32, 45,
    ]);
  });

  it("reproduces the ISO 18004 annex example '01234567' (version 1-M)", () => {
    const data = [
      0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11,
      0xec,
    ];
    data.push(0x11, 0xec, 0x11);
    expect(hex(reedSolomonRemainder(data, 10))).toBe(
      "a5 24 d4 c1 ed 36 c7 87 2c 55",
    );
  });

  it("reproduces the 'HELLO WORLD' tutorial example (version 1-M)", () => {
    const data = [
      32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17,
    ];
    expect(Array.from(reedSolomonRemainder(data, 10))).toEqual([
      196, 35, 39, 119, 235, 215, 231, 226, 93, 23,
    ]);
  });

  it("makes data||ecc divisible by the generator, and is linear", () => {
    const rand = lcg(7);
    for (const degree of [7, 10, 13, 18, 22, 26, 30]) {
      const a = Array.from({ length: 40 }, () => Math.floor(rand() * 256));
      const b = Array.from({ length: 40 }, () => Math.floor(rand() * 256));
      const ra = reedSolomonRemainder(a, degree);
      const rb = reedSolomonRemainder(b, degree);
      expect(Array.from(reedSolomonRemainder([...a, ...ra], degree))).toEqual(
        new Array<number>(degree).fill(0),
      );
      const rx = reedSolomonRemainder(
        a.map((v, i) => v ^ at(b, i)),
        degree,
      );
      expect(Array.from(rx)).toEqual(Array.from(ra, (v, i) => v ^ at(rb, i)));
    }
  });

  it("handles empty data and rejects bad degrees", () => {
    expect(Array.from(reedSolomonRemainder([], 7))).toEqual(
      new Array<number>(7).fill(0),
    );
    for (const bad of [0, -1, 256, 1.5, Number.NaN]) {
      expect(() => reedSolomonGenerator(bad)).toThrow(QrError);
    }
  });
});

// --- A2: standard tables --------------------------------------------------------------------

// Data codewords per version (1..40), ISO 18004 table 7 (also cross-checked against jsQR).
const DATA_CODEWORDS: Record<QrEcc, number[]> = {
  L: [
    19, 34, 55, 80, 108, 136, 156, 194, 232, 274, 324, 370, 428, 461, 523, 589,
    647, 721, 795, 861, 932, 1006, 1094, 1174, 1276, 1370, 1468, 1531, 1631,
    1735, 1843, 1955, 2071, 2191, 2306, 2434, 2566, 2702, 2812, 2956,
  ],
  M: [
    16, 28, 44, 64, 86, 108, 124, 154, 182, 216, 254, 290, 334, 365, 415, 453,
    507, 563, 627, 669, 714, 782, 860, 914, 1000, 1062, 1128, 1193, 1267, 1373,
    1455, 1541, 1631, 1725, 1812, 1914, 1992, 2102, 2216, 2334,
  ],
  Q: [
    13, 22, 34, 48, 62, 76, 88, 110, 132, 154, 180, 206, 244, 261, 295, 325,
    367, 397, 445, 485, 512, 568, 614, 664, 718, 754, 808, 871, 911, 985, 1033,
    1115, 1171, 1231, 1286, 1354, 1426, 1502, 1582, 1666,
  ],
  H: [
    9, 16, 26, 36, 46, 60, 66, 86, 100, 122, 140, 158, 180, 197, 223, 253, 283,
    313, 341, 385, 406, 442, 464, 514, 538, 596, 628, 661, 701, 745, 793, 845,
    901, 961, 986, 1054, 1096, 1142, 1222, 1276,
  ],
};

// Format information words with mask XOR applied, ISO 18004 table C.1, rows = mask 0..7.
const FORMAT_WORDS: Record<QrEcc, number[]> = {
  L: [0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976],
  M: [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0],
  Q: [0x355f, 0x3068, 0x3f31, 0x3a06, 0x24b4, 0x2183, 0x2eda, 0x2bed],
  H: [0x1689, 0x13be, 0x1ce7, 0x19d0, 0x0762, 0x0255, 0x0d0c, 0x083b],
};

// Version information words for versions 7..40, ISO 18004 table D.1.
const VERSION_WORDS = [
  0x07c94, 0x085bc, 0x09a99, 0x0a4d3, 0x0bbf6, 0x0c762, 0x0d847, 0x0e60d,
  0x0f928, 0x10b78, 0x1145d, 0x12a17, 0x13532, 0x149a6, 0x15683, 0x168c9,
  0x177ec, 0x18ec4, 0x191e1, 0x1afab, 0x1b08e, 0x1cc1a, 0x1d33f, 0x1ed75,
  0x1f250, 0x209d5, 0x216f0, 0x228ba, 0x2379f, 0x24b0b, 0x2542e, 0x26a64,
  0x27541, 0x28c69,
];

describe("standard tables", () => {
  it("matches the ISO data codeword capacity of all 160 version/level combinations", () => {
    for (const ecc of ECCS) {
      for (let v = 1; v <= 40; v++) {
        expect(numDataCodewords(v, ecc), `v${v}-${ecc}`).toBe(
          at(DATA_CODEWORDS[ecc], v - 1),
        );
      }
    }
  });

  it("knows the total codewords per version and the raw module count", () => {
    const totals: Record<number, number> = {
      1: 26,
      2: 44,
      3: 70,
      4: 100,
      5: 134,
      6: 172,
      7: 196,
      10: 346,
      20: 1085,
      40: 3706,
    };
    for (const [v, total] of Object.entries(totals)) {
      expect(numRawCodewords(Number(v)), `v${v}`).toBe(total);
    }
    expect(numRawDataModules(1)).toBe(208); // 26 codewords, no remainder bits
    expect(numRawDataModules(2)).toBe(359); // 44 codewords + 7 remainder bits
    expect(numRawDataModules(7)).toBe(1568); // 196 codewords, no remainder bits
    expect(symbolSize(1)).toBe(21);
    expect(symbolSize(40)).toBe(177);
  });

  it("has the block structure of the spec's well-known entries", () => {
    expect([
      eccCodewordsPerBlock(1, "L"),
      numErrorCorrectionBlocks(1, "L"),
    ]).toEqual([7, 1]);
    expect([
      eccCodewordsPerBlock(1, "M"),
      numErrorCorrectionBlocks(1, "M"),
    ]).toEqual([10, 1]);
    // 5-Q: 4 blocks of 18 ecc codewords (2 x 15 + 2 x 16 data codewords)
    expect([
      eccCodewordsPerBlock(5, "Q"),
      numErrorCorrectionBlocks(5, "Q"),
    ]).toEqual([18, 4]);
    expect([
      eccCodewordsPerBlock(40, "H"),
      numErrorCorrectionBlocks(40, "H"),
    ]).toEqual([30, 81]);
    expect([
      eccCodewordsPerBlock(40, "L"),
      numErrorCorrectionBlocks(40, "L"),
    ]).toEqual([30, 25]);
  });

  it("computes alignment pattern coordinates", () => {
    const known: Record<number, number[]> = {
      1: [],
      2: [6, 18],
      3: [6, 22],
      6: [6, 34],
      7: [6, 22, 38],
      14: [6, 26, 46, 66],
      22: [6, 26, 50, 74, 98],
      23: [6, 30, 54, 78, 102], // jsQR 1.4.0 mistakenly lists 74 here
      32: [6, 34, 60, 86, 112, 138], // the irregular step-26 case
      36: [6, 24, 50, 76, 102, 128, 154],
      40: [6, 30, 58, 86, 114, 142, 170],
    };
    for (const [v, expected] of Object.entries(known)) {
      expect(alignmentPatternPositions(Number(v)), `v${v}`).toEqual(expected);
    }
    for (let v = 2; v <= 40; v++) {
      const pos = alignmentPatternPositions(v);
      expect(pos.length).toBe(Math.floor(v / 7) + 2);
      expect(pos[0]).toBe(6);
      expect(pos[pos.length - 1]).toBe(symbolSize(v) - 7);
      for (let i = 1; i < pos.length; i++)
        expect(at(pos, i)).toBeGreaterThan(at(pos, i - 1));
    }
  });

  it("has the character count field widths of table 3", () => {
    expect(
      [1, 9, 10, 26, 27, 40].map((v) => charCountBits("numeric", v)),
    ).toEqual([10, 10, 12, 12, 14, 14]);
    expect(
      [1, 9, 10, 26, 27, 40].map((v) => charCountBits("alphanumeric", v)),
    ).toEqual([9, 9, 11, 11, 13, 13]);
    expect([1, 9, 10, 26, 27, 40].map((v) => charCountBits("byte", v))).toEqual(
      [8, 8, 16, 16, 16, 16],
    );
  });
});

describe("capacity", () => {
  it("returns the published byte capacities", () => {
    expect(qrCapacityBytes(1, "L")).toBe(17);
    expect(qrCapacityBytes(1, "M")).toBe(14);
    expect(qrCapacityBytes(1, "Q")).toBe(11);
    expect(qrCapacityBytes(1, "H")).toBe(7);
    expect(qrCapacityBytes(10, "M")).toBe(213);
    expect(qrCapacityBytes(40, "L")).toBe(2953);
    expect(qrCapacityBytes(40, "M")).toBe(2331);
    expect(qrCapacityBytes(40, "Q")).toBe(1663);
    expect(qrCapacityBytes(40, "H")).toBe(1273);
  });

  it("returns the published numeric / alphanumeric capacities", () => {
    expect([1, 10, 40].map((v) => qrCapacity(v, "L", "numeric"))).toEqual([
      41, 652, 7089,
    ]);
    expect([1, 10, 40].map((v) => qrCapacity(v, "L", "alphanumeric"))).toEqual([
      25, 395, 4296,
    ]);
    expect([1, 10, 40].map((v) => qrCapacity(v, "M", "numeric"))).toEqual([
      34, 513, 5596,
    ]);
    expect([1, 10, 40].map((v) => qrCapacity(v, "M", "alphanumeric"))).toEqual([
      20, 311, 3391,
    ]);
    expect([1, 10, 40].map((v) => qrCapacity(v, "H", "numeric"))).toEqual([
      17, 288, 3057,
    ]);
  });

  it("caps at what the character count field can express", () => {
    // v26-L would hold 2132 alphanumeric chars, but the 11-bit count tops out at 2047.
    expect(qrCapacity(26, "L", "alphanumeric")).toBeLessThanOrEqual(2047);
    expect(qrCapacity(27, "L", "alphanumeric")).toBe(2132);
  });

  it("rejects invalid version / level", () => {
    expect(() => qrCapacityBytes(0, "L")).toThrow(QrError);
    expect(() => qrCapacityBytes(41, "L")).toThrow(QrError);
    expect(() => qrCapacityBytes(1.5, "L")).toThrow(QrError);
    expect(() => qrCapacityBytes(1, "X" as QrEcc)).toThrow(QrError);
  });
});

// --- A3: format / version information -------------------------------------------------------

describe("format and version information", () => {
  it("matches the ISO format information table for all 32 (level, mask) pairs", () => {
    for (const ecc of ECCS) {
      for (let mask = 0; mask < 8; mask++) {
        expect(formatBits(ecc, mask), `${ecc}${mask}`).toBe(
          at(FORMAT_WORDS[ecc], mask),
        );
      }
    }
  });

  it("is a BCH(15,5) code: valid remainder and minimum distance 7", () => {
    const words: number[] = [];
    for (const ecc of ECCS)
      for (let mask = 0; mask < 8; mask++) words.push(formatBits(ecc, mask));
    for (const word of words) {
      let rem = word ^ 0x5412; // undo the mask
      for (let bit = 14; bit >= 10; bit--)
        if ((rem >>> bit) & 1) rem ^= 0x537 << (bit - 10);
      expect(rem).toBe(0);
    }
    let minDistance = 99;
    for (let i = 0; i < words.length; i++) {
      for (let j = i + 1; j < words.length; j++) {
        minDistance = Math.min(
          minDistance,
          popcount(at(words, i) ^ at(words, j)),
        );
      }
    }
    expect(minDistance).toBe(7);
  });

  it("matches the ISO version information table for versions 7..40", () => {
    for (let v = 7; v <= 40; v++)
      expect(versionBits(v), `v${v}`).toBe(at(VERSION_WORDS, v - 7));
  });

  it("is a BCH(18,6) code with distance >= 8", () => {
    for (let v = 7; v <= 40; v++) {
      let rem = versionBits(v);
      for (let bit = 17; bit >= 12; bit--)
        if ((rem >>> bit) & 1) rem ^= 0x1f25 << (bit - 12);
      expect(rem).toBe(0);
    }
    let minDistance = 99;
    for (let a = 7; a <= 40; a++) {
      for (let b = a + 1; b <= 40; b++) {
        minDistance = Math.min(
          minDistance,
          popcount(versionBits(a) ^ versionBits(b)),
        );
      }
    }
    expect(minDistance).toBeGreaterThanOrEqual(8);
  });
});

// --- A4: data encoding ----------------------------------------------------------------------

describe("data codewords", () => {
  it("encodes '01234567' like the ISO 18004 annex (numeric, 1-M)", () => {
    const result = encodeQrCodewords("01234567", { ecc: "M" });
    expect(result.version).toBe(1);
    expect(result.mode).toBe("numeric");
    expect(hex(result.data)).toBe(
      "10 20 0c 56 61 80 ec 11 ec 11 ec 11 ec 11 ec 11",
    );
    expect(hex(result.codewords)).toBe(
      "10 20 0c 56 61 80 ec 11 ec 11 ec 11 ec 11 ec 11 a5 24 d4 c1 ed 36 c7 87 2c 55",
    );
  });

  it("encodes 'HELLO WORLD' like the alphanumeric tutorial example (1-M)", () => {
    const result = encodeQrCodewords("HELLO WORLD", { ecc: "M" });
    expect(result.version).toBe(1);
    expect(result.mode).toBe("alphanumeric");
    expect(Array.from(result.data)).toEqual([
      32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17,
    ]);
    expect(Array.from(result.codewords.slice(16))).toEqual([
      196, 35, 39, 119, 235, 215, 231, 226, 93, 23,
    ]);
  });

  it("selects the cheapest mode", () => {
    expect(encodeQrCodewords("0123456789").mode).toBe("numeric");
    expect(encodeQrCodewords("HELLO WORLD $%*+-./:").mode).toBe("alphanumeric");
    expect(encodeQrCodewords("Hello").mode).toBe("byte"); // lowercase
    expect(encodeQrCodewords("ABC-123 é").mode).toBe("byte");
    expect(encodeQrCodewords("").mode).toBe("byte");
    expect(encodeQrCodewords("12 34").mode).toBe("alphanumeric"); // space is alphanumeric
  });

  it("packs byte mode as UTF-8 behind a mode nibble and an 8/16 bit count", () => {
    const text = "Merhaba dünya! 你好 🎥";
    const bytes = utf8Encode(text);
    const result = encodeQrCodewords(text, { ecc: "L" });
    expect(result.mode).toBe("byte");
    expect(readBits(result.data, 0, 4)).toBe(0b0100);
    expect(readBits(result.data, 4, 8)).toBe(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      expect(readBits(result.data, 12 + i * 8, 8)).toBe(at(bytes, i));
    }
    // 16 bit count from version 10 up
    const long = encodeQrCodewords("a".repeat(300), { ecc: "L" });
    expect(long.version).toBeGreaterThanOrEqual(10);
    expect(readBits(long.data, 0, 4)).toBe(0b0100);
    expect(readBits(long.data, 4, 16)).toBe(300);
  });

  it("terminates and pads with 0xEC / 0x11 up to the data capacity", () => {
    const result = encodeQrCodewords("a", { ecc: "H" });
    expect(result.data.length).toBe(numDataCodewords(1, "H"));
    // header 4 + 8 bits, 8 data bits, terminator -> byte 3 onwards is padding
    expect(Array.from(result.data.slice(3))).toEqual([
      0xec, 0x11, 0xec, 0x11, 0xec, 0x11,
    ]);
  });

  it("truncates the terminator when fewer than 4 bits are left", () => {
    // 41 digits at 1-L: 4 + 10 + 13 * 10 + 7 = 151 of 152 bits, so only 1 terminator bit fits
    const result = encodeQrCodewords("1".repeat(41), { ecc: "L" });
    expect(result.version).toBe(1);
    expect(result.mode).toBe("numeric");
    expect(result.data.length).toBe(19);
    expect(readBits(result.data, 151, 1)).toBe(0);
    expect(encodeQrCodewords("1".repeat(42), { ecc: "L" }).version).toBe(2);
  });

  it("fills version 1 byte mode exactly at its capacity", () => {
    const full = qrCapacityBytes(1, "L");
    expect(encodeQrCodewords("z".repeat(full), { ecc: "L" }).version).toBe(1);
    expect(encodeQrCodewords("z".repeat(full + 1), { ecc: "L" }).version).toBe(
      2,
    );
  });

  it("picks the smallest fitting version at every capacity boundary", () => {
    for (const ecc of ECCS) {
      for (let v = 1; v <= 40; v++) {
        const cap = qrCapacityBytes(v, ecc);
        expect(
          encodeQrCodewords("z".repeat(cap), { ecc }).version,
          `${cap} B ${ecc}`,
        ).toBe(v);
        if (v < 40) {
          expect(
            encodeQrCodewords("z".repeat(cap + 1), { ecc }).version,
            `${cap + 1} B ${ecc}`,
          ).toBe(v + 1);
        } else {
          expect(() => encodeQrCodewords("z".repeat(cap + 1), { ecc })).toThrow(
            QrCapacityError,
          );
        }
      }
    }
  });

  it("skips versions whose character count field is too narrow", () => {
    // 2100 alphanumeric chars would fit v26-L by bits, but 11-bit counts stop at 2047.
    const text = "A".repeat(2100);
    const result = encodeQrCodewords(text, { ecc: "L" });
    expect(result.mode).toBe("alphanumeric");
    expect(result.version).toBe(27);
  });

  it("honours minVersion / maxVersion", () => {
    expect(encodeQrCodewords("hi", { ecc: "L", minVersion: 5 }).version).toBe(
      5,
    );
    expect(
      encodeQrCodewords("a".repeat(100), {
        ecc: "L",
        minVersion: 1,
        maxVersion: 40,
      }).version,
    ).toBe(5);
    expect(() =>
      encodeQrCodewords("a".repeat(100), { ecc: "L", maxVersion: 4 }),
    ).toThrow(QrCapacityError);
  });

  it("interleaves multiple blocks per the standard (5-Q: 2 x 15 + 2 x 16 data codewords)", () => {
    const data = Uint8Array.from(
      { length: numDataCodewords(5, "Q") },
      (_, i) => (i * 37 + 11) & 255,
    );
    const blocks = [
      data.slice(0, 15),
      data.slice(15, 30),
      data.slice(30, 46),
      data.slice(46, 62),
    ];
    const eccBlocks = blocks.map((b) => reedSolomonRemainder(b, 18));
    const expected: number[] = [];
    for (let i = 0; i < 16; i++)
      for (const b of blocks) if (i < b.length) expected.push(at(b, i));
    for (let i = 0; i < 18; i++)
      for (const e of eccBlocks) expected.push(at(e, i));
    const actual = addEccAndInterleave(data, 5, "Q");
    expect(actual.length).toBe(134);
    expect(Array.from(actual)).toEqual(expected);
  });

  it("produces valid Reed-Solomon blocks for all 160 version/level combinations", () => {
    const rand = lcg(99);
    for (const ecc of ECCS) {
      for (let v = 1; v <= 40; v++) {
        const data = Uint8Array.from({ length: numDataCodewords(v, ecc) }, () =>
          Math.floor(rand() * 256),
        );
        const stream = addEccAndInterleave(data, v, ecc);
        expect(stream.length).toBe(numRawCodewords(v));
        // de-interleave and verify every block's remainder is zero
        const blocks = numErrorCorrectionBlocks(v, ecc);
        const eccLen = eccCodewordsPerBlock(v, ecc);
        const shortBlocks = blocks - (numRawCodewords(v) % blocks);
        const shortDataLen = Math.floor(numRawCodewords(v) / blocks) - eccLen;
        const rows: number[][] = Array.from({ length: blocks }, () => []);
        let p = 0;
        for (let i = 0; i <= shortDataLen; i++) {
          for (let b = 0; b < blocks; b++) {
            if (i < shortDataLen || b >= shortBlocks)
              at(rows, b).push(at(stream, p++));
          }
        }
        for (let i = 0; i < eccLen; i++)
          for (let b = 0; b < blocks; b++) at(rows, b).push(at(stream, p++));
        expect(p).toBe(stream.length);
        let q = 0;
        rows.forEach((row) => {
          expect(
            Array.from(reedSolomonRemainder(row, eccLen)),
            `v${v}${ecc}`,
          ).toEqual(new Array<number>(eccLen).fill(0));
          const own = row.slice(0, row.length - eccLen);
          expect(Array.from(data.slice(q, q + own.length))).toEqual(own);
          q += own.length;
        });
        expect(q).toBe(data.length);
      }
    }
  });
});

describe("utf8Encode", () => {
  it("matches TextEncoder, including astral characters and lone surrogates", () => {
    const samples = [
      "",
      "plain ascii",
      "ğüşiöç ĞÜŞİÖÇ",
      "你好，世界",
      "🎥🎙️👨‍👩‍👧‍👦",
      "mixed \u0000 \u007f \u0080 ߿ ࠀ ￿ \u{10000} \u{10ffff}",
      "lone high \ud83d end",
      "lone low \ude00 end",
      "swapped \ude00\ud83d pair",
      "trailing high \ud83d",
    ];
    for (const sample of samples) {
      expect(Array.from(utf8Encode(sample)), JSON.stringify(sample)).toEqual(
        Array.from(new TextEncoder().encode(sample)),
      );
    }
  });
});

// --- A5: option validation and errors -------------------------------------------------------

describe("encodeQr errors and options", () => {
  it("throws QrCapacityError('too-long') when data does not fit", () => {
    let error: unknown;
    try {
      encodeQr("a".repeat(2954), { ecc: "L" });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(QrCapacityError);
    expect(error).toBeInstanceOf(QrError);
    expect(error).toBeInstanceOf(Error);
    const capacity = error as QrCapacityError;
    expect(capacity.code).toBe("too-long");
    expect(capacity.name).toBe("QrCapacityError");
    expect(capacity.payloadBytes).toBe(2954);
    expect(capacity.maxBytes).toBe(2953);
    expect(typeof capacity.message).toBe("string");
  });

  it("measures the payload in UTF-8 bytes", () => {
    // 1500 two-byte characters = 3000 bytes > 2953
    expect(() => encodeQr("é".repeat(1500), { ecc: "L" })).toThrow(
      QrCapacityError,
    );
    expect(
      encodeQr("é".repeat(1400), { ecc: "L" }).version,
    ).toBeLessThanOrEqual(40);
  });

  it("rejects absurdly long input cheaply, without encoding it", () => {
    const started = performance.now();
    for (const ecc of ECCS) {
      expect(() => encodeQr("x".repeat(2_000_000), { ecc })).toThrow(
        QrCapacityError,
      );
    }
    expect(() => encodeQr("7".repeat(7090), { ecc: "L" })).toThrow(
      QrCapacityError,
    );
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("accepts the numeric / alphanumeric maxima", () => {
    expect(encodeQr("7".repeat(7089), { ecc: "L" }).version).toBe(40);
    expect(encodeQr("A".repeat(4296), { ecc: "L" }).version).toBe(40);
    expect(() => encodeQr("A".repeat(4297), { ecc: "L" })).toThrow(
      QrCapacityError,
    );
  });

  it("reports bad options as QrError('bad-options')", () => {
    const bad: Array<() => unknown> = [
      () => encodeQr("x", { ecc: "Z" as QrEcc }),
      () => encodeQr("x", { minVersion: 0 }),
      () => encodeQr("x", { minVersion: 41 }),
      () => encodeQr("x", { maxVersion: 1.5 }),
      () => encodeQr("x", { maxVersion: Number.NaN }),
      () => encodeQr("x", { minVersion: 10, maxVersion: 5 }),
      () => encodeQr("x", { mask: 8 }),
      () => encodeQr("x", { mask: -1 }),
      () => encodeQr("x", { mask: 1.5 }),
      () => encodeQr(42 as unknown as string),
      () => encodeQr(null as unknown as string),
    ];
    for (const fn of bad) {
      let error: unknown;
      try {
        fn();
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(QrError);
      expect((error as QrError).code).toBe("bad-options");
    }
  });

  it("defaults to ECC level M and accepts undefined options explicitly", () => {
    expect(encodeQr("hello").ecc).toBe("M");
    expect(
      encodeQr("hello", { ecc: undefined, minVersion: undefined }).ecc,
    ).toBe("M");
  });
});

// --- A6: symbol structure -------------------------------------------------------------------

function readFormat(m: QrMatrix, copy: 1 | 2): number {
  let bits = 0;
  for (let i = 0; i < 15; i++) {
    let x: number;
    let y: number;
    if (copy === 1) {
      if (i <= 5) [x, y] = [8, i];
      else if (i === 6) [x, y] = [8, 7];
      else if (i === 7) [x, y] = [8, 8];
      else if (i === 8) [x, y] = [7, 8];
      else [x, y] = [14 - i, 8];
    } else if (i < 8) {
      [x, y] = [m.size - 1 - i, 8];
    } else {
      [x, y] = [8, m.size - 15 + i];
    }
    if (m.get(x, y)) bits |= 1 << i;
  }
  return bits;
}

describe("symbol structure", () => {
  const samples: Array<[string, QrEcc, number]> = [
    ["hi", "L", 1],
    ["hello world", "M", 2],
    ["structure", "Q", 6],
    ["structure", "H", 7],
    ["structure", "M", 14],
    ["structure", "L", 22],
    ["structure", "Q", 35],
    ["structure", "H", 40],
  ];

  it.each(samples)(
    "draws the function patterns of %j at ECC %s, version %i",
    (text, ecc, v) => {
      const m = encodeQr(text, { ecc, minVersion: v, maxVersion: v });
      const n = m.size;
      expect(m.version).toBe(v);
      expect(n).toBe(17 + 4 * v);
      expect(m.modules.length).toBe(n * n);

      // finder patterns: 7x7 ring layout 1111111 / 1000001 / 1011101 ... and light separators
      for (const [left, top] of [
        [0, 0],
        [n - 7, 0],
        [0, n - 7],
      ] as const) {
        for (let dy = 0; dy < 7; dy++) {
          for (let dx = 0; dx < 7; dx++) {
            const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
            expect(
              m.get(left + dx, top + dy),
              `finder ${left},${top} ${dx},${dy}`,
            ).toBe(ring !== 2);
          }
        }
      }
      for (let i = 0; i < 8; i++) {
        expect(m.get(7, i)).toBe(false); // separators of the top-left finder
        expect(m.get(i, 7)).toBe(false);
        expect(m.get(n - 8, i)).toBe(false);
        expect(m.get(n - 8 + i, 7)).toBe(false);
        expect(m.get(7, n - 8 + i)).toBe(false);
        expect(m.get(i, n - 8)).toBe(false);
      }

      // timing patterns
      for (let i = 8; i < n - 8; i++) {
        expect(m.get(i, 6), `timing row ${i}`).toBe(i % 2 === 0);
        expect(m.get(6, i), `timing col ${i}`).toBe(i % 2 === 0);
      }

      // dark module
      expect(m.get(8, n - 8)).toBe(true);

      // alignment patterns (5x5: dark ring, light ring, dark centre), skipping finder corners
      const pos = alignmentPatternPositions(v);
      for (let i = 0; i < pos.length; i++) {
        for (let j = 0; j < pos.length; j++) {
          const last = pos.length - 1;
          if (
            (i === 0 && j === 0) ||
            (i === 0 && j === last) ||
            (i === last && j === 0)
          )
            continue;
          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              const dist = Math.max(Math.abs(dx), Math.abs(dy));
              expect(
                m.get(at(pos, i) + dx, at(pos, j) + dy),
                `align ${i},${j}`,
              ).toBe(dist !== 1);
            }
          }
        }
      }

      // format information, both copies
      const expectedFormat = formatBits(ecc, m.mask);
      expect(readFormat(m, 1)).toBe(expectedFormat);
      expect(readFormat(m, 2)).toBe(expectedFormat);

      // version information, both copies (versions >= 7)
      if (v >= 7) {
        const word = versionBits(v);
        for (let i = 0; i < 18; i++) {
          const bit = ((word >>> i) & 1) === 1;
          const a = n - 11 + (i % 3);
          const b = Math.floor(i / 3);
          expect(m.get(a, b), `version copy 1 bit ${i}`).toBe(bit);
          expect(m.get(b, a), `version copy 2 bit ${i}`).toBe(bit);
        }
      }
    },
  );

  it("exposes a consistent matrix object", () => {
    const m = encodeQr("matrix api", { ecc: "Q" });
    expect(m.ecc).toBe("Q");
    expect(m.mode).toBe("byte");
    expect(m.mask).toBeGreaterThanOrEqual(0);
    expect(m.mask).toBeLessThan(8);
    expect(Object.isFrozen(m)).toBe(true);
    for (let y = 0; y < m.size; y++) {
      for (let x = 0; x < m.size; x++) {
        expect(m.get(x, y)).toBe(m.modules[y * m.size + x] === 1);
      }
    }
    for (const [x, y] of [
      [-1, 0],
      [0, -1],
      [m.size, 0],
      [0, m.size],
      [1.5, 2],
      [Number.NaN, 0],
    ] as const) {
      expect(m.get(x, y)).toBe(false);
    }
    expect(Array.from(m.modules).every((v) => v === 0 || v === 1)).toBe(true);
  });

  it("is deterministic and depends on the data", () => {
    const a = encodeQr("deterministic", { ecc: "M" });
    const b = encodeQr("deterministic", { ecc: "M" });
    const c = encodeQr("deterministiC", { ecc: "M" });
    expect(Array.from(a.modules)).toEqual(Array.from(b.modules));
    expect(Array.from(a.modules)).not.toEqual(Array.from(c.modules));
    expect(encodeQr("deterministic", { ecc: "L" }).ecc).toBe("L");
  });
});

// --- A7: masks and penalty ------------------------------------------------------------------

describe("data masks", () => {
  it("implements the eight patterns of ISO 18004 table 10", () => {
    const spec: Array<(i: number, j: number) => boolean> = [
      (i, j) => (i + j) % 2 === 0,
      (i) => i % 2 === 0,
      (_i, j) => j % 3 === 0,
      (i, j) => (i + j) % 3 === 0,
      (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
      (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
      (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
      (i, j) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0,
    ];
    for (const size of [21, 25, 57, 177]) {
      for (let mask = 0; mask < 8; mask++) {
        const pattern = dataMaskPattern(mask, size);
        for (let i = 0; i < size; i++) {
          for (let j = 0; j < size; j++) {
            if ((pattern[i * size + j] === 1) !== at(spec, mask)(i, j)) {
              throw new Error(
                `mask ${mask} differs at row ${i}, column ${j} (size ${size})`,
              );
            }
          }
        }
      }
    }
  });
});

/** Penalty straight from the wording of ISO 18004 section 7.8.3 (slow, string based). */
function referencePenalty(modules: Uint8Array, n: number): number {
  let total = 0;
  const lines: string[] = [];
  for (let y = 0; y < n; y++) {
    let row = "";
    let col = "";
    for (let x = 0; x < n; x++) {
      row += at(modules, y * n + x);
      col += at(modules, x * n + y);
    }
    lines.push(row, col);
  }
  for (const line of lines) {
    for (const run of line.matchAll(/0{5,}|1{5,}/g))
      total += 3 + run[0].length - 5;
    const padded = `0000${line}0000`; // the quiet zone is light
    for (const pattern of ["10111010000", "00001011101"]) {
      for (
        let i = padded.indexOf(pattern);
        i !== -1;
        i = padded.indexOf(pattern, i + 1)
      ) {
        total += 40;
      }
    }
  }
  let dark = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const c = at(modules, y * n + x);
      dark += c;
      if (
        x + 1 < n &&
        y + 1 < n &&
        c === at(modules, y * n + x + 1) &&
        c === at(modules, (y + 1) * n + x) &&
        c === at(modules, (y + 1) * n + x + 1)
      ) {
        total += 3;
      }
    }
  }
  // rule 4: one step of 10 points per complete 5% of deviation from 50% dark (integer math)
  const deviationTimes100 = Math.abs(dark * 100 - n * n * 50);
  let steps = 0;
  while (deviationTimes100 >= (steps + 1) * 5 * n * n) steps++;
  return total + steps * 10;
}

describe("penalty scoring", () => {
  it("scores the degenerate matrices by hand", () => {
    const n = 21;
    // all light: rule 1 = 42 lines * (3 + 16); rule 2 = 400 blocks * 3; rule 4 = 10 steps * 10
    expect(penaltyScore(new Uint8Array(n * n), n)).toBe(
      42 * 19 + 400 * 3 + 100,
    );
    // all dark: same runs and blocks, same balance penalty
    expect(penaltyScore(new Uint8Array(n * n).fill(1), n)).toBe(
      42 * 19 + 400 * 3 + 100,
    );
    // checkerboard: no runs, no blocks, no finder-like pattern, 221/441 dark = 50.1%
    const board = new Uint8Array(n * n);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) board[y * n + x] = (x + y) % 2 === 0 ? 1 : 0;
    expect(penaltyScore(board, n)).toBe(0);
  });

  it("counts a finder-like 1:1:3:1:1 pattern with light on both sides, and the quiet zone", () => {
    const n = 21;
    const m = new Uint8Array(n * n).fill(0);
    // rows full of alternating modules so that only the planted pattern matters: use a board
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) m[y * n + x] = (x + y) % 2 === 0 ? 1 : 0;
    // clear row 10 and plant 1011101 at columns 8..14 with light everywhere else in that row
    for (let x = 0; x < n; x++) m[10 * n + x] = 0;
    for (const x of [8, 10, 11, 12, 14]) m[10 * n + x] = 1;
    expect(penaltyScore(m, n)).toBe(referencePenalty(m, n));
    expect(penaltyScore(m, n)).toBeGreaterThanOrEqual(80); // 4 light on both sides => 2 x 40
  });

  it("agrees with the spec-literal oracle on random and structured grids", () => {
    const rand = lcg(2024);
    for (const n of [21, 25, 29, 33, 45]) {
      for (let trial = 0; trial < 12; trial++) {
        const density = 0.2 + 0.6 * rand();
        const m = new Uint8Array(n * n);
        for (let i = 0; i < m.length; i++) m[i] = rand() < density ? 1 : 0;
        // plant finder-like patterns, runs and blocks
        for (let k = 0; k < 6; k++) {
          const y = Math.floor(rand() * n);
          const x = Math.floor(rand() * (n - 11));
          [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0].forEach((bit, i) => {
            if (rand() < 0.5) m[y * n + x + i] = bit;
            else m[(x + i) * n + y] = bit;
          });
        }
        expect(penaltyScore(m, n), `n=${n} trial=${trial}`).toBe(
          referencePenalty(m, n),
        );
      }
    }
  });

  it("agrees with the oracle on real symbols for every mask", () => {
    for (const [text, ecc] of [
      ["penalty one", "L"],
      ["penalty two with a longer text to grow the symbol", "H"],
    ] as const) {
      for (let mask = 0; mask < 8; mask++) {
        const m = encodeQr(text, { ecc, mask });
        expect(penaltyScore(m.modules, m.size), `${ecc} mask ${mask}`).toBe(
          referencePenalty(m.modules, m.size),
        );
      }
    }
  });

  it("picks the lowest-penalty mask (ties: the lowest index)", () => {
    for (const [text, ecc] of [
      ["mask choice", "M"],
      ["https://teknodoz.example/join#AbCdEf", "L"],
      ["12345678901234567890", "Q"],
      ["a".repeat(300), "H"],
    ] as const) {
      const scores: number[] = [];
      for (let mask = 0; mask < 8; mask++) {
        const forced = encodeQr(text, { ecc, mask });
        expect(forced.mask).toBe(mask);
        scores.push(penaltyScore(forced.modules, forced.size));
      }
      const best = scores.indexOf(Math.min(...scores));
      const auto = encodeQr(text, { ecc });
      expect(auto.mask, `${ecc} ${text.slice(0, 12)}`).toBe(best);
      expect(Array.from(auto.modules)).toEqual(
        Array.from(encodeQr(text, { ecc, mask: best }).modules),
      );
    }
  });
});

// --- A8: performance ------------------------------------------------------------------------

describe("performance", () => {
  it("encodes a 2 KB payload well under 100 ms (after warm-up)", () => {
    const text = byteModeText(2048, 5);
    encodeQr(text, { ecc: "L" });
    const timings: number[] = [];
    for (let i = 0; i < 5; i++) {
      const started = performance.now();
      const m = encodeQr(text, { ecc: i % 2 === 0 ? "L" : "M" });
      timings.push(performance.now() - started);
      expect(m.version).toBeGreaterThan(30);
    }
    timings.sort((a, b) => a - b);
    expect(at(timings, 2)).toBeLessThan(100); // median; typical is 10-15 ms
  });
});

// --- A9: renderers --------------------------------------------------------------------------

/** Parse our own SVG back into a module grid (and check every byte of the path is understood). */
function parseSvg(
  svg: string,
  margin: number,
): { total: number; modules: Uint8Array; size: number } {
  const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  const path = /<path fill="[^"]+" d="([^"]*)"\/>/.exec(svg);
  if (!viewBox || !path) throw new Error("unexpected svg shape");
  const total = Number(viewBox[1]);
  const size = total - margin * 2;
  const modules = new Uint8Array(size * size);
  let consumed = 0;
  for (const run of at(path, 1).matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)) {
    expect(run[3]).toBe(run[4]);
    const x = Number(run[1]) - margin;
    const y = Number(run[2]) - margin;
    for (let i = 0; i < Number(run[3]); i++) modules[y * size + x + i] = 1;
    consumed += run[0].length;
  }
  expect(consumed).toBe(at(path, 1).length);
  return { total, modules, size };
}

function darkRuns(m: QrMatrix): number {
  let runs = 0;
  for (let y = 0; y < m.size; y++) {
    for (let x = 0; x < m.size; x++)
      if (m.get(x, y) && !m.get(x - 1, y)) runs++;
  }
  return runs;
}

interface FakeCanvas extends QrCanvasLike {
  rects: Array<{ fill: unknown; x: number; y: number; w: number; h: number }>;
  smoothing: boolean | null;
}

function fakeCanvas(hasContext = true): FakeCanvas {
  const canvas: FakeCanvas = {
    width: 0,
    height: 0,
    rects: [],
    smoothing: null,
    getContext() {
      if (!hasContext) return null;
      const context: QrCanvasContextLike = {
        fillStyle: "",
        get imageSmoothingEnabled(): boolean {
          return canvas.smoothing ?? true;
        },
        set imageSmoothingEnabled(value: boolean) {
          canvas.smoothing = value;
        },
        fillRect(x: number, y: number, w: number, h: number) {
          canvas.rects.push({ fill: context.fillStyle, x, y, w, h });
        },
      };
      return context;
    },
  };
  return canvas;
}

describe("qrToSvg", () => {
  it("round-trips the matrix through its single path, for several margins", () => {
    for (const [text, ecc] of [
      ["svg", "L"],
      ["https://teknodoz.example/join#" + byteModeText(200, 3), "M"],
      ["0123456789".repeat(20), "H"],
    ] as const) {
      const m = encodeQr(text, { ecc });
      for (const margin of [0, 1, 4, 10]) {
        const svg = qrToSvg(m, { margin });
        const parsed = parseSvg(svg, margin);
        expect(parsed.size).toBe(m.size);
        expect(Array.from(parsed.modules)).toEqual(Array.from(m.modules));
        expect(parsed.total).toBe(m.size + 2 * margin);
      }
    }
  });

  it("has the documented shape: one path, merged runs, crisp edges, no external references", () => {
    const m = encodeQr("shape", { ecc: "M" });
    const svg = qrToSvg(m);
    expect(
      svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '),
    ).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg.match(/<path /g)?.length).toBe(1);
    expect(svg).toContain(`viewBox="0 0 ${m.size + 8} ${m.size + 8}"`); // default margin 4
    expect(svg).toContain('fill="#fff"');
    expect(svg).toContain('<path fill="#000"');
    expect(svg).not.toMatch(
      /<(script|style|image|use|foreignObject|a)\b|href|url\(|on\w+=/i,
    );
    // merged horizontal runs: exactly one subpath per run of dark modules
    expect(svg.match(/M\d+ \d+h/g)?.length).toBe(darkRuns(m));
    expect(svg.length).toBeLessThan(m.size * m.size * 12); // far smaller than a rect per module
  });

  it("applies colours and sizePx, and drops the background for transparent light", () => {
    const m = encodeQr("colours");
    const svg = qrToSvg(m, {
      dark: "#112233",
      light: "rgb(255, 250, 240)",
      sizePx: 256,
    });
    expect(svg).toContain('width="256" height="256"');
    expect(svg).toContain('fill="#112233"');
    expect(svg).toContain('fill="rgb(255, 250, 240)"');
    expect(/^<svg[^>]*\swidth=/.test(qrToSvg(m))).toBe(false); // scales with its container
    const transparent = qrToSvg(m, { light: "transparent" });
    expect(transparent).not.toContain("<rect");
    expect(qrToSvg(m, { light: "none" })).not.toContain("<rect");
    for (const colour of [
      "red",
      "#abc",
      "#abcd",
      "#aabbcc",
      "#aabbccdd",
      "hsl(120deg 40% 50%)",
    ]) {
      expect(() => qrToSvg(m, { dark: colour })).not.toThrow();
    }
  });

  it("rejects colours that could break out of the attribute, and bad numbers", () => {
    const m = encodeQr("inject");
    for (const colour of [
      '"/><script>alert(1)</script>',
      'red" onload="x',
      "url(#a)",
      "javascript:alert(1)",
      "#12",
      "#12345",
      "rgb(0,0,0); background:red",
      "rgb(url(x))",
      "",
      "a".repeat(40),
    ]) {
      expect(
        () => qrToSvg(m, { dark: colour }),
        JSON.stringify(colour),
      ).toThrow(QrError);
      expect(
        () => qrToSvg(m, { light: colour }),
        JSON.stringify(colour),
      ).toThrow(QrError);
    }
    // surrounding whitespace is trimmed, never passed through
    expect(qrToSvg(m, { dark: "  red\n" })).toContain('<path fill="red"');
    for (const margin of [-1, 1.5, 65, Number.NaN]) {
      expect(() => qrToSvg(m, { margin })).toThrow(QrError);
    }
    for (const sizePx of [0, -5, 2.5, 20000, Number.NaN]) {
      expect(() => qrToSvg(m, { sizePx })).toThrow(QrError);
    }
  });

  it("rejects things that are not a QR matrix", () => {
    const m = encodeQr("x");
    const bogus = [
      undefined,
      null,
      {},
      { size: 21, modules: new Uint8Array(3) },
      { size: 21, modules: new Uint16Array(21 * 21) }, // wrong element width
      { size: 21, modules: [1, 0, 1] }, // not a typed array
      { ...m, size: 0 },
      { ...m, size: 5000, modules: new Uint8Array(0) },
    ];
    for (const value of bogus) {
      expect(() => qrToSvg(value as unknown as QrMatrix)).toThrow(QrError);
    }
  });
});

describe("qrToDataUrl", () => {
  it("returns a percent-encoded SVG data URL that decodes back to the SVG", () => {
    const m = encodeQr("data url", { ecc: "Q" });
    const url = qrToDataUrl(m, { dark: "#102030", margin: 2 });
    expect(url.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    const body = url.slice(url.indexOf(",") + 1);
    expect(body).not.toMatch(/[\s'"()<>*!#]/);
    expect(decodeURIComponent(body)).toBe(
      qrToSvg(m, { dark: "#102030", margin: 2 }),
    );
  });

  it("propagates option errors", () => {
    expect(() => qrToDataUrl(encodeQr("x"), { dark: "url(x)" })).toThrow(
      QrError,
    );
  });
});

describe("qrToCanvas", () => {
  it("sizes the canvas and paints background first, then merged dark runs", () => {
    const m = encodeQr("canvas test", { ecc: "M" });
    const canvas = fakeCanvas();
    const px = qrToCanvas(canvas, m, {
      scale: 3,
      margin: 5,
      dark: "#123456",
      light: "#fedcba",
    });
    const expected = (m.size + 10) * 3;
    expect(px).toBe(expected);
    expect(canvas.width).toBe(expected);
    expect(canvas.height).toBe(expected);
    expect(canvas.smoothing).toBe(false);
    expect(canvas.rects[0]).toEqual({
      fill: "#fedcba",
      x: 0,
      y: 0,
      w: expected,
      h: expected,
    });
    const dark = canvas.rects.slice(1);
    expect(dark.length).toBe(darkRuns(m));
    expect(dark.every((r) => r.fill === "#123456" && r.h === 3)).toBe(true);

    // rebuild the module grid from the rectangles
    const rebuilt = new Uint8Array(m.size * m.size);
    for (const r of dark) {
      expect(r.x % 3).toBe(0);
      expect(r.y % 3).toBe(0);
      expect(r.w % 3).toBe(0);
      for (let i = 0; i < r.w / 3; i++)
        rebuilt[(r.y / 3 - 5) * m.size + (r.x / 3 - 5) + i] = 1;
    }
    expect(Array.from(rebuilt)).toEqual(Array.from(m.modules));
  });

  it("uses scale 4 and margin 4 by default and skips the background when transparent", () => {
    const m = encodeQr("defaults");
    const canvas = fakeCanvas();
    expect(qrToCanvas(canvas, m)).toBe((m.size + 8) * 4);
    expect(canvas.rects[0]?.fill).toBe("#fff");
    const clear = fakeCanvas();
    qrToCanvas(clear, m, { light: "transparent" });
    expect(clear.rects.length).toBe(darkRuns(m));
    expect(clear.rects.every((r) => r.fill === "#000")).toBe(true);
  });

  it("reports unsupported environments and invalid options with typed errors", () => {
    const m = encodeQr("errors");
    const run = (fn: () => unknown): QrError => {
      try {
        fn();
      } catch (e) {
        return e as QrError;
      }
      throw new Error("expected a throw");
    };
    expect(run(() => qrToCanvas(fakeCanvas(false), m)).code).toBe(
      "unsupported",
    );
    expect(
      run(() => qrToCanvas(undefined as unknown as QrCanvasLike, m)).code,
    ).toBe("unsupported");
    expect(run(() => qrToCanvas({} as unknown as QrCanvasLike, m)).code).toBe(
      "unsupported",
    );
    expect(run(() => qrToCanvas(fakeCanvas(), m, { scale: 0 })).code).toBe(
      "bad-options",
    );
    expect(run(() => qrToCanvas(fakeCanvas(), m, { scale: 65 })).code).toBe(
      "bad-options",
    );
    expect(run(() => qrToCanvas(fakeCanvas(), m, { margin: -1 })).code).toBe(
      "bad-options",
    );
    expect(
      run(() => qrToCanvas(fakeCanvas(), m, { dark: "url(x)" })).code,
    ).toBe("bad-options");
    // 40-H is 177 modules: (177 + 128) * 64 = 19520 px exceeds the 16384 px limit
    const big = encodeQr("a", { minVersion: 40 });
    expect(
      run(() => qrToCanvas(fakeCanvas(), big, { scale: 64, margin: 64 })).code,
    ).toBe("bad-options");
    const untouched = fakeCanvas();
    expect(
      run(() => qrToCanvas(untouched, big, { scale: 64, margin: 64 })).code,
    ).toBe("bad-options");
    expect(untouched.width).toBe(0); // validated before the canvas is resized
  });

  it("accepts real canvas types at compile time", () => {
    // Never executed; the point is that this type-checks without casts.
    const typecheck = (
      c: HTMLCanvasElement,
      o: OffscreenCanvas,
      m: QrMatrix,
    ): void => {
      qrToCanvas(c, m);
      qrToCanvas(o, m, { scale: 2 });
    };
    expect(typeof typecheck).toBe("function");
  });
});

// --- A10: SSR safety ------------------------------------------------------------------------

describe("SSR safety", () => {
  it("does not reference browser-only globals in any module of the encoder", () => {
    for (const file of ["qr.ts", "qr-tables.ts", "qr-render.ts"]) {
      const source = readFileSync(
        resolve(process.cwd(), "src/studio/p2p", file),
        "utf8",
      );
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect(code, file).not.toMatch(
        /\b(window|document|navigator|indexedDB|AudioContext)\b/,
      );
      expect(code, file).not.toMatch(
        /\b(TextEncoder|TextDecoder|btoa|atob|innerHTML)\b/,
      );
    }
  });
});

// --- B: decoder round trips (jsqr is a local dev tool, not a dependency) ---------------------

type JsQr = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
) => { data: string } | null;

async function loadJsQr(): Promise<JsQr | null> {
  try {
    // Variable specifier: neither tsc nor vite need the package to exist to build this file.
    const specifier = "jsqr";
    let mod: unknown = await import(/* @vite-ignore */ specifier);
    for (let depth = 0; depth < 3 && typeof mod !== "function"; depth++) {
      mod = (mod as { default?: unknown } | null)?.default;
    }
    return typeof mod === "function" ? (mod as JsQr) : null;
  } catch {
    return null;
  }
}

const jsQR = await loadJsQr();

function rasterize(
  isDark: (x: number, y: number) => boolean,
  size: number,
  scale: number,
  margin = 4,
): { rgba: Uint8ClampedArray; width: number } {
  const width = (size + 2 * margin) * scale;
  const rgba = new Uint8ClampedArray(width * width * 4).fill(255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isDark(x, y)) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const o =
            (((y + margin) * scale + dy) * width + (x + margin) * scale + dx) *
            4;
          rgba[o] = rgba[o + 1] = rgba[o + 2] = 0;
        }
      }
    }
  }
  return { rgba, width };
}

/**
 * Decode `m` with jsQR and compare with `text`.
 * jsQR 1.4.0 ships a wrong alignment pattern table for version 23 ([..., 74, ...] instead of
 * [..., 78, ...]) and cannot read a correct v23 symbol, so that single version is skipped here;
 * its alignment coordinates are covered by the formula test above.
 */
function expectDecodes(m: QrMatrix, text: string, scale = 4): void {
  if (!jsQR || m.version === 23) return;
  const { rgba, width } = rasterize((x, y) => m.get(x, y), m.size, scale);
  const result = jsQR(rgba, width, width);
  expect(result, `v${m.version}-${m.ecc} not decodable`).not.toBeNull();
  expect(result?.data, `v${m.version}-${m.ecc} content`).toBe(text);
}

const roundTrip = it.skipIf(jsQR === null);

describe("jsQR round trips", () => {
  roundTrip(
    "decodes tiny, 100 B, 500 B, 1200 B and 2900 B payloads at every ECC level",
    { timeout: 120_000 },
    () => {
      let seed = 1;
      for (const bytes of [1, 100, 500, 1200, 2900]) {
        for (const ecc of ECCS) {
          const text = byteModeText(bytes, seed++);
          if (bytes > qrCapacityBytes(40, ecc)) {
            expect(() => encodeQr(text, { ecc })).toThrow(QrCapacityError);
            continue;
          }
          expectDecodes(encodeQr(text, { ecc }), text);
        }
      }
    },
  );

  roundTrip(
    "decodes unicode text (UTF-8 byte mode)",
    { timeout: 60_000 },
    () => {
      const texts = [
        "Merhaba dünya! Çalışıyor mu? ğüşiöç ĞÜŞİÖÇ",
        "你好，世界 日本語のテキスト",
        "🎥🎙️ emoji 👨‍👩‍👧‍👦 stream",
        "Привет, мир — naïve café “quotes” € £",
      ];
      for (const text of texts) {
        for (const ecc of ECCS) expectDecodes(encodeQr(text, { ecc }), text);
      }
    },
  );

  roundTrip(
    "decodes numeric and alphanumeric payloads",
    { timeout: 60_000 },
    () => {
      const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
      for (const ecc of ECCS) {
        for (const length of [1, 2, 3, 4, 41, 500, 2000]) {
          const digits = Array.from({ length }, (_, i) =>
            String((i * 7 + 3) % 10),
          ).join("");
          const m = encodeQr(digits, { ecc });
          expect(m.mode).toBe("numeric");
          expectDecodes(m, digits);
        }
        for (const length of [1, 2, 3, 25, 400, 1500]) {
          const text = `A${Array.from({ length: length - 1 }, (_, i) => alphabet.charAt((i * 5 + 11) % 45)).join("")}`;
          const m = encodeQr(text, { ecc });
          expect(m.mode).toBe("alphanumeric");
          expectDecodes(m, text);
        }
      }
    },
  );

  roundTrip(
    "decodes capacity-filling payloads around the version boundaries 1/2, 6/7, 9/10, 26/27, 39/40",
    { timeout: 180_000 },
    () => {
      for (const v of [1, 2, 6, 7, 9, 10, 25, 26, 27, 39, 40]) {
        for (const ecc of ECCS) {
          const text = byteModeText(
            qrCapacityBytes(v, ecc),
            v * 10 + ECCS.indexOf(ecc),
          );
          const m = encodeQr(text, { ecc, minVersion: v, maxVersion: v });
          expect(m.version).toBe(v);
          expectDecodes(m, text);
        }
      }
    },
  );

  roundTrip(
    "decodes with every one of the eight data masks forced",
    { timeout: 120_000 },
    () => {
      for (const v of [1, 2, 7, 14, 40]) {
        for (const ecc of ECCS) {
          for (let mask = 0; mask < 8; mask++) {
            const text = `m${mask}`;
            const m = encodeQr(text, {
              ecc,
              mask,
              minVersion: v,
              maxVersion: v,
            });
            expect(m.mask).toBe(mask);
            expectDecodes(m, text);
          }
        }
      }
    },
  );

  roundTrip(
    "decodes what the SVG and canvas renderers draw",
    { timeout: 60_000 },
    () => {
      const text = `https://teknodoz.example/join#${byteModeText(400, 77)}`;
      const m = encodeQr(text, { ecc: "M" });

      const parsed = parseSvg(qrToSvg(m, { margin: 4 }), 4);
      const fromSvg = rasterize(
        (x, y) => parsed.modules[y * parsed.size + x] === 1,
        parsed.size,
        4,
      );
      expect(jsQR?.(fromSvg.rgba, fromSvg.width, fromSvg.width)?.data).toBe(
        text,
      );

      const canvas = fakeCanvas();
      const px = qrToCanvas(canvas, m, { scale: 4, margin: 4 });
      const rgba = new Uint8ClampedArray(px * px * 4).fill(255);
      for (const r of canvas.rects.slice(1)) {
        for (let y = r.y; y < r.y + r.h; y++) {
          for (let x = r.x; x < r.x + r.w; x++) {
            const o = (y * px + x) * 4;
            rgba[o] = rgba[o + 1] = rgba[o + 2] = 0;
          }
        }
      }
      expect(jsQR?.(rgba, px, px)?.data).toBe(text);
    },
  );
});
