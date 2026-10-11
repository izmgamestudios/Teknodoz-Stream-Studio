import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mammothMock = vi.hoisted(() => ({
  extractRawText: vi.fn(),
}));
vi.mock("mammoth", () => ({
  default: mammothMock,
  extractRawText: mammothMock.extractRawText,
}));

import {
  decodeTextBytes,
  MAX_SCRIPT_FILE_BYTES,
  normalizeImportedText,
  PrompterClipboardError,
  PrompterFileError,
  readClipboardText,
  readScriptFile,
  stripSubtitleMarkup,
} from "./files";

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

function makeFile(content: Uint8Array | string, name: string, type = ""): File {
  const data = typeof content === "string" ? utf8(content) : content;
  return new File([data as BlobPart], name, { type });
}

/** A File-like object whose size/behaviour we control without allocating megabytes. */
function fakeFile(
  name: string,
  size: number,
  read: () => Promise<ArrayBuffer>,
  type = "text/plain",
): File {
  return { name, size, type, arrayBuffer: read } as unknown as File;
}

async function expectCode(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(PrompterFileError);
  expect((err as PrompterFileError).code).toBe(code);
}

beforeEach(() => {
  mammothMock.extractRawText.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("text helpers", () => {
  it("normalizeImportedText strips BOM and NUL and unifies newlines", () => {
    const bom = String.fromCharCode(0xfeff);
    const nul = String.fromCharCode(0);
    expect(normalizeImportedText(`${bom}a${nul}b\r\nc\rd\ne`)).toBe(
      "ab\nc\nd\ne",
    );
    expect(normalizeImportedText("")).toBe("");
  });

  it("decodeTextBytes handles UTF-8 with and without BOM", () => {
    expect(decodeTextBytes(utf8("Işık çağrı"))).toBe("Işık çağrı");
    expect(decodeTextBytes(bytes(0xef, 0xbb, 0xbf, ...utf8("Merhaba")))).toBe(
      "Merhaba",
    );
    expect(decodeTextBytes(new Uint8Array())).toBe("");
  });

  it("decodeTextBytes handles UTF-16 with BOM", () => {
    const le = bytes(0xff, 0xfe, 0x4d, 0x00, 0x65, 0x00, 0xe7, 0x00);
    expect(decodeTextBytes(le)).toBe("Meç");
    const be = bytes(0xfe, 0xff, 0x00, 0x4d, 0x00, 0x65, 0x00, 0xe7);
    expect(decodeTextBytes(be)).toBe("Meç");
  });

  it("decodeTextBytes falls back to windows-1254 for legacy Turkish files", () => {
    // "ışğüşöç İ" in windows-1254
    const legacy = bytes(0xfd, 0xfe, 0xf0, 0xfc, 0xfe, 0xf6, 0xe7, 0x20, 0xdd);
    expect(decodeTextBytes(legacy)).toBe("ışğüşöç İ");
  });

  it("stripSubtitleMarkup keeps only the spoken text, one line per cue", () => {
    const srt = [
      "1",
      "00:00:01,000 --> 00:00:03,000",
      "Merhaba <i>dünya</i>",
      "ikinci satır",
      "",
      "2",
      "00:00:04,000 --> 00:00:06,500",
      "{\\an8}Güle güle",
      "",
      "3",
      "00:00:07.000 --> 00:00:08.000",
      "2024 yılı", // a cue whose text starts with digits must survive
      "",
    ].join("\n");
    expect(stripSubtitleMarkup(srt)).toBe(
      "Merhaba dünya ikinci satır\nGüle güle\n2024 yılı",
    );
    expect(stripSubtitleMarkup("")).toBe("");
  });
});

describe("readScriptFile: plain text", () => {
  it("reads .txt (UTF-8) and keeps Turkish characters", async () => {
    const text = await readScriptFile(
      makeFile("A: Merhaba, İstanbul!\nB: Işık", "senaryo.txt", "text/plain"),
    );
    expect(text).toBe("A: Merhaba, İstanbul!\nB: Işık");
  });

  it("strips the UTF-8 BOM and normalises Windows newlines", async () => {
    const withBom = bytes(0xef, 0xbb, 0xbf, ...utf8("bir\r\niki\r\n"));
    expect(await readScriptFile(makeFile(withBom, "a.txt", "text/plain"))).toBe(
      "bir\niki\n",
    );
  });

  it("reads UTF-16 and legacy windows-1254 files", async () => {
    const utf16 = bytes(0xff, 0xfe, 0x69, 0x00, 0x6b, 0x00, 0x69, 0x00);
    expect(await readScriptFile(makeFile(utf16, "u16.txt"))).toBe("iki");
    const legacy = bytes(0xfd, 0xfe, 0xf0);
    expect(await readScriptFile(makeFile(legacy, "eski.txt"))).toBe("ışğ");
  });

  it("accepts .md, .markdown and extension-less text/* files", async () => {
    expect(
      await readScriptFile(makeFile("# Başlık", "notlar.md", "text/markdown")),
    ).toBe("# Başlık");
    expect(await readScriptFile(makeFile("x", "a.markdown"))).toBe("x");
    expect(
      await readScriptFile(makeFile("serbest", "README", "text/plain")),
    ).toBe("serbest");
    expect(await readScriptFile(makeFile("UPPER", "NOTES.TXT"))).toBe("UPPER");
  });

  it("returns an empty string for an empty file", async () => {
    expect(await readScriptFile(makeFile("", "bos.txt"))).toBe("");
  });

  it("reduces .srt files to their text", async () => {
    const srt =
      "1\n00:00:01,000 --> 00:00:02,000\nMerhaba\n\n2\n00:00:02,500 --> 00:00:04,000\nDünya\n";
    expect(await readScriptFile(makeFile(srt, "alt.srt"))).toBe(
      "Merhaba\nDünya",
    );
  });

  it("falls back to FileReader when Blob.arrayBuffer is missing", async () => {
    const file = makeFile("Okuyucu yolu", "fr.txt", "text/plain");
    Object.defineProperty(file, "arrayBuffer", { value: undefined });
    expect(await readScriptFile(file)).toBe("Okuyucu yolu");
  });
});

describe("readScriptFile: rejections", () => {
  it("rejects unsupported types with 'unsupported'", async () => {
    await expectCode(
      readScriptFile(makeFile("x", "a.pdf", "application/pdf")),
      "unsupported",
    );
    await expectCode(
      readScriptFile(makeFile("x", "a.doc", "application/msword")),
      "unsupported",
    );
    await expectCode(
      readScriptFile(makeFile("x", "a.html", "text/html")),
      "unsupported",
    );
    await expectCode(
      readScriptFile(makeFile("x", "a.png", "image/png")),
      "unsupported",
    );
    await expectCode(readScriptFile(makeFile("x", "noext", "")), "unsupported");
    await expectCode(
      readScriptFile(makeFile("x", "noext", "application/octet-stream")),
      "unsupported",
    );
  });

  it("rejects non-file input", async () => {
    await expectCode(readScriptFile(null as unknown as File), "unsupported");
    await expectCode(readScriptFile({} as unknown as File), "unsupported");
  });

  it("rejects files over 5 MB before reading them", async () => {
    const read = vi.fn(async () => new ArrayBuffer(0));
    await expectCode(
      readScriptFile(fakeFile("big.txt", MAX_SCRIPT_FILE_BYTES + 1, read)),
      "too-large",
    );
    expect(read).not.toHaveBeenCalled();
    await expectCode(
      readScriptFile(fakeFile("big.docx", MAX_SCRIPT_FILE_BYTES + 1, read, "")),
      "too-large",
    );
    expect(read).not.toHaveBeenCalled();
  });

  it("accepts a file of exactly 5 MB", async () => {
    const buf = new Uint8Array(MAX_SCRIPT_FILE_BYTES).fill(97).buffer;
    const text = await readScriptFile(
      fakeFile("max.txt", MAX_SCRIPT_FILE_BYTES, async () => buf),
    );
    expect(text.length).toBe(MAX_SCRIPT_FILE_BYTES);
  });

  it("maps read failures to 'read-failed'", async () => {
    const boom = fakeFile("a.txt", 10, async () => {
      throw new Error("disk gone");
    });
    await expectCode(readScriptFile(boom), "read-failed");
  });

  it("errors carry a stable code, a name and a short message", () => {
    const e = new PrompterFileError("too-large");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("PrompterFileError");
    expect(e.code).toBe("too-large");
    expect(e.message.length).toBeGreaterThan(0);
    expect(new PrompterFileError("read-failed", "özel").message).toBe("özel");
  });
});

describe("readScriptFile: .docx", () => {
  const docx = (name = "metin.docx", type = ""): File =>
    makeFile(bytes(0x50, 0x4b, 3, 4), name, type);

  it("extracts raw text through mammoth (lazy import)", async () => {
    mammothMock.extractRawText.mockResolvedValue({
      value: "Birinci paragraf\r\n\r\nİkinci paragraf",
      messages: [],
    });
    const text = await readScriptFile(docx());
    expect(text).toBe("Birinci paragraf\n\nİkinci paragraf");
    expect(mammothMock.extractRawText).toHaveBeenCalledTimes(1);
    const arg = mammothMock.extractRawText.mock.calls[0]?.[0] as {
      arrayBuffer: ArrayBuffer;
    };
    expect(Object.prototype.toString.call(arg.arrayBuffer)).toBe(
      "[object ArrayBuffer]",
    );
    expect(arg.arrayBuffer.byteLength).toBe(4);
  });

  it("detects docx by MIME type when the name has no extension", async () => {
    mammothMock.extractRawText.mockResolvedValue({ value: "x", messages: [] });
    const mime =
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    expect(await readScriptFile(docx("indirilen", mime))).toBe("x");
  });

  it("maps mammoth failures (corrupt document) to 'read-failed'", async () => {
    mammothMock.extractRawText.mockRejectedValue(
      new Error("Can't find end of central directory"),
    );
    await expectCode(readScriptFile(docx()), "read-failed");
  });

  it("treats a missing value as empty text", async () => {
    mammothMock.extractRawText.mockResolvedValue({ messages: [] });
    expect(await readScriptFile(docx())).toBe("");
  });

  it("rejects absurdly long extracted text", async () => {
    mammothMock.extractRawText.mockResolvedValue({
      value: "a".repeat(MAX_SCRIPT_FILE_BYTES + 1),
      messages: [],
    });
    await expectCode(readScriptFile(docx()), "too-large");
  });
});

describe("readClipboardText", () => {
  async function expectClipboardCode(code: string): Promise<void> {
    const err = await readClipboardText().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PrompterClipboardError);
    expect((err as PrompterClipboardError).code).toBe(code);
  }

  it("reads and normalises clipboard text", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { readText: async () => "A: bir\r\nB: iki" },
    });
    expect(await readClipboardText()).toBe("A: bir\nB: iki");
  });

  it("reports 'unsupported' without the Clipboard API", async () => {
    vi.stubGlobal("navigator", {});
    await expectClipboardCode("unsupported");
    vi.stubGlobal("navigator", { clipboard: {} });
    await expectClipboardCode("unsupported");
    vi.stubGlobal("navigator", undefined);
    await expectClipboardCode("unsupported");
  });

  it("reports 'permission-denied' when the user or browser refuses", async () => {
    for (const name of ["NotAllowedError", "SecurityError"]) {
      vi.stubGlobal("navigator", {
        clipboard: {
          readText: async () => {
            throw Object.assign(new Error("denied"), { name });
          },
        },
      });
      await expectClipboardCode("permission-denied");
    }
  });

  it("reports 'read-failed' for other errors and tolerates non-string results", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        readText: async () => {
          throw new Error("weird");
        },
      },
    });
    await expectClipboardCode("read-failed");
    vi.stubGlobal("navigator", { clipboard: { readText: async () => 42 } });
    expect(await readClipboardText()).toBe("");
  });

  it("caps very large clipboard contents", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        readText: async () => "x".repeat(MAX_SCRIPT_FILE_BYTES + 100),
      },
    });
    expect((await readClipboardText()).length).toBe(MAX_SCRIPT_FILE_BYTES);
  });

  it("clipboard errors carry code and name", () => {
    const e = new PrompterClipboardError("permission-denied");
    expect(e.code).toBe("permission-denied");
    expect(e.name).toBe("PrompterClipboardError");
  });
});
