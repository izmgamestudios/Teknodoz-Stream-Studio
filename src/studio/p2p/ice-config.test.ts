// src/studio/p2p/ice-config.test.ts
import { beforeEach, describe, expect, it } from "vitest";

import { buildIceServers } from "./rtc";
import {
  loadCustomIce,
  MAX_ICE_SERVERS,
  parseIceLines,
  saveIceText,
} from "./ice-config";

describe("parseIceLines", () => {
  it("parses stun and turn lines, skipping blanks and comments", () => {
    const r = parseIceLines(
      "# my relay\nstun:stun.example.org:3478\n\nturn:turn.example.org:3478|bob|s3cret",
    );
    expect(r.invalid).toEqual([]);
    expect(r.servers).toEqual([
      { urls: "stun:stun.example.org:3478" },
      {
        urls: "turn:turn.example.org:3478",
        username: "bob",
        credential: "s3cret",
      },
    ]);
  });

  it("rejects bad schemes, turn without credentials and overflow", () => {
    const r = parseIceLines(
      "http://x.example\nturn:t.example:3478\nturns:t.example:5349|u|p",
    );
    expect(r.invalid).toEqual([1, 2]);
    expect(r.servers).toHaveLength(1);
    const many = Array.from(
      { length: MAX_ICE_SERVERS + 2 },
      (_, i) => `stun:s${i}.example`,
    );
    expect(parseIceLines(many.join("\n")).servers).toHaveLength(
      MAX_ICE_SERVERS,
    );
  });

  it("keeps '|' inside the credential", () => {
    expect(parseIceLines("turn:t.example|u|a|b").servers[0]).toMatchObject({
      credential: "a|b",
    });
  });
});

describe("custom ICE storage", () => {
  beforeEach(() => localStorage.clear());

  it("flows into buildIceServers", () => {
    saveIceText("turn:t.example:3478|u|p");
    expect(loadCustomIce()).toHaveLength(1);
    expect(buildIceServers(false)).toEqual([
      { urls: "turn:t.example:3478", username: "u", credential: "p" },
    ]);
    expect(buildIceServers(true)).toHaveLength(2);
    saveIceText("");
    expect(buildIceServers(false)).toEqual([]);
  });
});
