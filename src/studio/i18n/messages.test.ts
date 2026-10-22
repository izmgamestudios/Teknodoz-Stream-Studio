import { describe, expect, it } from "vitest";

import {
  LANGS,
  MESSAGES,
  en,
  translate,
  tr,
  type MessageKey,
} from "./messages";

const keys = Object.keys(tr) as MessageKey[];
const placeholders = (s: string) =>
  [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

const SAME_EVERYWHERE = new Set<MessageKey>([
  "nav.classic",
  "nav.live.hint",
  "nav.download.hint",
  "nav.prompter.hint",
  "player.queue.playlist",
  "player.speed.normal",
  "lib.f.kind.video",
  "lib.f.kind.audio",
]);

describe("i18n messages", () => {
  it("English has every Turkish key and no extras", () => {
    expect(Object.keys(en).sort()).toEqual([...keys].sort());
  });

  it("no empty strings", () => {
    for (const lang of LANGS.map((l) => l.id)) {
      for (const k of keys)
        expect(MESSAGES[lang][k].trim(), `${lang}:${k}`).not.toBe("");
    }
  });

  it("every language has exactly the Turkish keys", () => {
    for (const l of LANGS)
      expect(Object.keys(MESSAGES[l.id]).sort(), l.id).toEqual(
        [...keys].sort(),
      );
  });

  it("placeholders match between languages", () => {
    for (const l of LANGS)
      for (const k of keys)
        expect(placeholders(MESSAGES[l.id][k]), `${l.id}:${k}`).toEqual(
          placeholders(tr[k]),
        );
  });

  it("German and Spanish are really translated, not copies of English", () => {
    for (const lang of ["de", "es"] as const) {
      const same = keys.filter(
        (k) =>
          MESSAGES[lang][k] === en[k] &&
          en[k].length > 12 &&
          // brand / platform names that are the same in every language
          !SAME_EVERYWHERE.has(k),
      );
      expect(same, lang).toEqual([]);
    }
  });

  it("translate interpolates and returns the key itself for unknown keys", () => {
    expect(translate("en", "remote.speed", { n: 42 })).toBe("Speed: 42 px/s");
    expect(translate("tr", "remote.speed", { n: 42 })).toBe("Hız: 42 px/sn");
    expect(translate("en", "nonexistent.key" as MessageKey)).toBe(
      "nonexistent.key",
    );
  });

  it("every dynamic key family used in the UI exists", () => {
    for (const s of [
      "connecting",
      "connected",
      "requesting",
      "waiting",
      "on-air",
      "rejected",
      "disconnected",
    ]) {
      expect(tr[`view.status.${s}` as MessageKey], s).toBeTruthy();
    }
    for (const r of ["guest", "viewer", "remote"]) {
      expect(tr[`room.role.${r}` as MessageKey], r).toBeTruthy();
      expect(tr[`room.role.${r}.hint` as MessageKey], r).toBeTruthy();
    }
    for (const e of [
      "rate-limited",
      "full",
      "closed",
      "not-found",
      "forbidden",
      "network",
    ]) {
      expect(tr[`room.err.${e}` as MessageKey], e).toBeTruthy();
    }
  });
});
