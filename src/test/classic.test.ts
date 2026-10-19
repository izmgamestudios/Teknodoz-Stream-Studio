import { describe, expect, it } from "vitest";

import { isMsg, isRoomId, newRoomId } from "@/classic/remote/protocol";
import { TRACKS } from "@/studio/engine/music";
import { SFX_PRESETS } from "@/studio/engine/sfx-presets";
import { TEMPLATES } from "@/classic/studio/templates";

describe("remote protocol", () => {
  it("generates room ids that pass validation", () => {
    for (let i = 0; i < 20; i++) expect(isRoomId(newRoomId())).toBe(true);
  });
  it("rejects malformed room ids", () => {
    for (const bad of ["", null, undefined, "tkd-", "tkd-ABCDEFGH", "room-12345678", "tkd-1234567890"])
      expect(isRoomId(bad)).toBe(false);
  });
  it("only accepts known message shapes", () => {
    expect(isMsg({ t: "cmd", cmd: "next" })).toBe(true);
    expect(isMsg({ t: "state", state: { page: "idle" } })).toBe(true);
    expect(isMsg({ t: "other" })).toBe(false);
    expect(isMsg(null)).toBe(false);
    expect(isMsg("cmd")).toBe(false);
  });
});

describe("studio libraries", () => {
  it("has unique ids for tracks, sfx and templates", () => {
    for (const list of [TRACKS, SFX_PRESETS, TEMPLATES]) {
      const ids = list.map((x) => x.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
  it("tracks have 4-note chords and a sane tempo", () => {
    for (const t of TRACKS) {
      expect(t.chords.length).toBeGreaterThan(0);
      for (const c of t.chords) expect(c.length).toBe(4);
      expect(t.bpm).toBeGreaterThan(40);
    }
  });
  it("templates build fresh scenes with unique item ids", () => {
    for (const t of TEMPLATES) {
      const a = t.build(), b = t.build();
      expect(a).not.toBe(b);
      expect(new Set(a.items.map((i) => i.id)).size).toBe(a.items.length);
    }
  });
});
