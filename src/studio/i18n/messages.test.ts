import { describe, expect, it } from "vitest";

import { MESSAGES, en, translate, tr, type MessageKey } from "./messages";

const keys = Object.keys(tr) as MessageKey[];
const placeholders = (s: string) =>
  [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("i18n messages", () => {
  it("English has every Turkish key and no extras", () => {
    expect(Object.keys(en).sort()).toEqual([...keys].sort());
  });

  it("no empty strings", () => {
    for (const lang of ["tr", "en"] as const) {
      for (const k of keys)
        expect(MESSAGES[lang][k].trim(), `${lang}:${k}`).not.toBe("");
    }
  });

  it("placeholders match between languages", () => {
    for (const k of keys)
      expect(placeholders(en[k]), k).toEqual(placeholders(tr[k]));
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
