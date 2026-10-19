import { describe, expect, it } from "vitest";

import {
  iframeSandbox,
  isMixedContentBlocked,
  likelyBlocksEmbedding,
  MAX_URL_LENGTH,
  normalizePrototypeUrl,
} from "./url";

describe("normalizePrototypeUrl", () => {
  it("adds https to bare hosts and keeps paths", () => {
    expect(normalizePrototypeUrl("example.com/app?x=1")).toEqual({
      ok: true,
      url: "https://example.com/app?x=1",
      host: "example.com",
    });
  });
  it("accepts localhost:port and explicit http", () => {
    expect(normalizePrototypeUrl("localhost:3000")).toMatchObject({
      ok: true,
      host: "localhost:3000",
    });
    expect(normalizePrototypeUrl("http://192.168.1.5:5173/x")).toMatchObject({
      ok: true,
    });
    expect(normalizePrototypeUrl("//cdn.example.com/a")).toMatchObject({
      ok: true,
    });
  });
  it.each([
    ["javascript:alert(1)", "protocol"],
    ["data:text/html,<script>1</script>", "protocol"],
    ["file:///etc/passwd", "protocol"],
    ["blob:https://x.com/1", "protocol"],
    ["ftp://example.com", "protocol"],
    ["https://user:pw@example.com", "credentials"],
    ["https://user@example.com", "credentials"],
    ["", "empty"],
    ["   ", "empty"],
    ["http://", "invalid"],
  ])("rejects %s", (input, reason) => {
    const r = normalizePrototypeUrl(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(reason);
  });
  it("rejects over-long URLs and strips control/zero-width chars", () => {
    const r = normalizePrototypeUrl(
      `https://a.com/${"x".repeat(MAX_URL_LENGTH)}`,
    );
    expect(!r.ok && r.reason).toBe("too-long");
    const c = normalizePrototypeUrl("ex​ample\u0000.com");
    expect(c).toMatchObject({ ok: true, host: "example.com" });
  });
  it("handles punycode / IDN safely", () => {
    const r = normalizePrototypeUrl("münchen.de");
    expect(r.ok && r.host).toBe("xn--mnchen-3ya.de");
  });
});

describe("helpers", () => {
  it("mixed content", () => {
    expect(isMixedContentBlocked("http://a.com", "https:")).toBe(true);
    expect(isMixedContentBlocked("https://a.com", "https:")).toBe(false);
    expect(isMixedContentBlocked("http://a.com", "http:")).toBe(false);
    expect(isMixedContentBlocked("not a url", "https:")).toBe(false);
  });
  it("framing blockers match subdomains but not look-alikes", () => {
    expect(likelyBlocksEmbedding("www.github.com")).toBe(true);
    expect(likelyBlocksEmbedding("gist.github.com")).toBe(true);
    expect(likelyBlocksEmbedding("mygithub.com")).toBe(false);
    expect(likelyBlocksEmbedding("localhost:3000")).toBe(false);
  });
  it("sandbox grants same-origin only on request and never top-navigation", () => {
    expect(iframeSandbox(false)).not.toContain("allow-same-origin");
    expect(iframeSandbox(true)).toContain("allow-same-origin");
    expect(iframeSandbox(true)).not.toContain("top-navigation");
  });
});
