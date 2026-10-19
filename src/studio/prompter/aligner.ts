// src/studio/prompter/aligner.ts
// Pure (DOM-free) speech-to-script aligner. Given the most recent spoken words it keeps a
// forward-moving pointer into the script that survives ASR mistakes, skipped words and
// improvisation.
//
// How it works (per `update`):
//  1. Take the last `maxContext` (default 6) spoken words and normalise them like the script.
//  2. Local-align (Smith-Waterman on words) that context against a window of the script:
//     `[pointer - (maxContext + 2), pointer + windowAhead]`. Exact matches score by word length,
//     near matches (Levenshtein <= 1 for words >= 5 chars) score 0.8, gaps and substitutions cost.
//  3. Every alignment is classified relative to the pointer (advance / small back-step / hold) and
//     accepted only with enough evidence for the distance it implies: a neighbouring word (up to 3
//     words ahead) needs one solid match; anything further needs three consecutive matching words.
//     Two matching words are NOT enough for a long jump: one misrecognised word plus its
//     predecessor can easily form a bigram that also occurs elsewhere in the window.
//  4. The accepted candidate that explains the most recent spoken word wins; ties prefer the
//     candidate closest to the expected next word, which is what disambiguates phrases that occur
//     twice in the script.
//  5. If nothing in the window matches but >= `relockRun` consecutive words match further ahead in
//     the script (e.g. a skipped paragraph) the pointer re-locks there (forward only).
//
// Unmatched words (improvisation) never move the pointer.

import { normalizeWord, type ScriptModel } from "./script";

export interface AlignResult {
  /** Index (ScriptWord.globalIndex) of the script word the speaker is at. */
  wordIndex: number;
  /** 0..1 how well the latest spoken words support `wordIndex`. 0 when nothing matched. */
  confidence: number;
  /** True when the latest spoken words were found in the script (pointer advanced or confirmed). */
  matched: boolean;
}

export interface ScriptAlignerOptions {
  /** BCP-47 language for normalisation. Default "tr-TR". */
  lang?: string | undefined;
  /** How many of the most recent spoken words are considered. Default 6, clamped to 2..12. */
  maxContext?: number | undefined;
  /** Forward search window in script words. Default 40, minimum 4. */
  windowAhead?: number | undefined;
  /** Largest backward correction (speaker repeats a few words). Default 3. */
  maxBackJump?: number | undefined;
  /** Consecutive matched words needed to re-lock outside the window. 0 disables. Default 4. */
  relockRun?: number | undefined;
  /** Fold diacritics when matching (ç/c, ı/i...). Default true. */
  foldDiacritics?: boolean | undefined;
}

/* ------------------------------------------------------------------ */
/* Word matching                                                       */
/* ------------------------------------------------------------------ */

/**
 * Levenshtein distance with an early exit: returns `max + 1` as soon as the distance is known to
 * exceed `max`. Operates on UTF-16 code units, which is fine for the short normalised words here.
 */
export function levenshtein(
  a: string,
  b: string,
  max = Number.POSITIVE_INFINITY,
): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      const v = Math.min(
        (prev[j] ?? 0) + 1,
        (cur[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[b.length] ?? max + 1;
}

const W_SOLID = 1.0;
const W_MID = 0.8;
const W_SHORT = 0.4;
const MISMATCH = 0.35;
const GAP = 0.45;
/** Minimum length (both words) for a one-edit fuzzy match. */
const FUZZY_MIN_LEN = 5;

/**
 * Evidence weight of aligning a spoken word with a script word (both already normalised).
 * 0 = no match. Short words are weak evidence (they occur everywhere).
 */
export function matchWeight(spoken: string, script: string): number {
  if (!spoken || !script) return 0;
  if (spoken === script) {
    const n = script.length;
    return n >= 4 ? W_SOLID : n === 3 ? W_MID : W_SHORT;
  }
  if (
    spoken.length >= FUZZY_MIN_LEN &&
    script.length >= FUZZY_MIN_LEN &&
    levenshtein(spoken, script, 1) <= 1
  ) {
    return W_MID;
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/* Aligner                                                             */
/* ------------------------------------------------------------------ */

interface Pair {
  /** index into the spoken context */
  ci: number;
  /** index into the matchable script words */
  si: number;
  w: number;
}

type Kind = "advance" | "back" | "hold";

interface Accepted {
  kind: Kind;
  /** pointer after applying this candidate */
  target: number;
  endCi: number;
  endSi: number;
  /** alignment score (selection tie-breaker) */
  score: number;
  /** evidence of the pairs that involve the last 4 spoken words */
  recentEvidence: number;
  far: boolean;
}

const MAX_RELOCK_OCCURRENCES = 64;

export class ScriptAligner {
  private readonly norms: string[] = [];
  private readonly globals: number[] = [];
  private readonly occurrences = new Map<string, number[]>();
  private readonly lang: string;
  private readonly fold: boolean;
  private readonly maxContext: number;
  private readonly windowAhead: number;
  private readonly maxBackJump: number;
  private readonly relockRun: number;
  /** Index (into matchable words) of the last matched word; -1 before anything matched. */
  private p = -1;

  /**
   * @param script a parsed `ScriptModel`, or raw script words (e.g. `text.split(/\s+/)`).
   *   Words that normalise to "" (pure punctuation) are skipped.
   */
  constructor(
    script: ScriptModel | readonly string[],
    options: ScriptAlignerOptions = {},
  ) {
    this.lang =
      options.lang ??
      (Array.isArray(script) ? "tr-TR" : (script as ScriptModel).lang);
    this.fold = options.foldDiacritics ?? true;
    this.maxContext = Math.min(
      12,
      Math.max(2, Math.floor(options.maxContext ?? 6)),
    );
    this.windowAhead = Math.max(4, Math.floor(options.windowAhead ?? 40));
    this.maxBackJump = Math.max(0, Math.floor(options.maxBackJump ?? 3));
    this.relockRun = Math.max(0, Math.floor(options.relockRun ?? 4));

    const add = (w: string, globalIndex: number): void => {
      const norm = normalizeWord(w, this.lang, this.fold);
      if (!norm) return;
      const idx = this.norms.length;
      this.norms.push(norm);
      this.globals.push(globalIndex);
      const list = this.occurrences.get(norm);
      if (list) list.push(idx);
      else this.occurrences.set(norm, [idx]);
    };
    if (Array.isArray(script)) {
      (script as readonly string[]).forEach((w, i) => add(w, i));
    } else {
      for (const word of (script as ScriptModel).words)
        add(word.w, word.globalIndex);
    }
  }

  /** Number of matchable (non-empty after normalisation) script words. */
  get size(): number {
    return this.norms.length;
  }

  /** Current pointer as a script word index (the first word before anything matched). */
  get wordIndex(): number {
    if (this.globals.length === 0) return 0;
    return this.globals[Math.max(0, this.p)] ?? 0;
  }

  /**
   * Re-anchor the pointer so that `wordIndex` is the NEXT word expected (e.g. after the user
   * scrolled or clicked in the script).
   */
  reset(wordIndex = 0): void {
    let lo = 0;
    let hi = this.globals.length;
    const target = Number.isFinite(wordIndex) ? wordIndex : 0;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((this.globals[mid] ?? 0) < target) lo = mid + 1;
      else hi = mid;
    }
    this.p = lo - 1;
  }

  /**
   * Feed the most recent spoken words (oldest first). It is the sliding tail of the transcript, not
   * a delta: calling it again with overlapping words is safe and idempotent. Only the last
   * `maxContext` words are used.
   */
  update(transcriptWords: readonly string[]): AlignResult {
    const ctx = this.prepareContext(transcriptWords);
    const noMatch = (): AlignResult => ({
      wordIndex: this.wordIndex,
      confidence: 0,
      matched: false,
    });
    if (ctx.length === 0 || this.norms.length === 0) return noMatch();

    const k = ctx.length;
    let best = this.searchWindow(ctx);
    let matched =
      best !== null && (best.kind !== "hold" || best.endCi === k - 1);
    if (!matched && this.relockRun > 0) {
      const relock = this.relock(ctx);
      if (relock) {
        best = relock;
        matched = true;
      }
    }
    if (!best || !matched) return noMatch();

    this.p = best.target;
    const denom = Math.max(2, Math.min(k, 4));
    let confidence = Math.min(1, best.recentEvidence / denom);
    if (best.far) confidence *= 0.8;
    return { wordIndex: this.wordIndex, confidence, matched: true };
  }

  /* --------------------------- internals ---------------------------- */

  private prepareContext(words: readonly string[]): string[] {
    const out: string[] = [];
    // Bound the work for pathological input before splitting/normalising.
    const tail =
      words.length > this.maxContext * 4
        ? words.slice(-this.maxContext * 4)
        : words;
    for (const raw of tail) {
      if (typeof raw !== "string") continue;
      for (const token of raw.split(/\s+/)) {
        const norm = normalizeWord(token, this.lang, this.fold);
        if (norm) out.push(norm);
      }
    }
    return out.length > this.maxContext ? out.slice(-this.maxContext) : out;
  }

  private searchWindow(ctx: string[]): Accepted | null {
    const p = this.p;
    const k = ctx.length;
    const m = this.norms.length;
    const lo = Math.max(0, p - (this.maxContext + 2));
    const hi = Math.min(m - 1, p + this.windowAhead);
    if (hi < lo) return null;
    const w = hi - lo + 1;
    const stride = w + 1;

    // Match weights and the Smith-Waterman matrix.
    const mw = new Float64Array(k * w);
    const H = new Float64Array((k + 1) * stride);
    const D = new Uint8Array((k + 1) * stride); // 0 stop, 1 diag, 2 up (skip spoken), 3 left (skip script)
    for (let i = 1; i <= k; i++) {
      const spoken = ctx[i - 1] ?? "";
      for (let j = 1; j <= w; j++) {
        const weight = matchWeight(spoken, this.norms[lo + j - 1] ?? "");
        mw[(i - 1) * w + (j - 1)] = weight;
        const diag =
          (H[(i - 1) * stride + (j - 1)] ?? 0) +
          (weight > 0 ? weight : -MISMATCH);
        const up = (H[(i - 1) * stride + j] ?? 0) - GAP;
        const left = (H[i * stride + (j - 1)] ?? 0) - GAP;
        let best = 0;
        let dir = 0;
        if (diag > best) {
          best = diag;
          dir = 1;
        }
        if (up > best) {
          best = up;
          dir = 2;
        }
        if (left > best) {
          best = left;
          dir = 3;
        }
        H[i * stride + j] = best;
        D[i * stride + j] = dir;
      }
    }

    let winner: Accepted | null = null;
    for (let i = 1; i <= k; i++) {
      for (let j = 1; j <= w; j++) {
        if ((mw[(i - 1) * w + (j - 1)] ?? 0) <= 0) continue;
        if (D[i * stride + j] !== 1) continue;
        const pairs = this.traceback(i, j, lo, w, stride, mw, D);
        const cand = this.classify(pairs, k, H[i * stride + j] ?? 0);
        if (cand && this.better(cand, winner)) winner = cand;
      }
    }
    return winner;
  }

  private traceback(
    iEnd: number,
    jEnd: number,
    lo: number,
    w: number,
    stride: number,
    mw: Float64Array,
    D: Uint8Array,
  ): Pair[] {
    const pairs: Pair[] = [];
    let i = iEnd;
    let j = jEnd;
    while (i > 0 && j > 0) {
      const dir = D[i * stride + j] ?? 0;
      if (dir === 0) break;
      if (dir === 1) {
        const weight = mw[(i - 1) * w + (j - 1)] ?? 0;
        if (weight > 0) pairs.push({ ci: i - 1, si: lo + j - 1, w: weight });
        i--;
        j--;
      } else if (dir === 2) {
        i--;
      } else {
        j--;
      }
    }
    return pairs.reverse();
  }

  /** Decide whether an alignment is trustworthy for the distance it implies. */
  private classify(pairs: Pair[], k: number, score: number): Accepted | null {
    const last = pairs[pairs.length - 1];
    if (!last) return null;
    const p = this.p;
    const recentEvidence = pairs.reduce(
      (s, x) => (x.ci >= k - 4 ? s + x.w : s),
      0,
    );
    const base = {
      endCi: last.ci,
      endSi: last.si,
      score,
      recentEvidence,
      far: false,
    };

    const firstNew = pairs.findIndex((x) => x.si > p);
    if (firstNew < 0) {
      // Nothing beyond the pointer: confirm in place, or accept a small repeat-step backwards.
      if (last.si === p) return { ...base, kind: "hold", target: p };
      const back = p - last.si;
      const evidence = pairs.reduce((s, x) => s + x.w, 0);
      if (
        last.ci === k - 1 &&
        back <= this.maxBackJump &&
        pairs.length >= 2 &&
        evidence >= 1.5
      ) {
        return { ...base, kind: "back", target: last.si };
      }
      return null;
    }

    const fresh = pairs.slice(firstNew);
    const first = fresh[0];
    if (!first) return null;
    const skipped = first.si - (p + 1);
    const evidenceNew = fresh.reduce((s, x) => s + x.w, 0);
    const anchor = firstNew > 0 ? pairs[firstNew - 1] : undefined;
    const contiguous =
      skipped === 0 &&
      anchor !== undefined &&
      anchor.si === p &&
      anchor.ci === first.ci - 1;

    let run = 1;
    let longest = 1;
    for (let n = 1; n < fresh.length; n++) {
      const a = fresh[n - 1];
      const b = fresh[n];
      if (a && b && b.ci === a.ci + 1 && b.si === a.si + 1) run++;
      else run = 1;
      if (run > longest) longest = run;
    }

    const lastNew = fresh[fresh.length - 1] ?? first;
    let ok = false;
    let far = false;
    if (contiguous && evidenceNew >= 0.4) ok = true;
    else if (skipped <= 3 && evidenceNew >= 1.0) ok = true;
    else if (longest >= 3 && evidenceNew >= 2.4) {
      ok = true;
      far = skipped > 12;
    }
    if (!ok) return null;
    return { ...base, kind: "advance", target: lastNew.si, far };
  }

  /** Prefer the candidate that explains the newest spoken word, then closeness, then score. */
  private better(a: Accepted, b: Accepted | null): boolean {
    if (!b) return true;
    if (a.endCi !== b.endCi) return a.endCi > b.endCi;
    const expected = this.p + 1;
    const sa =
      a.score -
      0.02 * Math.abs(a.endSi - expected) -
      (a.kind === "back" ? 0.3 : 0);
    const sb =
      b.score -
      0.02 * Math.abs(b.endSi - expected) -
      (b.kind === "back" ? 0.3 : 0);
    if (sa !== sb) return sa > sb;
    return a.endSi > b.endSi;
  }

  /**
   * Look for a run of consecutive matching words beyond the search window (a skipped
   * paragraph). Forward only, uses the exact-word index so it stays cheap for long scripts.
   */
  private relock(ctx: string[]): Accepted | null {
    const k = ctx.length;
    const need = this.relockRun;
    if (k < need) return null;
    const hi = Math.min(this.norms.length - 1, this.p + this.windowAhead);
    let best: { ci: number; si: number; run: number; evidence: number } | null =
      null;

    for (let ci = need - 1; ci < k; ci++) {
      const word = ctx[ci] ?? "";
      const positions = this.occurrences.get(word);
      if (!positions || positions.length > MAX_RELOCK_OCCURRENCES) continue;
      for (const si of positions) {
        if (si <= hi) continue;
        let run = 1;
        let evidence = matchWeight(word, this.norms[si] ?? "");
        while (ci - run >= 0 && si - run >= 0) {
          const wgt = matchWeight(
            ctx[ci - run] ?? "",
            this.norms[si - run] ?? "",
          );
          if (wgt <= 0) break;
          evidence += wgt;
          run++;
        }
        if (run < need || evidence < 2.4) continue;
        if (
          !best ||
          run > best.run ||
          (run === best.run && ci > best.ci) ||
          (run === best.run && ci === best.ci && si < best.si)
        ) {
          best = { ci, si, run, evidence };
        }
      }
    }
    if (!best) return null;

    // Extend over words spoken after the run that keep matching consecutively.
    let endCi = best.ci;
    let endSi = best.si;
    while (endCi + 1 < k && endSi + 1 < this.norms.length) {
      if (matchWeight(ctx[endCi + 1] ?? "", this.norms[endSi + 1] ?? "") <= 0)
        break;
      endCi++;
      endSi++;
    }
    return {
      kind: "advance",
      target: endSi,
      endCi,
      endSi,
      score: best.evidence,
      recentEvidence: best.evidence,
      far: true,
    };
  }
}
