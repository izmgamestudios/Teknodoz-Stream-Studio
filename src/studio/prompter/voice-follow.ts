// src/studio/prompter/voice-follow.ts
// Browser wrapper around the Web Speech API that feeds recognised words to a `ScriptAligner` and
// reports progress + "is the speaker talking" so the UI/engine can hold the scroll during silence.
//
// PRIVACY: In Chrome (and other Chromium browsers) the Web Speech API streams the microphone audio
// to a cloud speech service (Google). The rest of Teknodoz Studio never sends audio anywhere, so
// the UI must show `PRIVACY_NOTE` next to the voice-follow toggle and keep it off by default.
// With `preferOnDevice: true` we ask the browser to recognise locally when it supports that
// (Chrome 139+ with an installed language pack) and fall back to the default if it does not.

import type { ScriptAligner } from "./aligner";

export * from "./aligner";

/** Turkish privacy notice for the voice-follow toggle. */
export const PRIVACY_NOTE =
  "Sesle takip, tarayıcınızın konuşma tanıma servisini kullanır. Chrome'da mikrofon sesi tanıma için Google sunucularına gönderilebilir. Kapalıyken hiçbir ses gönderilmez.";

/** English privacy notice for the voice-follow toggle. */
export const PRIVACY_NOTE_EN =
  "Voice follow uses your browser's speech recognition. In Chrome, microphone audio may be sent to Google servers for recognition. Nothing is sent while it is off.";

/* ------------------------------------------------------------------ */
/* Minimal Web Speech typings (lib.dom does not ship stable ones)      */
/* ------------------------------------------------------------------ */

export interface SpeechAlternativeLike {
  readonly transcript: string;
  readonly confidence: number;
}
export interface SpeechResultLike {
  readonly length: number;
  readonly isFinal: boolean;
  readonly [index: number]: SpeechAlternativeLike | undefined;
}
export interface SpeechResultListLike {
  readonly length: number;
  readonly [index: number]: SpeechResultLike | undefined;
}
export interface SpeechResultEventLike {
  readonly resultIndex: number;
  readonly results: SpeechResultListLike;
}
export interface SpeechErrorEventLike {
  readonly error: string;
  readonly message?: string;
}
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  /** Chrome 139+; optional. */
  processLocally?: boolean;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  onerror: ((event: SpeechErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  const g = globalThis as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return g.SpeechRecognition ?? g.webkitSpeechRecognition ?? null;
}

/** True when this browser exposes SpeechRecognition / webkitSpeechRecognition. SSR-safe. */
export function isVoiceFollowSupported(): boolean {
  return getRecognitionCtor() !== null;
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

/** Stable error codes; branch on these, never on messages. */
export type VoiceFollowErrorCode =
  /** No SpeechRecognition in this browser (fatal). */
  | "unsupported"
  /** Microphone / speech service permission denied (fatal). */
  | "not-allowed"
  /** No microphone found (fatal). */
  | "audio-capture"
  /** The language is not available (fatal). */
  | "language-not-supported"
  /** Nothing was heard for a while; the follower restarts by itself (informational). */
  | "no-speech"
  /** The recognition service could not be reached; retried with backoff. Fatal after the retry limit. */
  | "network"
  /** Recognition was aborted by the browser; the follower restarts by itself. */
  | "aborted"
  | "unknown";

const FATAL: ReadonlySet<VoiceFollowErrorCode> = new Set([
  "unsupported",
  "not-allowed",
  "audio-capture",
  "language-not-supported",
  "unknown",
]);

/** True for codes after which the follower has stopped itself and needs a user action. */
export function isFatalVoiceError(code: VoiceFollowErrorCode): boolean {
  return FATAL.has(code);
}

function mapError(raw: string): VoiceFollowErrorCode {
  switch (raw) {
    case "not-allowed":
    case "service-not-allowed":
      return "not-allowed";
    case "no-speech":
    case "network":
    case "aborted":
    case "audio-capture":
    case "language-not-supported":
      return raw;
    default:
      return "unknown";
  }
}

/* ------------------------------------------------------------------ */
/* Follower                                                            */
/* ------------------------------------------------------------------ */

export interface VoiceFollowerOptions {
  /** BCP-47 recognition language, e.g. "tr-TR". */
  lang: string;
  aligner: ScriptAligner;
  /** Called when the matched position moved or the confidence changed noticeably. */
  onProgress: (progress: { wordIndex: number; confidence: number }) => void;
  /** true when words are being recognised, false after `silenceMs` without new words. */
  onSpeaking?: ((speaking: boolean) => void) | undefined;
  /** `info.fatal` tells whether the follower stopped itself. */
  onError?:
    | ((code: VoiceFollowErrorCode, info: { fatal: boolean }) => void)
    | undefined;
  /** Silence before `onSpeaking(false)`. Default 1800. */
  silenceMs?: number | undefined;
  /** Ask the browser to recognise on-device when possible. Default false. */
  preferOnDevice?: boolean | undefined;
  /** First restart delay in ms. Default 200. */
  restartBaseMs?: number | undefined;
  /** Restart backoff ceiling in ms. Default 5000. */
  restartMaxMs?: number | undefined;
  /** Consecutive "network" failures tolerated before giving up. Default 5. */
  maxNetworkRetries?: number | undefined;
  /** Test seam / alternative engines. Defaults to the browser SpeechRecognition constructor. */
  createRecognition?: (() => SpeechRecognitionLike | null) | undefined;
}

export interface VoiceFollower {
  /** Start listening. Returns false (and reports "unsupported") when impossible. */
  start(): boolean;
  /** Stop listening and release the microphone. Idempotent. */
  stop(): void;
  readonly active: boolean;
  readonly speaking: boolean;
  /** Change the recognition language (restarts the session when active). */
  setLang(lang: string): void;
  /** Swap the aligner (e.g. after the script changed). */
  setAligner(aligner: ScriptAligner): void;
}

/** How many of the newest recognition results are inspected per event. */
const RESULT_TAIL = 3;
/** Words kept from the transcript tail and handed to the aligner. */
const TAIL_WORDS = 12;

function tailWords(results: SpeechResultListLike): string[] {
  const words: string[] = [];
  for (
    let i = Math.max(0, results.length - RESULT_TAIL);
    i < results.length;
    i++
  ) {
    const text = results[i]?.[0]?.transcript;
    if (!text) continue;
    for (const token of text.split(/\s+/)) if (token) words.push(token);
  }
  return words.length > TAIL_WORDS ? words.slice(-TAIL_WORDS) : words;
}

export function createVoiceFollower(
  options: VoiceFollowerOptions,
): VoiceFollower {
  const silenceMs = Math.max(100, options.silenceMs ?? 1800);
  const restartBase = Math.max(10, options.restartBaseMs ?? 200);
  const restartMax = Math.max(restartBase, options.restartMaxMs ?? 5000);
  const maxNetworkRetries = Math.max(0, options.maxNetworkRetries ?? 5);

  let lang = options.lang;
  let aligner = options.aligner;
  let preferOnDevice = options.preferOnDevice ?? false;

  let active = false;
  let speaking = false;
  let rec: SpeechRecognitionLike | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let emptySessions = 0;
  let networkFailures = 0;
  let gotResult = false;
  let lastTailKey = "";
  let lastReported = { wordIndex: -1, confidence: -1 };

  const emitError = (
    code: VoiceFollowErrorCode,
    fatal = isFatalVoiceError(code),
  ): void => {
    options.onError?.(code, { fatal });
  };

  const setSpeaking = (value: boolean): void => {
    if (speaking === value) return;
    speaking = value;
    options.onSpeaking?.(value);
  };

  const clearTimers = (): void => {
    if (restartTimer !== null) clearTimeout(restartTimer);
    if (silenceTimer !== null) clearTimeout(silenceTimer);
    restartTimer = null;
    silenceTimer = null;
  };

  const detach = (instance: SpeechRecognitionLike | null): void => {
    if (!instance) return;
    instance.onresult = null;
    instance.onerror = null;
    instance.onend = null;
    try {
      instance.abort();
    } catch {
      /* already stopped */
    }
  };

  const markActivity = (): void => {
    setSpeaking(true);
    if (silenceTimer !== null) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      silenceTimer = null;
      setSpeaking(false);
    }, silenceMs);
  };

  const fail = (code: VoiceFollowErrorCode): void => {
    active = false;
    clearTimers();
    detach(rec);
    rec = null;
    setSpeaking(false);
    emitError(code);
  };

  const handleResult = (event: SpeechResultEventLike): void => {
    gotResult = true;
    emptySessions = 0;
    networkFailures = 0;
    const words = tailWords(event.results);
    if (words.length === 0) return;
    const key = `${event.results.length}|${words.slice(-6).join(" ")}`;
    if (key === lastTailKey) return;
    lastTailKey = key;
    markActivity();
    const result = aligner.update(words);
    if (!result.matched) return;
    if (
      result.wordIndex !== lastReported.wordIndex ||
      Math.abs(result.confidence - lastReported.confidence) >= 0.05
    ) {
      lastReported = {
        wordIndex: result.wordIndex,
        confidence: result.confidence,
      };
      options.onProgress({ ...lastReported });
    }
  };

  const scheduleRestart = (delay: number): void => {
    if (!active || restartTimer !== null) return;
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (active) begin();
    }, delay);
  };

  const begin = (): void => {
    const instance = options.createRecognition
      ? options.createRecognition()
      : (() => {
          const Ctor = getRecognitionCtor();
          return Ctor ? new Ctor() : null;
        })();
    if (!instance) {
      fail("unsupported");
      return;
    }
    rec = instance;
    gotResult = false;
    lastTailKey = "";
    instance.lang = lang;
    instance.continuous = true;
    instance.interimResults = true;
    instance.maxAlternatives = 1;
    if (preferOnDevice && "processLocally" in instance)
      instance.processLocally = true;

    instance.onresult = (event) => {
      if (rec === instance && active) handleResult(event);
    };
    instance.onerror = (event) => {
      if (rec !== instance || !active) return;
      const code = mapError(event.error);
      if (code === "language-not-supported" && preferOnDevice) {
        // No on-device pack for this language: retry once with the regular service.
        preferOnDevice = false;
        return;
      }
      if (isFatalVoiceError(code)) {
        fail(code);
        return;
      }
      if (code === "network") {
        networkFailures++;
        if (networkFailures > maxNetworkRetries) {
          active = false;
          clearTimers();
          detach(rec);
          rec = null;
          setSpeaking(false);
          emitError(code, true);
        } else {
          emitError(code, false);
        }
        return;
      }
      emitError(code);
    };
    instance.onend = () => {
      if (rec !== instance || !active) return;
      rec = null;
      // Backoff grows with consecutive sessions that produced no results at all.
      const delay = Math.min(
        restartMax,
        restartBase * 2 ** Math.min(emptySessions, 10),
      );
      if (!gotResult) emptySessions++;
      scheduleRestart(delay);
    };

    try {
      instance.start();
    } catch (err) {
      const name = (err as { name?: unknown } | null)?.name;
      if (name === "InvalidStateError") return; // already running
      fail(
        name === "NotAllowedError" || name === "SecurityError"
          ? "not-allowed"
          : "unknown",
      );
    }
  };

  return {
    start() {
      if (active) return true;
      active = true;
      emptySessions = 0;
      networkFailures = 0;
      lastTailKey = "";
      lastReported = { wordIndex: -1, confidence: -1 };
      begin();
      return active;
    },
    stop() {
      active = false;
      clearTimers();
      detach(rec);
      rec = null;
      setSpeaking(false);
    },
    get active() {
      return active;
    },
    get speaking() {
      return speaking;
    },
    setLang(next: string) {
      lang = next;
      if (!active) return;
      clearTimers();
      detach(rec);
      rec = null;
      emptySessions = 0;
      begin();
    },
    setAligner(next: ScriptAligner) {
      aligner = next;
      lastTailKey = "";
      lastReported = { wordIndex: -1, confidence: -1 };
    },
  };
}
