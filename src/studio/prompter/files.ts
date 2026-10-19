// src/studio/prompter/files.ts
// Importing script text from files (.txt / .md / .srt / .docx) and from the clipboard.
// Browser-only APIs are feature-detected; every failure is a typed error with a stable `code`.

/** Largest accepted script file (compressed size for .docx). */
export const MAX_SCRIPT_FILE_BYTES = 5 * 1024 * 1024;

/** Value for `<input type="file" accept>`. */
export const SCRIPT_FILE_ACCEPT =
  ".txt,.md,.markdown,.srt,.docx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  "txt",
  "md",
  "markdown",
  "text",
]);

export type PrompterFileErrorCode = "too-large" | "unsupported" | "read-failed";

const FILE_MESSAGES: Record<PrompterFileErrorCode, string> = {
  "too-large": "Dosya çok büyük (en fazla 5 MB)",
  unsupported:
    "Desteklenmeyen dosya türü (.txt, .md, .srt veya .docx kullanın)",
  "read-failed": "Dosya okunamadı",
};

/** Thrown by `readScriptFile`. Branch on `code`, never on `message`. */
export class PrompterFileError extends Error {
  readonly code: PrompterFileErrorCode;

  constructor(
    code: PrompterFileErrorCode,
    message?: string,
    options?: { cause?: unknown },
  ) {
    super(message ?? FILE_MESSAGES[code], options);
    this.name = "PrompterFileError";
    this.code = code;
  }
}

export type PrompterClipboardErrorCode =
  "permission-denied" | "unsupported" | "read-failed";

const CLIPBOARD_MESSAGES: Record<PrompterClipboardErrorCode, string> = {
  "permission-denied": "Panoya erişim izni verilmedi",
  unsupported: "Tarayıcı panodan okumayı desteklemiyor",
  "read-failed": "Pano okunamadı",
};

/** Thrown by `readClipboardText`. */
export class PrompterClipboardError extends Error {
  readonly code: PrompterClipboardErrorCode;

  constructor(
    code: PrompterClipboardErrorCode,
    message?: string,
    options?: { cause?: unknown },
  ) {
    super(message ?? CLIPBOARD_MESSAGES[code], options);
    this.name = "PrompterClipboardError";
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* Text helpers                                                        */
/* ------------------------------------------------------------------ */

const NUL = String.fromCharCode(0);

/** Strip BOM + NULs, unify newlines to "\n". */
export function normalizeImportedText(text: string): string {
  return text
    .replace(/^\uFEFF/, "")
    .replaceAll(NUL, "")
    .replace(/\r\n?/g, "\n");
}

/**
 * Decode file bytes: UTF-16 (BOM), UTF-8 (BOM stripped) and, when the bytes are not valid UTF-8,
 * windows-1254 (legacy Turkish .txt files saved by old Notepad versions).
 */
export function decodeTextBytes(bytes: Uint8Array): string {
  if (typeof TextDecoder === "undefined") {
    throw new PrompterFileError("read-failed", "TextDecoder is not available");
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  const start =
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
      ? 3
      : 0;
  const body = bytes.subarray(start);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    try {
      return new TextDecoder("windows-1254").decode(body);
    } catch {
      return new TextDecoder("utf-8").decode(body);
    }
  }
}

const SRT_TIMING =
  /^\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/;

/** Reduce an .srt file to its spoken text: one line per cue, no numbers, timings or tags. */
export function stripSubtitleMarkup(srt: string): string {
  const out: string[] = [];
  let cue: string[] = [];
  const flush = (): void => {
    if (cue.length) out.push(cue.join(" "));
    cue = [];
  };
  for (const raw of srt.split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (SRT_TIMING.test(line)) continue;
    if (/^\d+$/.test(line) && cue.length === 0) continue;
    cue.push(
      line
        .replace(/<\/?[a-z][^>]*>/gi, "")
        .replace(/\{\\[^}]*\}/g, "")
        .trim(),
    );
  }
  flush();
  return out.filter(Boolean).join("\n");
}

/* ------------------------------------------------------------------ */
/* File reading                                                        */
/* ------------------------------------------------------------------ */

type FileKind = "text" | "srt" | "docx";

function detectKind(name: string, mime: string): FileKind | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
  const type = mime.toLowerCase();
  if (ext === "docx" || (ext === "" && type === DOCX_MIME)) return "docx";
  if (ext === "srt") return "srt";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  if (ext === "" && type.startsWith("text/")) return "text";
  return null;
}

/** Realm-agnostic ArrayBuffer check (instanceof fails across iframes / test realms). */
function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}

async function readBytes(file: Blob): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  if (typeof FileReader === "undefined") {
    throw new PrompterFileError("read-failed", "File reading is not supported");
  }
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      isArrayBuffer(reader.result)
        ? resolve(reader.result)
        : reject(new PrompterFileError("read-failed"));
    reader.onerror = () =>
      reject(
        new PrompterFileError("read-failed", undefined, {
          cause: reader.error,
        }),
      );
    reader.readAsArrayBuffer(file);
  });
}

interface MammothLike {
  extractRawText(input: {
    arrayBuffer: ArrayBuffer;
  }): Promise<{ value: string }>;
}

async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
  let api: MammothLike | undefined;
  try {
    // Loaded on demand so the (large) library never lands in the main bundle.
    const mod = (await import("mammoth")) as unknown as MammothLike & {
      default?: MammothLike;
    };
    api = typeof mod.extractRawText === "function" ? mod : mod.default;
  } catch (cause) {
    throw new PrompterFileError("read-failed", undefined, { cause });
  }
  if (!api || typeof api.extractRawText !== "function") {
    throw new PrompterFileError("read-failed", "mammoth could not be loaded");
  }
  try {
    const result = await api.extractRawText({ arrayBuffer: buffer });
    return typeof result.value === "string" ? result.value : "";
  } catch (cause) {
    throw new PrompterFileError("read-failed", undefined, { cause });
  }
}

/**
 * Read a script from a user-selected file.
 *
 * Supported: `.txt`, `.md`/`.markdown` (UTF-8 with or without BOM, UTF-16 with BOM, legacy
 * windows-1254), `.srt` (reduced to its text) and `.docx` (via mammoth, loaded lazily). Everything
 * else is rejected with "unsupported". Files over 5 MB are rejected with "too-large" before being
 * read. Note the limit applies to the compressed size for `.docx`.
 *
 * @throws PrompterFileError with code "too-large" | "unsupported" | "read-failed"
 */
export async function readScriptFile(file: File): Promise<string> {
  if (!file || typeof file.size !== "number" || typeof file.name !== "string") {
    throw new PrompterFileError("unsupported");
  }
  const kind = detectKind(
    file.name,
    typeof file.type === "string" ? file.type : "",
  );
  if (!kind) throw new PrompterFileError("unsupported");
  if (file.size > MAX_SCRIPT_FILE_BYTES)
    throw new PrompterFileError("too-large");

  let buffer: ArrayBuffer;
  try {
    buffer = await readBytes(file);
  } catch (cause) {
    if (cause instanceof PrompterFileError) throw cause;
    throw new PrompterFileError("read-failed", undefined, { cause });
  }
  if (buffer.byteLength > MAX_SCRIPT_FILE_BYTES)
    throw new PrompterFileError("too-large");

  let text: string;
  if (kind === "docx") {
    text = await extractDocxText(buffer);
  } else {
    try {
      text = decodeTextBytes(new Uint8Array(buffer));
    } catch (cause) {
      if (cause instanceof PrompterFileError) throw cause;
      throw new PrompterFileError("read-failed", undefined, { cause });
    }
  }
  text = normalizeImportedText(text);
  if (kind === "srt") text = stripSubtitleMarkup(text);
  if (text.length > MAX_SCRIPT_FILE_BYTES)
    throw new PrompterFileError("too-large");
  return text;
}

/* ------------------------------------------------------------------ */
/* Clipboard                                                           */
/* ------------------------------------------------------------------ */

/**
 * Read plain text from the system clipboard (needs a user gesture and, in most browsers, a
 * permission prompt).
 *
 * @throws PrompterClipboardError "permission-denied" | "unsupported" | "read-failed"
 */
export async function readClipboardText(): Promise<string> {
  const clipboard =
    typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (!clipboard || typeof clipboard.readText !== "function") {
    throw new PrompterClipboardError("unsupported");
  }
  let text: string;
  try {
    text = await clipboard.readText();
  } catch (cause) {
    const name = (cause as { name?: unknown } | null)?.name;
    if (name === "NotAllowedError" || name === "SecurityError") {
      throw new PrompterClipboardError("permission-denied", undefined, {
        cause,
      });
    }
    throw new PrompterClipboardError("read-failed", undefined, { cause });
  }
  const normalized = normalizeImportedText(
    typeof text === "string" ? text : "",
  );
  return normalized.length > MAX_SCRIPT_FILE_BYTES
    ? normalized.slice(0, MAX_SCRIPT_FILE_BYTES)
    : normalized;
}
