import { afterEach, describe, expect, it, vi } from "vitest";
import { P2PError } from "./errors";
import {
  buildJoinUrl,
  buildRemoteUrl,
  CODE_PREFIX,
  CODE_PREFIX_PLAIN,
  decodeSignal,
  encodeSignal,
  extractCode,
  isCompressionSupported,
  isSignalError,
  MAX_CODE_LENGTH,
  parseFragment,
  SignalError,
  waitForIceGathering,
  type IceGatheringTarget,
  type SignalPayload,
} from "./signaling";

/* ---------------- helpers: an independent implementation of the wire format ---------------- */

const te = new TextEncoder();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++)
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function transform(
  stream: {
    writable: WritableStream<BufferSource>;
    readable: ReadableStream<Uint8Array>;
  },
  input: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const writer = stream.writable.getWriter();
  const reading = (async () => {
    const chunks: Uint8Array[] = [];
    const reader = stream.readable.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  })();
  await writer.write(input);
  await writer.close();
  return reading;
}

function deflateRaw(
  input: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  return transform(new CompressionStream("deflate-raw"), input);
}

/** Frame already-prepared body bytes exactly like encodeSignal: prefix + b64url(body + crc32). */
function frame(body: Uint8Array<ArrayBuffer>, prefix: string): string {
  const out = new Uint8Array(body.length + 4);
  out.set(body, 0);
  new DataView(out.buffer).setUint32(body.length, crc32(body), false);
  return prefix + b64url(out);
}

async function forge(value: unknown, compress = true): Promise<string> {
  const raw = te.encode(
    typeof value === "string" ? value : JSON.stringify(value),
  );
  return compress
    ? frame(await deflateRaw(raw), CODE_PREFIX)
    : frame(raw, CODE_PREFIX_PLAIN);
}

/** A Chrome-like SDP with audio + video + data channel (~4.5 KB), to check realistic sizes. */
function bigSdp(): string {
  const lines = [
    "v=0",
    "o=- 4611731400430051336 2 IN IP4 127.0.0.1",
    "s=-",
    "t=0 0",
    "a=group:BUNDLE 0 1 2",
    "a=extmap-allow-mixed",
    "a=msid-semantic: WMS",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111 63 9 0 8 13 110 126",
    "c=IN IP4 0.0.0.0",
    "a=rtcp:9 IN IP4 0.0.0.0",
    "a=candidate:842163049 1 udp 1677729535 203.0.113.7 54321 typ srflx raddr 192.168.1.5 rport 54321 generation 0 network-cost 999",
    "a=candidate:2999745851 1 udp 2113937151 192.168.1.5 54321 typ host generation 0 network-cost 999",
    "a=ice-ufrag:abcd",
    "a=ice-pwd:0123456789abcdefghijklmn",
    "a=ice-options:trickle",
    "a=fingerprint:sha-256 " +
      Array.from({ length: 32 }, (_, i) =>
        (i * 7 + 11).toString(16).padStart(2, "0").toUpperCase(),
      ).join(":"),
    "a=setup:actpass",
    "a=mid:0",
    "a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level",
    "a=extmap:2 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time",
    "a=extmap:3 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01",
    "a=extmap:4 urn:ietf:params:rtp-hdrext:sdes:mid",
    "a=sendrecv",
    "a=rtcp-mux",
    "a=rtpmap:111 opus/48000/2",
    "a=rtcp-fb:111 transport-cc",
    "a=fmtp:111 minptime=10;useinbandfec=1",
    "a=rtpmap:63 red/48000/2",
    "a=fmtp:63 111/111",
    "a=rtpmap:9 G722/8000",
    "a=rtpmap:0 PCMU/8000",
    "a=rtpmap:8 PCMA/8000",
    "a=rtpmap:13 CN/8000",
    "a=rtpmap:110 telephone-event/48000",
    "a=rtpmap:126 telephone-event/8000",
  ];
  const videoPts = Array.from({ length: 24 }, (_, i) => 96 + i);
  lines.push(
    `m=video 9 UDP/TLS/RTP/SAVPF ${videoPts.join(" ")}`,
    "c=IN IP4 0.0.0.0",
    "a=mid:1",
    "a=sendrecv",
  );
  for (const pt of videoPts) {
    lines.push(`a=rtpmap:${pt} ${pt % 2 ? "rtx/90000" : "VP8/90000"}`);
    lines.push(`a=rtcp-fb:${pt} goog-remb`, `a=rtcp-fb:${pt} transport-cc`);
    lines.push(
      `a=rtcp-fb:${pt} ccm fir`,
      `a=rtcp-fb:${pt} nack`,
      `a=rtcp-fb:${pt} nack pli`,
    );
    lines.push(
      `a=fmtp:${pt} level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f`,
    );
  }
  lines.push(
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
    "a=mid:2",
    "a=sctp-port:5000",
  );
  return lines.join("\r\n") + "\r\n";
}

const SDP =
  "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
});

/* ---------------- codec ---------------- */

describe("encodeSignal / decodeSignal", () => {
  it("round-trips offers and answers (compressed)", async () => {
    expect(isCompressionSupported()).toBe(true);
    const payload: SignalPayload = {
      v: 1,
      type: "offer",
      role: "guest",
      sdp: SDP,
    };
    const code = await encodeSignal(payload);
    expect(code.startsWith(CODE_PREFIX)).toBe(true);
    expect(code).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(await decodeSignal(code)).toEqual(payload);
    const answer = await encodeSignal({ v: 1, type: "answer", sdp: SDP });
    expect(await decodeSignal(answer)).toEqual({
      v: 1,
      type: "answer",
      sdp: SDP,
    });
  });

  it("keeps optional fields absent when they were not provided", async () => {
    const decoded = await decodeSignal(await encodeSignal({ sdp: SDP }));
    expect(decoded).toEqual({ v: 1, sdp: SDP });
    expect("role" in decoded).toBe(false);
    expect("type" in decoded).toBe(false);
  });

  it("round-trips unicode and long lines intact", async () => {
    const sdp =
      SDP +
      "a=msid-semantic: WMS ç ğ ı ö ş ü 😀\r\n" +
      "a=x:" +
      "y".repeat(5000) +
      "\r\n";
    const decoded = await decodeSignal(await encodeSignal({ sdp }));
    expect(decoded.sdp).toBe(sdp);
  });

  it("supports the plain fallback form", async () => {
    const code = await encodeSignal(
      { type: "offer", role: "viewer", sdp: SDP },
      { compress: false },
    );
    expect(code.startsWith(CODE_PREFIX_PLAIN)).toBe(true);
    expect(await decodeSignal(code)).toEqual({
      v: 1,
      type: "offer",
      role: "viewer",
      sdp: SDP,
    });
  });

  it("keeps a realistic Chrome SDP small", async () => {
    const sdp = bigSdp();
    expect(sdp.length).toBeGreaterThan(4000);
    const code = await encodeSignal({ type: "offer", role: "guest", sdp });
    expect(await decodeSignal(code)).toMatchObject({ sdp });
    // comfortably smaller than the raw SDP and well under what a QR / chat message can carry
    expect(code.length).toBeLessThan(sdp.length * 0.45);
    expect(code.length).toBeLessThan(2000);
  });

  it("tolerates whitespace, newlines, quotes and pasted links", async () => {
    const code = await encodeSignal({
      type: "offer",
      role: "viewer",
      sdp: SDP,
    });
    const wrapped = code.replace(/(.{40})/g, "$1\n");
    expect((await decodeSignal(wrapped)).sdp).toBe(SDP);
    expect((await decodeSignal(`  ${code}\r\n`)).sdp).toBe(SDP);
    expect((await decodeSignal(`"${code}"`)).sdp).toBe(SDP);
    expect(
      (await decodeSignal(`https://studio.example/join#c=${code}`)).sdp,
    ).toBe(SDP);
    expect(
      (await decodeSignal(`http://localhost:3000/remote#foo=1&c=${code}`)).sdp,
    ).toBe(SDP);
  });
});

describe("decodeSignal: rejects bad input with SignalError codes", () => {
  const codeOf = async (input: string): Promise<string> => {
    try {
      await decodeSignal(input);
    } catch (error) {
      expect(isSignalError(error)).toBe(true);
      expect(error).toBeInstanceOf(SignalError);
      expect(error).toBeInstanceOf(P2PError);
      return (error as SignalError).code;
    }
    return "no-error";
  };

  it("bad-prefix", async () => {
    for (const input of [
      "",
      "   ",
      "hello",
      "TKZ.abc",
      "tkz1.abc",
      "TKZ1",
      "abc.def",
      "{}",
    ]) {
      expect(await codeOf(input)).toBe("bad-prefix");
    }
  });

  it("version: other prefix versions and other payload versions", async () => {
    expect(await codeOf("TKZ2.abcdef")).toBe("version");
    expect(await codeOf("TKZ12.abcdef")).toBe("version");
    expect(await codeOf("TKZ2u.abcdef")).toBe("version");
    expect(await codeOf(await forge({ v: 2, sdp: SDP }))).toBe("version");
    expect(await codeOf(await forge({ v: 0, sdp: SDP }, false))).toBe(
      "version",
    );
  });

  it("corrupt: tampering is caught by the checksum", async () => {
    const code = await encodeSignal({
      type: "offer",
      role: "guest",
      sdp: bigSdp(),
    });
    // flip single characters at many positions (not the final char, which may be padding bits)
    for (const pos of [
      CODE_PREFIX.length,
      20,
      100,
      400,
      Math.floor(code.length / 2),
      code.length - 3,
    ]) {
      const original = code.charAt(pos);
      const replacement = original === "A" ? "B" : "A";
      const tampered = code.slice(0, pos) + replacement + code.slice(pos + 1);
      expect(await codeOf(tampered)).toBe("corrupt");
    }
  });

  it("corrupt: truncated, extended or malformed bodies", async () => {
    const code = await encodeSignal({ type: "offer", sdp: SDP });
    expect(await codeOf(code.slice(0, code.length - 10))).toBe("corrupt");
    expect(await codeOf(code.slice(0, 30))).toBe("corrupt");
    expect(await codeOf(CODE_PREFIX)).toBe("corrupt");
    expect(await codeOf(CODE_PREFIX_PLAIN)).toBe("corrupt");
    expect(await codeOf(code + "AAAA")).toBe("corrupt");
    expect(await codeOf(`${CODE_PREFIX}***`)).toBe("corrupt");
    expect(await codeOf(`${CODE_PREFIX}A`)).toBe("corrupt"); // impossible base64 length
    expect(await codeOf(`${CODE_PREFIX}AAAAAAAA`)).toBe("corrupt"); // bad checksum
  });

  it("corrupt: valid checksum but garbage payload", async () => {
    // not a deflate stream
    expect(
      await codeOf(
        frame(te.encode("this is not deflate data at all"), CODE_PREFIX),
      ),
    ).toBe("corrupt");
    // deflate of non-JSON
    expect(await codeOf(await forge("not json {"))).toBe("corrupt");
    // plain, invalid UTF-8
    expect(
      await codeOf(
        frame(new Uint8Array([0xff, 0xfe, 0xfd, 0x80]), CODE_PREFIX_PLAIN),
      ),
    ).toBe("corrupt");
    // JSON but wrong shape
    for (const value of [
      [],
      "str",
      5,
      null,
      { v: 1 },
      { v: 1, sdp: 5 },
      { sdp: SDP },
    ]) {
      expect(await codeOf(await forge(value))).toBe("corrupt");
    }
  });

  it("corrupt: strict schema rejects unknown keys, bad enums and prototype pollution", async () => {
    expect(await codeOf(await forge({ v: 1, sdp: SDP, admin: true }))).toBe(
      "corrupt",
    );
    expect(await codeOf(await forge({ v: 1, sdp: SDP, role: "root" }))).toBe(
      "corrupt",
    );
    expect(
      await codeOf(await forge({ v: 1, sdp: SDP, type: "rollback" })),
    ).toBe("corrupt");
    expect(
      await codeOf(
        await forge(
          `{"v":1,"sdp":${JSON.stringify(SDP)},"__proto__":{"polluted":true}}`,
        ),
      ),
    ).toBe("corrupt");
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("corrupt: the sdp must look like an SDP", async () => {
    expect(await codeOf(await forge({ v: 1, sdp: "hello world" }))).toBe(
      "corrupt",
    );
    expect(await codeOf(await forge({ v: 1, sdp: "" }))).toBe("corrupt");
  });

  it("too-large: oversized input, SDP, line count and media section count", async () => {
    expect(await codeOf("TKZ1." + "A".repeat(MAX_CODE_LENGTH + 1))).toBe(
      "too-large",
    );
    expect(await codeOf("x".repeat(MAX_CODE_LENGTH * 2 + 1))).toBe("too-large");
    expect(
      await codeOf(
        await forge({ v: 1, sdp: "v=0\r\n" + "a=x\r\n".repeat(6000) }),
      ),
    ).toBe("too-large");
    expect(
      await codeOf(
        await forge({ v: 1, sdp: "v=0\r\n" + "a=x\r\n".repeat(10_000) }),
      ),
    ).toBe("too-large");
    expect(
      await codeOf(
        await forge({
          v: 1,
          sdp: "v=0\r\n" + "m=audio 9 RTP/AVP 0\r\n".repeat(9),
        }),
      ),
    ).toBe("too-large");
    expect(
      await codeOf(await forge({ v: 1, sdp: "v=0\r\n" + "a".repeat(40_000) })),
    ).toBe("too-large");
  });

  it("too-large: decompression bombs are cut off", async () => {
    // ~10 MB of zeros deflates to ~10 KB: small enough to pass the code-length cap
    const bomb = await deflateRaw(new Uint8Array(10 * 1024 * 1024));
    const code = frame(bomb, CODE_PREFIX);
    expect(code.length).toBeLessThan(MAX_CODE_LENGTH);
    expect(await codeOf(code)).toBe("too-large");
  });

  it("rejects non-string input", async () => {
    expect(await codeOf(undefined as unknown as string)).toBe("corrupt");
    expect(await codeOf(42 as unknown as string)).toBe("corrupt");
  });
});

describe("encodeSignal: limits", () => {
  it("rejects oversized or non-SDP payloads", async () => {
    await expect(
      encodeSignal({ sdp: "v=0\r\n" + "a".repeat(40_000) }),
    ).rejects.toMatchObject({
      code: "too-large",
    });
    await expect(encodeSignal({ sdp: "nope" })).rejects.toMatchObject({
      code: "corrupt",
    });
    await expect(encodeSignal({ sdp: "" })).rejects.toMatchObject({
      code: "corrupt",
    });
  });
});

describe("runtime without CompressionStream", () => {
  it("encodes plain and refuses to read compressed codes with a typed error", async () => {
    const compressed = await encodeSignal({ type: "offer", sdp: SDP });
    vi.resetModules();
    vi.stubGlobal("CompressionStream", undefined);
    vi.stubGlobal("DecompressionStream", undefined);
    const fresh = await import("./signaling");
    expect(fresh.isCompressionSupported()).toBe(false);
    const plain = await fresh.encodeSignal({ type: "offer", sdp: SDP });
    expect(plain.startsWith(fresh.CODE_PREFIX_PLAIN)).toBe(true);
    expect((await fresh.decodeSignal(plain)).sdp).toBe(SDP);
    await expect(fresh.decodeSignal(compressed)).rejects.toMatchObject({
      code: "unsupported",
    });
  });
});

describe("extractCode", () => {
  it("returns the bare code", () => {
    expect(extractCode("  TKZ1.abc_-def \n")).toBe("TKZ1.abc_-def");
    expect(extractCode("TKZ1.ab cd\nef")).toBe("TKZ1.abcdef");
    expect(extractCode("https://x.y/join#c=TKZ1.abc")).toBe("TKZ1.abc");
  });
});

/* ---------------- ICE gathering ---------------- */

function iceTarget(initial: RTCIceGatheringState) {
  let state = initial;
  const listeners = new Set<() => void>();
  const target: IceGatheringTarget & {
    set(next: RTCIceGatheringState): void;
    listeners: Set<() => void>;
  } = {
    get iceGatheringState() {
      return state;
    },
    addEventListener: (_type, listener) => void listeners.add(listener),
    removeEventListener: (_type, listener) => void listeners.delete(listener),
    set(next) {
      state = next;
      for (const l of [...listeners]) l();
    },
    listeners,
  };
  return target;
}

describe("waitForIceGathering", () => {
  it("resolves immediately when already complete", async () => {
    const t = iceTarget("complete");
    await expect(waitForIceGathering(t, 50)).resolves.toBe(true);
    expect(t.listeners.size).toBe(0);
  });

  it("resolves true when gathering completes and cleans up its listener", async () => {
    const t = iceTarget("gathering");
    const p = waitForIceGathering(t, 5000);
    expect(t.listeners.size).toBe(1);
    t.set("gathering"); // unrelated change: keep waiting
    expect(t.listeners.size).toBe(1);
    t.set("complete");
    await expect(p).resolves.toBe(true);
    expect(t.listeners.size).toBe(0);
  });

  it("resolves false on timeout (partial candidates are still usable)", async () => {
    vi.useFakeTimers();
    const t = iceTarget("gathering");
    const p = waitForIceGathering(t, 4000);
    vi.advanceTimersByTime(3999);
    expect(t.listeners.size).toBe(1);
    vi.advanceTimersByTime(1);
    await expect(p).resolves.toBe(false);
    expect(t.listeners.size).toBe(0);
    t.set("complete"); // late event must not throw or re-resolve
  });

  it("falls back to the default budget for invalid timeouts", async () => {
    vi.useFakeTimers();
    const t = iceTarget("gathering");
    const p = waitForIceGathering(t, Number.NaN);
    vi.advanceTimersByTime(3999);
    expect(t.listeners.size).toBe(1);
    vi.advanceTimersByTime(1);
    await expect(p).resolves.toBe(false);
  });
});

/* ---------------- URL helpers ---------------- */

describe("URL helpers", () => {
  it("builds fragment links", () => {
    expect(buildJoinUrl("https://studio.example", "TKZ1.abc")).toBe(
      "https://studio.example/join#c=TKZ1.abc",
    );
    expect(buildRemoteUrl("https://studio.example", "TKZ1.abc")).toBe(
      "https://studio.example/remote#c=TKZ1.abc",
    );
    expect(buildJoinUrl("http://localhost:3000/", "TKZ1.abc")).toBe(
      "http://localhost:3000/join#c=TKZ1.abc",
    );
    expect(buildJoinUrl("", "TKZ1.abc")).toBe("/join#c=TKZ1.abc");
  });

  it("puts the code in the fragment, never the query or path", () => {
    const url = new URL(buildJoinUrl("https://studio.example", "TKZ1.abc_-9"));
    expect(url.search).toBe("");
    expect(url.pathname).toBe("/join");
    expect(url.hash).toBe("#c=TKZ1.abc_-9");
  });

  it("refuses codes that are not URL-safe", () => {
    for (const bad of ["", "a b", "a&b=c", "a#b", "a/b", "ünï", "a%20b"]) {
      expect(() => buildJoinUrl("https://x.y", bad)).toThrow(SignalError);
      expect(() => buildRemoteUrl("https://x.y", bad)).toThrow(SignalError);
    }
    expect(() =>
      buildJoinUrl("https://x.y", "A".repeat(MAX_CODE_LENGTH + 1)),
    ).toThrow(SignalError);
  });

  it("parseFragment reads the c parameter", () => {
    expect(parseFragment("#c=TKZ1.abc")).toBe("TKZ1.abc");
    expect(parseFragment("c=TKZ1.abc")).toBe("TKZ1.abc");
    expect(parseFragment("#x=1&c=TKZ1.abc&y=2")).toBe("TKZ1.abc");
  });

  it("parseFragment returns null for anything else", () => {
    for (const hash of [
      "",
      "#",
      "#c=",
      "#d=TKZ1.abc",
      "#c=a b",
      "#c=a%20b",
      "#c=<script>",
      "#c=a+b",
    ]) {
      expect(parseFragment(hash)).toBeNull();
    }
    expect(parseFragment(`#c=${"A".repeat(MAX_CODE_LENGTH + 1)}`)).toBeNull();
    expect(parseFragment(undefined as unknown as string)).toBeNull();
  });

  it("join links decode end to end", async () => {
    const code = await encodeSignal({
      type: "offer",
      role: "remote",
      sdp: SDP,
    });
    const url = buildRemoteUrl("https://studio.example", code);
    const fromHash = parseFragment(new URL(url).hash);
    expect(fromHash).toBe(code);
    expect(await decodeSignal(fromHash as string)).toMatchObject({
      role: "remote",
      sdp: SDP,
    });
  });
});
