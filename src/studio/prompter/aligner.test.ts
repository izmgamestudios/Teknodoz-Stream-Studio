import { describe, expect, it } from "vitest";
import {
  levenshtein,
  matchWeight,
  ScriptAligner,
  type AlignResult,
} from "./aligner";
import { parseScript } from "./script";

const TR = `Herkese merhaba, podcastimize hoş geldiniz. Bugün oyun geliştirmenin zorluklarını konuşacağız.
İlk olarak küçük bir ekiple nasıl çalıştığımızı anlatacağım. Daha sonra karşılaştığımız hataları ve çözümleri paylaşacağım.
Sonunda sizlere birkaç tavsiye vereceğim. Şimdi hemen başlayalım.`;

const EN = `Hello everyone and welcome to the show. Today we are going to talk about building games with a tiny team.
First I will explain how we organise our work every single week. Then I will share the mistakes we made and how we fixed them.
Finally I will give you three simple pieces of advice. Let us get started.`;

/** What a recogniser returns: lower-case, no punctuation. */
function asr(text: string, lang = "tr"): string[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.toLocaleLowerCase(lang).replace(/[.,!?]/g, ""));
}

/** Simulates the follower: after every recognised word the growing transcript is handed over. */
function readAloud(aligner: ScriptAligner, spoken: string[]): AlignResult[] {
  const results: AlignResult[] = [];
  for (let i = 1; i <= spoken.length; i++)
    results.push(aligner.update(spoken.slice(0, i)));
  return results;
}

function indexOfWord(text: string, word: string, occurrence = 1): number {
  const all = text.split(/\s+/).filter(Boolean);
  let seen = 0;
  for (let i = 0; i < all.length; i++) {
    if (all[i]?.toLocaleLowerCase("tr").replace(/[.,!?]/g, "") === word) {
      seen++;
      if (seen === occurrence) return i;
    }
  }
  throw new Error(`word not found: ${word}`);
}

describe("levenshtein / matchWeight", () => {
  it("computes edit distance", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
    expect(levenshtein("same", "same")).toBe(0);
    expect(levenshtein("çok", "cok")).toBe(1);
  });

  it("exits early above the bound", () => {
    expect(levenshtein("abcdefgh", "zzzzzzzz", 1)).toBe(2);
    expect(levenshtein("abcdef", "abcdeg", 1)).toBe(1);
    expect(levenshtein("a", "abcdef", 2)).toBe(3);
  });

  it("weights exact matches by length and allows one edit only for words of 5+ chars", () => {
    expect(matchWeight("merhaba", "merhaba")).toBe(1);
    expect(matchWeight("bir", "bir")).toBeGreaterThan(0.5);
    expect(matchWeight("ve", "ve")).toBeLessThan(0.5);
    expect(matchWeight("geldiniz", "geldinis")).toBeGreaterThan(0.5);
    expect(matchWeight("geldiniz", "geldiz")).toBe(0);
    expect(matchWeight("kitap", "kitab")).toBeGreaterThan(0);
    expect(matchWeight("evet", "evel")).toBe(0);
    expect(matchWeight("", "x")).toBe(0);
  });
});

describe("ScriptAligner: exact reading", () => {
  it("follows a Turkish script word by word", () => {
    const model = parseScript(TR, { lang: "tr-TR" });
    const aligner = new ScriptAligner(model, { lang: "tr-TR" });
    const spoken = asr(TR);
    const results = readAloud(aligner, spoken);
    results.forEach((r, i) => {
      expect(r.wordIndex).toBe(i);
      expect(r.matched).toBe(true);
    });
    expect(results.at(-1)?.wordIndex).toBe(model.wordCount - 1);
    expect(results[10]?.confidence).toBeGreaterThan(0.8);
  });

  it("follows an English script word by word", () => {
    const model = parseScript(EN, { lang: "en-US" });
    const aligner = new ScriptAligner(model, { lang: "en-US" });
    const results = readAloud(aligner, asr(EN, "en"));
    results.forEach((r, i) => {
      expect(r.wordIndex).toBe(i);
      expect(r.matched).toBe(true);
    });
  });

  it("is idempotent: feeding the same words again does not move the pointer", () => {
    const aligner = new ScriptAligner(parseScript(TR), { lang: "tr-TR" });
    const spoken = asr(TR).slice(0, 9);
    const first = aligner.update(spoken);
    for (let i = 0; i < 5; i++) {
      const again = aligner.update(spoken);
      expect(again.wordIndex).toBe(first.wordIndex);
      expect(again.matched).toBe(true);
    }
  });

  it("only looks at the sliding tail of the transcript", () => {
    const aligner = new ScriptAligner(parseScript(TR), { lang: "tr-TR" });
    const spoken = asr(TR);
    const prefix = Array.from({ length: 200 }, () => "ehh");
    const r = aligner.update([...prefix, ...spoken.slice(0, 6)]);
    expect(r.wordIndex).toBe(5);
  });

  it("accepts a plain array of words and splits multi-word strings", () => {
    const aligner = new ScriptAligner(TR.split(/\s+/), { lang: "tr-TR" });
    const r = aligner.update(["herkese merhaba", "podcastimize"]);
    expect(r.wordIndex).toBe(2);
    expect(r.matched).toBe(true);
  });

  it("ignores case, punctuation and Turkish diacritic loss", () => {
    const aligner = new ScriptAligner(parseScript(TR), { lang: "tr-TR" });
    const r = aligner.update([
      "HERKESE",
      "Merhaba!",
      "podcastimize",
      "hos",
      "geldiniz",
    ]);
    expect(r.wordIndex).toBe(4);
    expect(r.matched).toBe(true);
  });

  it("matches Turkish capital I/İ", () => {
    const aligner = new ScriptAligner(
      parseScript("Işık İstanbul Irmak İzmir"),
      { lang: "tr-TR" },
    );
    const r = aligner.update(["ışık", "istanbul", "ırmak", "izmir"]);
    expect(r.wordIndex).toBe(3);
  });
});

describe("ScriptAligner: ASR mistakes", () => {
  it("tolerates one-character recognition errors in long words (Turkish)", () => {
    const aligner = new ScriptAligner(parseScript(TR), { lang: "tr-TR" });
    const spoken = asr(TR);
    spoken[3] = "hoş";
    spoken[4] = "geldiniz".replace("z", "s"); // geldinis
    spoken[7] = "geliştirmenin".replace("ş", "s"); // folded diacritic
    spoken[8] = "zorluklarını".replace("ı", "i");
    const results = readAloud(aligner, spoken);
    expect(results.at(-1)?.wordIndex).toBe(spoken.length - 1);
    results.forEach((r, i) => expect(r.wordIndex).toBeLessThanOrEqual(i));
    // never more than 2 words behind the truth
    results.forEach((r, i) => expect(i - r.wordIndex).toBeLessThanOrEqual(2));
  });

  it("recovers after completely mis-recognised words", () => {
    const aligner = new ScriptAligner(parseScript(TR), { lang: "tr-TR" });
    const spoken = asr(TR);
    spoken[2] = "podcast evimize"; // two wrong tokens instead of one
    spoken[6] = "oyuncu"; // unrelated word for "oyun"
    spoken[11] = "kucak";
    const results = readAloud(aligner, spoken);
    expect(results.at(-1)?.wordIndex).toBe(parseScript(TR).wordCount - 1);
  });

  it("tolerates English recognition errors", () => {
    const aligner = new ScriptAligner(parseScript(EN, { lang: "en-US" }), {
      lang: "en-US",
    });
    const spoken = asr(EN, "en");
    spoken[1] = "everybody"; // wrong word for "everyone"
    spoken[6] = "shoe"; // wrong word for "show"
    spoken[12] = "buildings"; // near miss for "building"
    const results = readAloud(aligner, spoken);
    expect(results.at(-1)?.wordIndex).toBe(spoken.length - 1);
    for (let i = 0; i < results.length; i++) {
      expect(results[i]?.wordIndex).toBeLessThanOrEqual(i);
    }
  });
});

describe("ScriptAligner: skipped words and sentences", () => {
  it("jumps over a few skipped words", () => {
    const aligner = new ScriptAligner(parseScript(TR), { lang: "tr-TR" });
    const spoken = asr(TR);
    // skip "hoş geldiniz"
    const said = [...spoken.slice(0, 3), ...spoken.slice(5)];
    const results = readAloud(aligner, said);
    expect(results.at(-1)?.wordIndex).toBe(spoken.length - 1);
    // after the word following the skip the pointer is past the skipped words
    expect(results[3]?.wordIndex).toBe(5);
  });

  it("re-syncs after a whole skipped sentence (Turkish)", () => {
    const model = parseScript(TR);
    const aligner = new ScriptAligner(model, { lang: "tr-TR" });
    const spoken = asr(TR);
    const s2Start = indexOfWord(TR, "bugün");
    const s3Start = indexOfWord(TR, "ilk");
    const said = [...spoken.slice(0, s2Start), ...spoken.slice(s3Start)];
    const results = readAloud(aligner, said);
    const before = results[s2Start - 1];
    expect(before?.wordIndex).toBe(s2Start - 1);
    // first words of the new sentence: hold or re-sync, but never wander
    let previous = before?.wordIndex ?? 0;
    for (let i = s2Start; i < results.length; i++) {
      const r = results[i];
      expect(r?.wordIndex).toBeGreaterThanOrEqual(previous);
      previous = r?.wordIndex ?? previous;
    }
    // 3 words into the new sentence the pointer is there
    expect(results[s2Start + 2]?.wordIndex).toBe(s3Start + 2);
    expect(results.at(-1)?.wordIndex).toBe(spoken.length - 1);
  });

  it("re-syncs after a whole skipped sentence (English)", () => {
    const aligner = new ScriptAligner(parseScript(EN, { lang: "en-US" }), {
      lang: "en-US",
    });
    const spoken = asr(EN, "en");
    const s2Start = indexOfWord(EN, "today");
    const s3Start = indexOfWord(EN, "first");
    const said = [...spoken.slice(0, s2Start), ...spoken.slice(s3Start)];
    const results = readAloud(aligner, said);
    expect(results[s2Start + 2]?.wordIndex).toBe(s3Start + 2);
    expect(results.at(-1)?.wordIndex).toBe(spoken.length - 1);
  });

  it("re-locks after skipping a whole paragraph beyond the search window", () => {
    const filler = Array.from({ length: 120 }, (_, i) => `kelime${i}`).join(
      " ",
    );
    const text = `Başlangıç cümlesi burada duruyor. ${filler} Son bölüme geldik sevgili dinleyiciler teşekkürler.`;
    const model = parseScript(text);
    const aligner = new ScriptAligner(model, { lang: "tr-TR" });
    readAloud(aligner, asr(text).slice(0, 4));
    const tail = asr("Son bölüme geldik sevgili dinleyiciler teşekkürler");
    let last = aligner.wordIndex;
    for (let i = 1; i <= tail.length; i++) {
      last = aligner.update(tail.slice(0, i)).wordIndex;
    }
    expect(last).toBe(model.wordCount - 1);
  });

  it("can start in the middle of the script", () => {
    const model = parseScript(TR);
    const aligner = new ScriptAligner(model, { lang: "tr-TR" });
    const start = indexOfWord(TR, "daha");
    const spoken = asr(TR).slice(start);
    const results = readAloud(aligner, spoken);
    expect(results.at(-1)?.wordIndex).toBe(model.wordCount - 1);
  });
});

describe("ScriptAligner: improvisation", () => {
  it("holds the pointer while the speaker improvises (Turkish)", () => {
    const aligner = new ScriptAligner(parseScript(TR), { lang: "tr-TR" });
    const spoken = asr(TR);
    const sentenceEnd = indexOfWord(TR, "geldiniz");
    readAloud(aligner, spoken.slice(0, sentenceEnd + 1));
    expect(aligner.wordIndex).toBe(sentenceEnd);

    const improv = asr(
      "yani şey aslında bence böyle düşünüyorum ya işte neyse tamam peki",
    );
    const said = spoken.slice(0, sentenceEnd + 1);
    for (const w of improv) {
      said.push(w);
      const r = aligner.update(said);
      expect(r.wordIndex).toBe(sentenceEnd);
      expect(r.matched).toBe(false);
      expect(r.confidence).toBe(0);
    }
  });

  it("continues correctly when the speaker returns to the script", () => {
    const model = parseScript(TR);
    const aligner = new ScriptAligner(model, { lang: "tr-TR" });
    const spoken = asr(TR);
    const cut = indexOfWord(TR, "geldiniz") + 1;
    const improv = asr("şey yani aslında bunu da söylemek istiyorum bakın");
    const said = [...spoken.slice(0, cut), ...improv, ...spoken.slice(cut)];
    const results = readAloud(aligner, said);
    expect(results.at(-1)?.wordIndex).toBe(model.wordCount - 1);
    // while improvising the pointer never moved
    for (let i = cut; i < cut + improv.length; i++) {
      expect(results[i]?.wordIndex).toBe(cut - 1);
    }
  });

  it("holds the pointer while the speaker improvises (English)", () => {
    const aligner = new ScriptAligner(parseScript(EN, { lang: "en-US" }), {
      lang: "en-US",
    });
    const spoken = asr(EN, "en");
    const cut = indexOfWord(EN, "show") + 1;
    readAloud(aligner, spoken.slice(0, cut));
    const said = spoken.slice(0, cut);
    for (const w of asr(
      "so anyway you know what I mean right okay well",
      "en",
    )) {
      said.push(w);
      expect(aligner.update(said).wordIndex).toBe(cut - 1);
    }
  });

  it("does not move on unrelated speech or noise", () => {
    const aligner = new ScriptAligner(parseScript(TR), { lang: "tr-TR" });
    expect(
      aligner.update(asr("tamamen alakasız bir konuşma yapıyorum şu anda"))
        .matched,
    ).toBe(false);
    expect(aligner.wordIndex).toBe(0);
    expect(aligner.update(["hmm", "eee", "ıı"]).matched).toBe(false);
  });

  it("does not jump on stop-words that occur everywhere", () => {
    const text =
      "bu ve şu ve o ve bu ve şu ve o ve bu ve şu ve o ve sonunda ayrıldık";
    const model = parseScript(text);
    const aligner = new ScriptAligner(model, { lang: "tr-TR" });
    for (let i = 0; i < 6; i++) aligner.update(["ve", "ve", "ve"]);
    expect(aligner.wordIndex).toBeLessThanOrEqual(2);
  });
});

describe("ScriptAligner: repeated phrases", () => {
  const REPEAT = `Birinci bölümde bu çok önemli bir konu hakkında konuşacağız. Araya girmeden örnekleri inceleyip devam ediyoruz.
İkinci bölümde bu çok önemli bir konu hakkında tekrar konuşacağız. Sonra her şeyi özetleyeceğiz.`;

  it("resolves a phrase that appears twice by position (Turkish)", () => {
    const model = parseScript(REPEAT);
    const aligner = new ScriptAligner(model, { lang: "tr-TR" });
    const spoken = asr(REPEAT);
    const first = indexOfWord(REPEAT, "konu", 1);
    const second = indexOfWord(REPEAT, "konu", 2);
    const results = readAloud(aligner, spoken);
    // reading the first occurrence stays on the first occurrence
    expect(results[first]?.wordIndex).toBe(first);
    for (let i = 0; i <= first; i++) expect(results[i]?.wordIndex).toBe(i);
    // ... and the second one is followed later
    expect(results[second]?.wordIndex).toBe(second);
    expect(results.at(-1)?.wordIndex).toBe(model.wordCount - 1);
  });

  it("uses the words before the phrase to pick the right occurrence when starting fresh", () => {
    const model = parseScript(REPEAT);
    const aligner = new ScriptAligner(model, { lang: "tr-TR" });
    const second = indexOfWord(REPEAT, "konu", 2);
    const said = asr("ikinci bölümde bu çok önemli bir konu");
    const results = readAloud(aligner, said);
    expect(results.at(-1)?.wordIndex).toBe(second);
  });

  it("prefers the nearest occurrence when the phrase alone is ambiguous", () => {
    const model = parseScript(REPEAT);
    const aligner = new ScriptAligner(model, { lang: "tr-TR" });
    const first = indexOfWord(REPEAT, "konu", 1);
    const r = aligner.update(asr("bu çok önemli bir konu"));
    expect(r.wordIndex).toBe(first);
  });

  it("handles repeated phrases in English", () => {
    const text =
      "We will talk about the plan today. Remember the plan matters because the plan decides everything. At the end we review the plan again.";
    const model = parseScript(text, { lang: "en-US" });
    const aligner = new ScriptAligner(model, { lang: "en-US" });
    const results = readAloud(aligner, asr(text, "en"));
    results.forEach((r, i) => expect(r.wordIndex).toBe(i));
  });

  it("follows a script that repeats the same line three times", () => {
    const text =
      "yine de devam edelim. yine de devam edelim. yine de devam edelim.";
    const model = parseScript(text);
    const aligner = new ScriptAligner(model, { lang: "tr-TR" });
    const results = readAloud(aligner, asr(text));
    results.forEach((r, i) => expect(r.wordIndex).toBe(i));
  });
});

describe("ScriptAligner: false-jump protection", () => {
  // "sofinler finnormu" occurs at 3-4 and again at 15-16.
  const text =
    "alfaron betakel gammadir sofinler kamurdan epsilonu zetaroz etaligin thetaran iotaluk " +
    "kappadan lambdaz mutaron nuvaler sofinler finnormu omikrona pirelik rhodanz sigmaluk";
  const spoken = text.split(" ");

  it("does not jump to a distant bigram when one word is misrecognised", () => {
    const model = parseScript(text, { lang: "tr-TR" });
    const aligner = new ScriptAligner(model, { lang: "tr-TR" });
    readAloud(aligner, spoken.slice(0, 4));
    expect(aligner.wordIndex).toBe(3);
    // the 5th word is misheard as the word that follows the *other* "sofinler"
    const r = aligner.update([...spoken.slice(0, 4), "finnormu"]);
    expect(r.wordIndex).toBe(3);
    expect(r.matched).toBe(false);
    // reading on normally keeps following the real position
    const rest = [...spoken.slice(0, 4), "finnormu", ...spoken.slice(5, 9)];
    const results = readAloud(
      new ScriptAligner(model, { lang: "tr-TR" }),
      rest,
    );
    expect(results.at(-1)?.wordIndex).toBe(8);
  });

  it("still follows the second occurrence when the speaker really is there", () => {
    const model = parseScript(text, { lang: "tr-TR" });
    const aligner = new ScriptAligner(model, { lang: "tr-TR" });
    const results = readAloud(aligner, spoken);
    results.forEach((r, i) => expect(r.wordIndex).toBe(i));
  });

  it("requires three consecutive words for a jump of more than three words", () => {
    const model = parseScript(text, { lang: "tr-TR" });
    const aligner = new ScriptAligner(model, { lang: "tr-TR" });
    expect(aligner.update(spoken.slice(10, 11)).wordIndex).toBe(0); // one word, 10 ahead
    expect(aligner.update(spoken.slice(10, 12)).wordIndex).toBe(0); // two words
    expect(aligner.update(spoken.slice(10, 13)).wordIndex).toBe(12); // three words
  });
});

describe("ScriptAligner: backward tolerance", () => {
  it("steps back a few words when the speaker repeats them", () => {
    const aligner = new ScriptAligner(parseScript(TR), { lang: "tr-TR" });
    const spoken = asr(TR);
    readAloud(aligner, spoken.slice(0, 9));
    expect(aligner.wordIndex).toBe(8);
    // repeats the last 3 words, ending 2 words earlier
    const said = [...spoken.slice(0, 9), ...spoken.slice(5, 7)];
    const r = aligner.update(said);
    expect(r.wordIndex).toBe(6);
    expect(r.matched).toBe(true);
    // stable on refresh
    expect(aligner.update(said).wordIndex).toBe(6);
    // and continues forward from there
    const next = [...said, spoken[7] ?? ""];
    expect(aligner.update(next).wordIndex).toBe(7);
  });

  it("never jumps back more than maxBackJump words", () => {
    const aligner = new ScriptAligner(parseScript(TR), {
      lang: "tr-TR",
      relockRun: 0,
    });
    const spoken = asr(TR);
    readAloud(aligner, spoken.slice(0, 16));
    expect(aligner.wordIndex).toBe(15);
    const r = aligner.update(spoken.slice(0, 4)); // re-reads the beginning
    expect(r.matched).toBe(false);
    expect(aligner.wordIndex).toBe(15);
  });

  it("is monotonic for forward reading", () => {
    const aligner = new ScriptAligner(parseScript(TR), { lang: "tr-TR" });
    let prev = -1;
    for (const r of readAloud(aligner, asr(TR))) {
      expect(r.wordIndex).toBeGreaterThanOrEqual(prev);
      prev = r.wordIndex;
    }
  });
});

describe("ScriptAligner: API edges", () => {
  it("handles an empty script", () => {
    const aligner = new ScriptAligner(parseScript(""));
    expect(aligner.size).toBe(0);
    expect(aligner.update(["merhaba"])).toEqual({
      wordIndex: 0,
      confidence: 0,
      matched: false,
    });
  });

  it("handles empty / junk transcripts", () => {
    const aligner = new ScriptAligner(parseScript(TR));
    expect(aligner.update([]).matched).toBe(false);
    expect(aligner.update(["", "  ", "...", "!!"]).matched).toBe(false);
    expect(
      aligner.update([null as unknown as string, 5 as unknown as string])
        .matched,
    ).toBe(false);
  });

  it("skips punctuation-only script words but keeps global indices", () => {
    const model = parseScript("Merhaba — dünya ... nasılsın");
    const aligner = new ScriptAligner(model, { lang: "tr-TR" });
    expect(aligner.size).toBe(3);
    expect(aligner.update(["merhaba", "dünya"]).wordIndex).toBe(2);
    expect(aligner.update(["merhaba", "dünya", "nasılsın"]).wordIndex).toBe(4);
  });

  it("reset() re-anchors the pointer", () => {
    const model = parseScript(TR);
    const aligner = new ScriptAligner(model, { lang: "tr-TR" });
    const spoken = asr(TR);
    readAloud(aligner, spoken.slice(0, 5));
    expect(aligner.wordIndex).toBe(4);
    const start = indexOfWord(TR, "sonunda");
    aligner.reset(start);
    const r = aligner.update(spoken.slice(start, start + 1));
    expect(r.wordIndex).toBe(start);
    aligner.reset(0);
    expect(aligner.wordIndex).toBe(0);
    aligner.reset(Number.NaN);
    expect(aligner.wordIndex).toBe(0);
    aligner.reset(10_000);
    expect(aligner.wordIndex).toBe(model.wordCount - 1);
  });

  it("derives the language from the model when none is given", () => {
    const model = parseScript("Işık", { lang: "en-US" });
    // en-US lower-cases I to i; the transcript must be normalised the same way
    expect(new ScriptAligner(model).update(["ışık"]).matched).toBe(true);
  });

  it("clamps absurd option values", () => {
    const aligner = new ScriptAligner(parseScript(TR), {
      maxContext: 1000,
      windowAhead: -4,
      maxBackJump: -1,
      relockRun: -3,
    });
    expect(aligner.update(asr(TR).slice(0, 3)).wordIndex).toBe(2);
  });

  it("is fast enough for long scripts", () => {
    const text = Array.from(
      { length: 30_000 },
      (_, i) => `kelime${i % 997}`,
    ).join(" ");
    const model = parseScript(text);
    const aligner = new ScriptAligner(model, { lang: "tr-TR" });
    const spoken = asr(text).slice(0, 400);
    const t = Date.now();
    readAloud(aligner, spoken);
    expect(Date.now() - t).toBeLessThan(2000);
    expect(aligner.wordIndex).toBeGreaterThan(300);
  });
});

describe("ScriptAligner: noisy reading (seeded fuzz)", () => {
  function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  }

  /** Distinct pronounceable words, pairwise at least 3 edits apart (like real prose). */
  function makeVocab(size: number): string[] {
    const rnd = lcg(12345);
    const syll = [
      "ka",
      "ri",
      "mu",
      "te",
      "so",
      "ban",
      "lek",
      "dor",
      "fin",
      "gul",
      "hem",
      "yaz",
      "nor",
      "pa",
    ];
    const words: string[] = [];
    while (words.length < size) {
      const n = 2 + Math.floor(rnd() * 3);
      let w = "";
      for (let i = 0; i < n; i++)
        w += syll[Math.floor(rnd() * syll.length)] ?? "ka";
      if (w.length < 4 || words.some((x) => levenshtein(x, w, 2) <= 2))
        continue;
      words.push(w);
    }
    return words;
  }
  const vocab = makeVocab(160);
  const improvVocab = [
    "şey",
    "yani",
    "bence",
    "aslında",
    "neyse",
    "işte",
    "hani",
    "tamam",
  ];

  for (let seed = 1; seed <= 25; seed++) {
    it(`stays close to the truth with drops, substitutions and improvisation (seed ${seed})`, () => {
      const rnd = lcg(seed * 7919);
      const script = Array.from(
        { length: 220 },
        () => vocab[Math.floor(rnd() * vocab.length)] ?? "ev",
      );
      const model = parseScript(script.join(" "), { lang: "tr-TR" });
      const aligner = new ScriptAligner(model, { lang: "tr-TR" });

      const spoken: string[] = [];
      let worstAhead = -Infinity;
      let lagSum = 0;
      let steps = 0;
      for (let i = 0; i < script.length; i++) {
        const roll = rnd();
        if (rnd() < 0.05) {
          const n = 1 + Math.floor(rnd() * 4);
          for (let k = 0; k < n; k++) {
            spoken.push(
              improvVocab[Math.floor(rnd() * improvVocab.length)] ?? "yani",
            );
            aligner.update(spoken);
          }
        }
        if (roll < 0.06) continue; // word dropped by the speaker / recogniser
        spoken.push(
          roll < 0.12
            ? (vocab[Math.floor(rnd() * vocab.length)] ?? "ev") // mis-recognised as another word
            : (script[i] ?? "ev"),
        );
        const r = aligner.update(spoken);
        worstAhead = Math.max(worstAhead, r.wordIndex - i);
        lagSum += Math.max(0, i - r.wordIndex);
        steps++;
      }
      expect(worstAhead).toBeLessThanOrEqual(4);
      expect(lagSum / steps).toBeLessThan(1);
      expect(aligner.wordIndex).toBeGreaterThanOrEqual(model.wordCount - 5);
    });
  }
});
