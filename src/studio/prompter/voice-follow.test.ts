import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScriptAligner } from "./aligner";
import { parseScript } from "./script";
import {
  createVoiceFollower,
  isFatalVoiceError,
  isVoiceFollowSupported,
  PRIVACY_NOTE,
  PRIVACY_NOTE_EN,
  type SpeechRecognitionLike,
  type SpeechResultEventLike,
  type VoiceFollowerOptions,
} from "./voice-follow";

class FakeRecognition implements SpeechRecognitionLike {
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  processLocally?: boolean;
  onresult: SpeechRecognitionLike["onresult"] = null;
  onerror: SpeechRecognitionLike["onerror"] = null;
  onend: SpeechRecognitionLike["onend"] = null;
  started = 0;
  aborted = 0;
  startError: Error | null = null;

  start(): void {
    if (this.startError) throw this.startError;
    this.started++;
  }
  stop(): void {}
  abort(): void {
    this.aborted++;
  }

  /** Emit a results list; each entry is one recognition result (an utterance segment). */
  say(...segments: string[]): void {
    const results = segments.map((transcript) => ({
      length: 1,
      isFinal: false,
      0: { transcript, confidence: 0.9 },
    }));
    const event: SpeechResultEventLike = {
      resultIndex: 0,
      results: results as unknown as SpeechResultEventLike["results"],
    };
    this.onresult?.(event);
  }
  fail(code: string): void {
    this.onerror?.({ error: code });
  }
  end(): void {
    this.onend?.();
  }
}

const SCRIPT =
  "Herkese merhaba podcastimize hoş geldiniz bugün oyun geliştirmenin zorluklarını konuşacağız";

function setup(extra: Partial<VoiceFollowerOptions> = {}) {
  const instances: FakeRecognition[] = [];
  const onProgress = vi.fn();
  const onSpeaking = vi.fn();
  const onError = vi.fn();
  const aligner = new ScriptAligner(parseScript(SCRIPT), { lang: "tr-TR" });
  const follower = createVoiceFollower({
    lang: "tr-TR",
    aligner,
    onProgress,
    onSpeaking,
    onError,
    createRecognition: () => {
      const r = new FakeRecognition();
      instances.push(r);
      return r;
    },
    ...extra,
  });
  const current = (): FakeRecognition => {
    const r = instances[instances.length - 1];
    if (!r) throw new Error("no recognition instance");
    return r;
  };
  return {
    follower,
    instances,
    current,
    onProgress,
    onSpeaking,
    onError,
    aligner,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("support detection", () => {
  it("is false when the browser has no SpeechRecognition", () => {
    expect(isVoiceFollowSupported()).toBe(false);
  });

  it("detects both the standard and the webkit-prefixed constructor", () => {
    vi.stubGlobal("webkitSpeechRecognition", FakeRecognition);
    expect(isVoiceFollowSupported()).toBe(true);
    vi.unstubAllGlobals();
    vi.stubGlobal("SpeechRecognition", FakeRecognition);
    expect(isVoiceFollowSupported()).toBe(true);
  });

  it("exposes privacy notes that mention Google", () => {
    expect(PRIVACY_NOTE).toMatch(/Google/);
    expect(PRIVACY_NOTE_EN).toMatch(/Google/);
  });

  it("classifies error codes", () => {
    for (const c of [
      "unsupported",
      "not-allowed",
      "audio-capture",
      "language-not-supported",
    ] as const) {
      expect(isFatalVoiceError(c)).toBe(true);
    }
    for (const c of ["no-speech", "network", "aborted"] as const) {
      expect(isFatalVoiceError(c)).toBe(false);
    }
  });
});

describe("start / configuration", () => {
  it("reports 'unsupported' when there is no engine", () => {
    const onError = vi.fn();
    const f = createVoiceFollower({
      lang: "tr-TR",
      aligner: new ScriptAligner(parseScript(SCRIPT)),
      onProgress: vi.fn(),
      onError,
    });
    expect(f.start()).toBe(false);
    expect(f.active).toBe(false);
    expect(onError).toHaveBeenCalledWith("unsupported", { fatal: true });
  });

  it("uses the global constructor by default", () => {
    const created: FakeRecognition[] = [];
    vi.stubGlobal(
      "webkitSpeechRecognition",
      class extends FakeRecognition {
        constructor() {
          super();
          created.push(this);
        }
      },
    );
    const f = createVoiceFollower({
      lang: "en-US",
      aligner: new ScriptAligner(parseScript(SCRIPT)),
      onProgress: vi.fn(),
    });
    expect(f.start()).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0]?.lang).toBe("en-US");
  });

  it("configures a continuous, interim, single-alternative recogniser", () => {
    const { follower, current } = setup();
    expect(follower.start()).toBe(true);
    const r = current();
    expect(r).toMatchObject({
      lang: "tr-TR",
      continuous: true,
      interimResults: true,
      maxAlternatives: 1,
    });
    expect(r.started).toBe(1);
    expect(follower.active).toBe(true);
  });

  it("start() twice does not create a second session", () => {
    const { follower, instances } = setup();
    follower.start();
    follower.start();
    expect(instances).toHaveLength(1);
  });

  it("maps a throwing start() to a stable error code", () => {
    const err = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    const onError = vi.fn();
    const f = createVoiceFollower({
      lang: "tr-TR",
      aligner: new ScriptAligner(parseScript(SCRIPT)),
      onProgress: vi.fn(),
      onError,
      createRecognition: () =>
        Object.assign(new FakeRecognition(), { startError: err }),
    });
    expect(f.start()).toBe(false);
    expect(onError).toHaveBeenCalledWith("not-allowed", { fatal: true });

    const other = createVoiceFollower({
      lang: "tr-TR",
      aligner: new ScriptAligner(parseScript(SCRIPT)),
      onProgress: vi.fn(),
      onError,
      createRecognition: () =>
        Object.assign(new FakeRecognition(), { startError: new Error("x") }),
    });
    expect(other.start()).toBe(false);
    expect(onError).toHaveBeenLastCalledWith("unknown", { fatal: true });
  });

  it("ignores InvalidStateError from start() (already running)", () => {
    const err = Object.assign(new Error("running"), {
      name: "InvalidStateError",
    });
    const onError = vi.fn();
    const f = createVoiceFollower({
      lang: "tr-TR",
      aligner: new ScriptAligner(parseScript(SCRIPT)),
      onProgress: vi.fn(),
      onError,
      createRecognition: () =>
        Object.assign(new FakeRecognition(), { startError: err }),
    });
    expect(f.start()).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("progress", () => {
  it("feeds recognised words to the aligner and reports progress", () => {
    const { follower, current, onProgress } = setup();
    follower.start();
    current().say("herkese");
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ wordIndex: 0 }),
    );
    current().say("herkese merhaba podcastimize");
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ wordIndex: 2 }),
    );
    const last = onProgress.mock.calls.at(-1)?.[0] as { confidence: number };
    expect(last.confidence).toBeGreaterThan(0);
  });

  it("does not report the same position twice for repeated identical results", () => {
    const { follower, current, onProgress } = setup();
    follower.start();
    current().say("herkese merhaba");
    current().say("herkese merhaba");
    current().say("herkese merhaba");
    expect(onProgress).toHaveBeenCalledTimes(1);
  });

  it("does not report anything for improvisation", () => {
    const { follower, current, onProgress, onSpeaking } = setup();
    follower.start();
    current().say("yani şey aslında bence böyle");
    expect(onProgress).not.toHaveBeenCalled();
    expect(onSpeaking).toHaveBeenCalledWith(true); // still speech activity
  });

  it("only inspects the newest results of a long continuous session", () => {
    const { follower, current, onProgress } = setup();
    follower.start();
    const old = Array.from({ length: 300 }, () => "gevezelik");
    current().say(...old, "herkese merhaba podcastimize hoş");
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ wordIndex: 3 }),
    );
  });

  it("ignores empty results", () => {
    const { follower, current, onProgress, onSpeaking } = setup();
    follower.start();
    current().say("", "   ");
    expect(onProgress).not.toHaveBeenCalled();
    expect(onSpeaking).not.toHaveBeenCalled();
  });

  it("setAligner switches the script", () => {
    const { follower, current, onProgress } = setup();
    follower.start();
    follower.setAligner(
      new ScriptAligner(parseScript("tamamen başka bir metin burada"), {
        lang: "tr-TR",
      }),
    );
    current().say("tamamen başka bir");
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ wordIndex: 2 }),
    );
  });
});

describe("speaking / silence", () => {
  it("emits onSpeaking(true) on words and onSpeaking(false) after silenceMs (default 1800)", () => {
    const { follower, current, onSpeaking } = setup();
    follower.start();
    current().say("herkese");
    expect(onSpeaking).toHaveBeenCalledTimes(1);
    expect(onSpeaking).toHaveBeenLastCalledWith(true);
    expect(follower.speaking).toBe(true);
    vi.advanceTimersByTime(1799);
    expect(follower.speaking).toBe(true);
    vi.advanceTimersByTime(2);
    expect(onSpeaking).toHaveBeenLastCalledWith(false);
    expect(follower.speaking).toBe(false);
    expect(onSpeaking).toHaveBeenCalledTimes(2);
  });

  it("stays speaking while words keep arriving and honours a custom silenceMs", () => {
    const { follower, current, onSpeaking } = setup({ silenceMs: 500 });
    follower.start();
    const words = SCRIPT.toLowerCase().split(" ");
    for (let i = 1; i <= 6; i++) {
      current().say(words.slice(0, i).join(" "));
      vi.advanceTimersByTime(400);
    }
    expect(onSpeaking).toHaveBeenCalledTimes(1);
    expect(follower.speaking).toBe(true);
    vi.advanceTimersByTime(600);
    expect(follower.speaking).toBe(false);
    // and starts again with new words
    current().say("yeni kelimeler geldi");
    expect(follower.speaking).toBe(true);
    expect(onSpeaking).toHaveBeenCalledTimes(3);
  });
});

describe("auto restart", () => {
  it("restarts after the browser ends the session, with exponential backoff", () => {
    const { follower, instances, current } = setup();
    follower.start();
    current().end(); // no results -> counts as an empty session
    vi.advanceTimersByTime(199);
    expect(instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(instances).toHaveLength(2);
    expect(current().started).toBe(1);

    current().end();
    vi.advanceTimersByTime(399);
    expect(instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(instances).toHaveLength(3);

    current().end();
    vi.advanceTimersByTime(800);
    expect(instances).toHaveLength(4);
  });

  it("caps the backoff", () => {
    const { follower, instances, current } = setup({
      restartBaseMs: 100,
      restartMaxMs: 300,
    });
    follower.start();
    for (let i = 0; i < 6; i++) {
      current().end();
      vi.advanceTimersByTime(300);
    }
    expect(instances).toHaveLength(7);
    current().end();
    vi.advanceTimersByTime(299);
    expect(instances).toHaveLength(7);
    vi.advanceTimersByTime(1);
    expect(instances).toHaveLength(8);
  });

  it("resets the backoff after a session that produced results", () => {
    const { follower, instances, current } = setup();
    follower.start();
    current().end();
    vi.advanceTimersByTime(200);
    current().end();
    vi.advanceTimersByTime(400);
    expect(instances).toHaveLength(3);
    current().say("herkese");
    current().end();
    vi.advanceTimersByTime(200);
    expect(instances).toHaveLength(4);
  });

  it("does not restart after stop()", () => {
    const { follower, instances, current } = setup();
    follower.start();
    const first = current();
    follower.stop();
    first.end();
    vi.advanceTimersByTime(10_000);
    expect(instances).toHaveLength(1);
    expect(follower.active).toBe(false);
  });
});

describe("errors", () => {
  it("not-allowed is fatal: no restart, stops listening", () => {
    const { follower, instances, current, onError, onSpeaking } = setup();
    follower.start();
    current().say("herkese");
    current().fail("not-allowed");
    expect(onError).toHaveBeenCalledWith("not-allowed", { fatal: true });
    expect(follower.active).toBe(false);
    expect(onSpeaking).toHaveBeenLastCalledWith(false);
    current().end();
    vi.advanceTimersByTime(10_000);
    expect(instances).toHaveLength(1);
  });

  it("service-not-allowed maps to not-allowed; audio-capture and language errors are fatal", () => {
    for (const [raw, code] of [
      ["service-not-allowed", "not-allowed"],
      ["audio-capture", "audio-capture"],
      ["language-not-supported", "language-not-supported"],
      ["bad-grammar", "unknown"],
      ["something-new", "unknown"],
    ] as const) {
      const { follower, current, onError } = setup();
      follower.start();
      current().fail(raw);
      expect(onError).toHaveBeenCalledWith(code, { fatal: true });
      expect(follower.active).toBe(false);
    }
  });

  it("no-speech is informational and the session restarts", () => {
    const { follower, instances, current, onError } = setup();
    follower.start();
    current().fail("no-speech");
    expect(onError).toHaveBeenCalledWith("no-speech", { fatal: false });
    expect(follower.active).toBe(true);
    current().end();
    vi.advanceTimersByTime(200);
    expect(instances).toHaveLength(2);
  });

  it("aborted restarts by itself", () => {
    const { follower, instances, current, onError } = setup();
    follower.start();
    current().fail("aborted");
    expect(onError).toHaveBeenCalledWith("aborted", { fatal: false });
    current().end();
    vi.advanceTimersByTime(200);
    expect(instances).toHaveLength(2);
  });

  it("network errors retry, then become fatal after the limit", () => {
    const { follower, instances, current, onError } = setup({
      maxNetworkRetries: 2,
    });
    follower.start();
    current().fail("network");
    current().end();
    vi.advanceTimersByTime(200);
    current().fail("network");
    current().end();
    vi.advanceTimersByTime(400);
    expect(instances).toHaveLength(3);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenLastCalledWith("network", { fatal: false });

    current().fail("network"); // third consecutive failure: give up
    expect(onError).toHaveBeenLastCalledWith("network", { fatal: true });
    expect(follower.active).toBe(false);
    current().end();
    vi.advanceTimersByTime(60_000);
    expect(instances).toHaveLength(3);
  });

  it("a successful result resets the network failure counter", () => {
    const { follower, current, onError } = setup({ maxNetworkRetries: 1 });
    follower.start();
    current().fail("network");
    current().end();
    vi.advanceTimersByTime(200);
    current().say("herkese");
    current().fail("network");
    expect(follower.active).toBe(true);
    expect(onError).toHaveBeenLastCalledWith("network", { fatal: false });
  });

  it("works without any callbacks besides onProgress", () => {
    const rec = new FakeRecognition();
    const f = createVoiceFollower({
      lang: "tr-TR",
      aligner: new ScriptAligner(parseScript(SCRIPT)),
      onProgress: vi.fn(),
      createRecognition: () => rec,
    });
    f.start();
    expect(() => {
      rec.say("herkese");
      rec.fail("not-allowed");
      vi.advanceTimersByTime(5000);
    }).not.toThrow();
  });
});

describe("stop / setLang / on-device", () => {
  it("stop() aborts the session, silences the speaking flag and drops late events", () => {
    const { follower, current, onProgress, onSpeaking } = setup();
    follower.start();
    const r = current();
    r.say("herkese");
    follower.stop();
    expect(r.aborted).toBe(1);
    expect(onSpeaking).toHaveBeenLastCalledWith(false);
    onProgress.mockClear();
    r.onresult?.({ resultIndex: 0, results: [] as never });
    expect(onProgress).not.toHaveBeenCalled();
    expect(r.onresult).toBeNull();
    follower.stop(); // idempotent
  });

  it("can be restarted after stop()", () => {
    const { follower, instances } = setup();
    follower.start();
    follower.stop();
    expect(follower.start()).toBe(true);
    expect(instances).toHaveLength(2);
  });

  it("setLang restarts an active session with the new language", () => {
    const { follower, instances, current } = setup();
    follower.start();
    const first = current();
    follower.setLang("en-US");
    expect(first.aborted).toBe(1);
    expect(instances).toHaveLength(2);
    expect(current().lang).toBe("en-US");
  });

  it("setLang while stopped just remembers the language", () => {
    const { follower, instances, current } = setup();
    follower.setLang("en-GB");
    expect(instances).toHaveLength(0);
    follower.start();
    expect(current().lang).toBe("en-GB");
  });

  it("preferOnDevice requests local recognition and falls back when unavailable", () => {
    const { follower, instances, current, onError } = setup({
      preferOnDevice: true,
    });
    follower.start();
    expect(current().processLocally).toBe(true);
    current().fail("language-not-supported");
    expect(onError).not.toHaveBeenCalled();
    expect(follower.active).toBe(true);
    current().end();
    vi.advanceTimersByTime(500);
    expect(instances).toHaveLength(2);
    expect(current().processLocally).toBeUndefined();
  });

  it("does not touch processLocally by default", () => {
    const { follower, current } = setup();
    follower.start();
    expect(current().processLocally).toBeUndefined();
  });
});
