import { describe, expect, it } from "vitest";
import { P2PError } from "./errors";
import {
  encodeMessage,
  MAX_MESSAGE_BYTES,
  parseHostMessage,
  parsePeerMessage,
  parseRemoteCommand,
  parseRemoteState,
  sanitizeName,
} from "./protocol";
import type {
  HostToPeer,
  PeerToHost,
  RemoteCommand,
  RemoteState,
} from "../types";

const STATE: RemoteState = {
  scenes: [
    { id: "sc_1", name: "Solo", hotkey: "1" },
    { id: "sc_2", name: "Mobil" },
  ],
  activeSceneId: "sc_1",
  recording: true,
  micMuted: false,
  prompterPlaying: true,
  prompterSpeed: 60,
  recordingMs: 12_345,
};

const HOST_MESSAGES: HostToPeer[] = [
  { type: "hello", peerId: "peer_abc" },
  { type: "guest-approved" },
  { type: "guest-on-air" },
  { type: "guest-off-air" },
  { type: "guest-rejected" },
  { type: "remote-state", state: STATE },
  { type: "sdp", description: { type: "offer", sdp: "v=0\r\n" } },
  { type: "sdp", description: { type: "answer", sdp: "v=0\r\n" } },
  {
    type: "ice",
    candidate: { candidate: "candidate:1 1 udp 1 1.2.3.4 5 typ host" },
  },
  {
    type: "ice",
    candidate: { candidate: "candidate:1", sdpMid: null, sdpMLineIndex: null },
  },
  { type: "ice", candidate: { candidate: "", sdpMid: "0", sdpMLineIndex: 0 } },
];

const COMMANDS: RemoteCommand[] = [
  { kind: "scene", id: "sc_1" },
  { kind: "scene-index", index: 0 },
  { kind: "prompter", action: "toggle" },
  { kind: "prompter", action: "speedUp" },
  { kind: "prompter", action: "speedDown" },
  { kind: "prompter", action: "rewind" },
  { kind: "mute" },
  { kind: "mute", value: true },
  { kind: "mute", value: false },
  { kind: "record", action: "toggle" },
  { kind: "record", action: "start" },
  { kind: "record", action: "stop" },
  { kind: "marker" },
];

const PEER_MESSAGES: PeerToHost[] = [
  { type: "role", role: "viewer", name: "Ayşe" },
  { type: "role", role: "guest", name: "" },
  { type: "role", role: "remote", name: "Telefon" },
  { type: "join-request", name: "Konuk 1" },
  ...COMMANDS.map((cmd): PeerToHost => ({ type: "remote-cmd", cmd })),
  { type: "sdp", description: { type: "offer", sdp: "v=0\r\n" } },
  { type: "ice", candidate: { candidate: "candidate:2" } },
];

describe("parseHostMessage", () => {
  it.each(HOST_MESSAGES.map((m, i) => [i, m] as const))(
    "accepts valid message #%i",
    (_i, msg) => {
      expect(parseHostMessage(JSON.stringify(msg))).toEqual(msg);
    },
  );

  it("returns null for non-string payloads", () => {
    for (const raw of [undefined, null, 42, {}, [], new ArrayBuffer(8), true]) {
      expect(parseHostMessage(raw)).toBeNull();
    }
  });

  it("returns null for empty, non-JSON and non-object JSON", () => {
    for (const raw of [
      "",
      "not json",
      "{",
      "null",
      "[]",
      '"hello"',
      "42",
      "true",
    ]) {
      expect(parseHostMessage(raw)).toBeNull();
    }
  });

  it("rejects unknown message types and peer-only types", () => {
    expect(parseHostMessage('{"type":"nope"}')).toBeNull();
    expect(parseHostMessage('{"type":"join-request","name":"x"}')).toBeNull();
    expect(
      parseHostMessage('{"type":"remote-cmd","cmd":{"kind":"marker"}}'),
    ).toBeNull();
    expect(parseHostMessage("{}")).toBeNull();
  });

  it("rejects unknown keys (strict objects)", () => {
    expect(parseHostMessage('{"type":"guest-approved","extra":1}')).toBeNull();
    expect(
      parseHostMessage('{"type":"hello","peerId":"a","x":true}'),
    ).toBeNull();
    const withExtraState = JSON.stringify({
      type: "remote-state",
      state: { ...STATE, extra: 1 },
    });
    expect(parseHostMessage(withExtraState)).toBeNull();
    const withExtraScene = JSON.stringify({
      type: "remote-state",
      state: { ...STATE, scenes: [{ id: "a", name: "b", evil: 1 }] },
    });
    expect(parseHostMessage(withExtraScene)).toBeNull();
  });

  it("is immune to prototype pollution payloads", () => {
    const attempts = [
      '{"type":"hello","peerId":"a","__proto__":{"polluted":true}}',
      '{"__proto__":{"polluted":true},"type":"guest-on-air"}',
      '{"type":"guest-on-air","constructor":{"prototype":{"polluted":true}}}',
      '{"type":"remote-state","state":{"__proto__":{"polluted":true}}}',
    ];
    for (const raw of attempts) expect(parseHostMessage(raw)).toBeNull();
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(
      (Object.prototype as Record<string, unknown>)["polluted"],
    ).toBeUndefined();
  });

  it("rejects wrong field types and out-of-range values", () => {
    expect(parseHostMessage('{"type":"hello","peerId":42}')).toBeNull();
    expect(parseHostMessage('{"type":"hello","peerId":""}')).toBeNull();
    expect(
      parseHostMessage(
        JSON.stringify({ type: "hello", peerId: "x".repeat(129) }),
      ),
    ).toBeNull();
    const bad = (patch: Record<string, unknown>) =>
      parseHostMessage(
        JSON.stringify({ type: "remote-state", state: { ...STATE, ...patch } }),
      );
    expect(bad({ recording: "yes" })).toBeNull();
    expect(bad({ prompterSpeed: null })).toBeNull(); // NaN/Infinity serialise to null
    expect(bad({ recordingMs: -1 })).toBeNull();
    expect(bad({ scenes: "nope" })).toBeNull();
    expect(bad({ activeSceneId: 1 })).toBeNull();
    expect(
      bad({
        scenes: Array.from({ length: 257 }, (_, i) => ({
          id: `s${i}`,
          name: "n",
        })),
      }),
    ).toBeNull();
    expect(bad({ scenes: [{ id: "", name: "n" }] })).toBeNull();
    expect(bad({ scenes: [{ id: "a", name: "n".repeat(201) }] })).toBeNull();
  });

  it("bounds sdp / ice payloads", () => {
    const sdp = (text: string) =>
      parseHostMessage(
        JSON.stringify({
          type: "sdp",
          description: { type: "offer", sdp: text },
        }),
      );
    expect(sdp("v=0")).not.toBeNull();
    expect(sdp("")).toBeNull();
    expect(sdp("x".repeat(32 * 1024 + 1))).toBeNull();
    expect(
      parseHostMessage(
        JSON.stringify({
          type: "sdp",
          description: { type: "rollback", sdp: "v=0" },
        }),
      ),
    ).toBeNull();
    const ice = (candidate: Record<string, unknown>) =>
      parseHostMessage(JSON.stringify({ type: "ice", candidate }));
    expect(ice({ candidate: "x".repeat(2049) })).toBeNull();
    expect(ice({ candidate: "c", sdpMLineIndex: -1 })).toBeNull();
    expect(ice({ candidate: "c", sdpMLineIndex: 1.5 })).toBeNull();
    expect(ice({ candidate: "c", sdpMid: 5 })).toBeNull();
    expect(ice({ candidate: "c", foo: 1 })).toBeNull();
  });

  it("enforces the 64 KB limit in UTF-8 bytes, not characters", () => {
    // 32k euro signs: 32768 chars (<= schema limit) but ~96 KB of UTF-8
    const heavy = JSON.stringify({
      type: "sdp",
      description: { type: "offer", sdp: "€".repeat(32 * 1024) },
    });
    expect(heavy.length).toBeLessThan(MAX_MESSAGE_BYTES);
    expect(parseHostMessage(heavy)).toBeNull();
    // the same shape in ASCII fits
    const light = JSON.stringify({
      type: "sdp",
      description: { type: "offer", sdp: "a".repeat(30 * 1024) },
    });
    expect(light.length).toBeLessThan(MAX_MESSAGE_BYTES);
    expect(parseHostMessage(light)).not.toBeNull();
    // and a raw payload above the cap is dropped before JSON.parse
    expect(
      parseHostMessage(
        " ".repeat(MAX_MESSAGE_BYTES + 1) + '{"type":"guest-on-air"}',
      ),
    ).toBeNull();
  });
});

describe("parsePeerMessage", () => {
  it.each(PEER_MESSAGES.map((m, i) => [i, m] as const))(
    "accepts valid message #%i",
    (_i, msg) => {
      expect(parsePeerMessage(JSON.stringify(msg))).toEqual(msg);
    },
  );

  it("rejects host-only types and malformed input", () => {
    expect(parsePeerMessage('{"type":"hello","peerId":"a"}')).toBeNull();
    expect(parsePeerMessage('{"type":"guest-on-air"}')).toBeNull();
    expect(parsePeerMessage('{"type":"remote-state","state":{}}')).toBeNull();
    expect(parsePeerMessage("garbage")).toBeNull();
    expect(parsePeerMessage(undefined)).toBeNull();
    expect(parsePeerMessage(new Uint8Array(4))).toBeNull();
  });

  it("validates roles and names", () => {
    expect(
      parsePeerMessage('{"type":"role","role":"admin","name":"x"}'),
    ).toBeNull();
    expect(parsePeerMessage('{"type":"role","role":"guest"}')).toBeNull();
    expect(parsePeerMessage('{"type":"join-request","name":5}')).toBeNull();
    expect(
      parsePeerMessage(
        JSON.stringify({ type: "join-request", name: "n".repeat(81) }),
      ),
    ).toBeNull();
    expect(
      parsePeerMessage(
        JSON.stringify({ type: "join-request", name: "n".repeat(80) }),
      ),
    ).not.toBeNull();
  });

  it("validates every remote command shape", () => {
    const cmd = (c: unknown) =>
      parsePeerMessage(JSON.stringify({ type: "remote-cmd", cmd: c }));
    expect(cmd({ kind: "scene" })).toBeNull();
    expect(cmd({ kind: "scene", id: "" })).toBeNull();
    expect(cmd({ kind: "scene", id: 5 })).toBeNull();
    expect(cmd({ kind: "scene-index", index: -1 })).toBeNull();
    expect(cmd({ kind: "scene-index", index: 1.5 })).toBeNull();
    expect(cmd({ kind: "scene-index", index: 5000 })).toBeNull();
    expect(cmd({ kind: "scene-index", index: "1" })).toBeNull();
    expect(cmd({ kind: "prompter", action: "explode" })).toBeNull();
    expect(cmd({ kind: "prompter" })).toBeNull();
    expect(cmd({ kind: "mute", value: "true" })).toBeNull();
    expect(cmd({ kind: "record", action: "pause" })).toBeNull();
    expect(cmd({ kind: "marker", extra: 1 })).toBeNull();
    expect(cmd({ kind: "shell", cmd: "rm -rf" })).toBeNull();
    expect(cmd({})).toBeNull();
    expect(cmd(null)).toBeNull();
    expect(cmd("marker")).toBeNull();
  });

  it("rejects prototype pollution inside commands", () => {
    expect(
      parsePeerMessage(
        '{"type":"remote-cmd","cmd":{"kind":"marker","__proto__":{"x":1}}}',
      ),
    ).toBeNull();
    expect(
      parsePeerMessage(
        '{"type":"remote-cmd","__proto__":{"x":1},"cmd":{"kind":"marker"}}',
      ),
    ).toBeNull();
  });
});

describe("parseRemoteCommand / parseRemoteState", () => {
  it("validate already-parsed values", () => {
    for (const cmd of COMMANDS) expect(parseRemoteCommand(cmd)).toEqual(cmd);
    expect(parseRemoteCommand({ kind: "scene-index", index: -3 })).toBeNull();
    expect(parseRemoteCommand(undefined)).toBeNull();
    expect(parseRemoteState(STATE)).toEqual(STATE);
    expect(parseRemoteState({ ...STATE, scenes: null })).toBeNull();
  });
});

describe("encodeMessage", () => {
  it("round-trips through the parsers", () => {
    for (const msg of HOST_MESSAGES)
      expect(parseHostMessage(encodeMessage(msg))).toEqual(msg);
    for (const msg of PEER_MESSAGES)
      expect(parsePeerMessage(encodeMessage(msg))).toEqual(msg);
  });

  it("refuses messages above the size limit with a typed error", () => {
    const huge: HostToPeer = {
      type: "remote-state",
      state: {
        ...STATE,
        scenes: Array.from({ length: 256 }, (_, i) => ({
          id: `s${i}`,
          name: "€".repeat(200),
        })),
      },
    };
    let caught: unknown;
    try {
      encodeMessage(huge);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(P2PError);
    expect((caught as P2PError).code).toBe("too-large");
  });
});

// invisible characters spelled out so the source stays readable
const RLO = String.fromCharCode(0x202e); // right-to-left override
const ZWSP = String.fromCharCode(0x200b); // zero-width space
const BOM = String.fromCharCode(0xfeff);

describe("sanitizeName", () => {
  it("passes normal names through", () => {
    expect(sanitizeName("Ayşe Yılmaz")).toBe("Ayşe Yılmaz");
    expect(sanitizeName("  padded  ")).toBe("padded");
  });

  it("strips control, zero-width and bidi override characters", () => {
    expect(sanitizeName("a\u0000b\u0007c")).toBe("a b c");
    expect(sanitizeName(`evil${RLO}txt.exe`)).toBe("evil txt.exe");
    expect(sanitizeName(`zero${ZWSP}width`)).toBe("zero width");
    expect(sanitizeName(`${BOM}bom`)).toBe("bom");
    expect(sanitizeName("line1\nline2\tx")).toBe("line1 line2 x");
  });

  it("collapses whitespace and clamps to 40 code points", () => {
    expect(sanitizeName("a    b")).toBe("a b");
    expect(sanitizeName("x".repeat(100))).toHaveLength(40);
    // emoji are one code point each; never split a surrogate pair
    const clamped = sanitizeName("😀".repeat(100));
    expect(Array.from(clamped)).toHaveLength(40);
    expect(clamped).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  });

  it("uses the fallback for empty, blank or non-string input", () => {
    expect(sanitizeName("", "Konuk 1")).toBe("Konuk 1");
    expect(sanitizeName(`   ${ZWSP}  `, "Konuk 1")).toBe("Konuk 1");
    expect(sanitizeName(undefined, "fb")).toBe("fb");
    expect(sanitizeName(42, "fb")).toBe("fb");
    expect(sanitizeName(null)).toBe("");
  });
});
