// SSR safety: importing and constructing the module must not touch browser-only globals.
// (Mirrors storage/ssr.test.ts: the browser globals are removed before a fresh import.)
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function stubServerEnvironment(): void {
  for (const name of [
    "window",
    "document",
    "navigator",
    "location",
    "RTCPeerConnection",
    "RTCRtpReceiver",
    "MediaStream",
    "AudioContext",
    "webkitAudioContext",
    "CompressionStream",
    "DecompressionStream",
  ]) {
    vi.stubGlobal(name, undefined);
  }
}

describe("p2p module on the server (no browser globals)", () => {
  it("imports without touching window/document/navigator/WebRTC/Web Audio", async () => {
    vi.resetModules();
    stubServerEnvironment();
    const p2p = await import("./index");
    expect(typeof p2p.StudioHost).toBe("function");
    expect(typeof p2p.StudioClient.acceptOffer).toBe("function");
    expect(p2p.isP2PSupported()).toBe(false);
    expect(p2p.isCompressionSupported()).toBe(false);
  });

  it("pure helpers keep working", async () => {
    vi.resetModules();
    stubServerEnvironment();
    const p2p = await import("./index");
    expect(p2p.parseFragment("#c=TKZ1.abc")).toBe("TKZ1.abc");
    expect(p2p.buildJoinUrl("https://x.y", "TKZ1.abc")).toBe(
      "https://x.y/join#c=TKZ1.abc",
    );
    expect(p2p.parseHostMessage('{"type":"guest-on-air"}')).toEqual({
      type: "guest-on-air",
    });
    expect(p2p.sanitizeName("  hi ")).toBe("hi");
    expect(p2p.buildIceServers(false)).toEqual([]);
    expect(p2p.p2pErrorMessage("unsupported")).toMatch(/\S/);
  });

  it("falls back to plain codes when compression is unavailable", async () => {
    vi.resetModules();
    stubServerEnvironment();
    const p2p = await import("./index");
    const code = await p2p.encodeSignal({
      type: "offer",
      sdp: "v=0\r\ns=-\r\n",
    });
    expect(code.startsWith(p2p.CODE_PREFIX_PLAIN)).toBe(true);
    expect((await p2p.decodeSignal(code)).sdp).toBe("v=0\r\ns=-\r\n");
  });

  it("host state can be created and observed; creating connections fails with a typed error", async () => {
    vi.resetModules();
    stubServerEnvironment();
    const p2p = await import("./index");
    const host = new p2p.StudioHost({ usePublicStun: false });
    expect(host.getPeers()).toEqual([]);
    const listener = vi.fn();
    const off = host.subscribe(listener);
    await expect(host.createInvite("viewer")).rejects.toMatchObject({
      code: "unsupported",
    });
    off();
    expect(host.getPeers()).toEqual([]);
    expect(() => host.dispose()).not.toThrow();
  });

  it("media helpers report 'unsupported' instead of crashing", async () => {
    vi.resetModules();
    stubServerEnvironment();
    const p2p = await import("./index");
    await expect(p2p.testMedia({ audio: true })).rejects.toMatchObject({
      code: "unsupported",
    });
    expect(() =>
      p2p.createLevelMeter({
        getAudioTracks: () => [{}],
      } as unknown as MediaStream),
    ).toThrow(expect.objectContaining({ code: "unsupported" }));
  });
});
