// src/lib/remote/peer.ts
import type { Peer, PeerOptions } from "peerjs";

/**
 * Signalling server for WebRTC pairing. Defaults to the public PeerJS cloud;
 * `?signal=host:port` (or localStorage "studio.signal") points at a self-hosted `peerjs` server.
 */
export function signalOptions(): PeerOptions {
  let custom: string | null = null;
  try {
    custom =
      new URLSearchParams(location.search).get("signal") ??
      localStorage.getItem("studio.signal");
    if (custom) localStorage.setItem("studio.signal", custom);
  } catch {
    /* storage blocked */
  }
  if (custom) {
    const [host, port] = custom.split(":");
    if (host)
      return {
        host,
        port: Number(port) || 9000,
        path: "/",
        secure: location.protocol === "https:",
      };
  }
  return {};
}

export async function newPeer(id?: string): Promise<Peer> {
  const { Peer } = await import("peerjs");
  return id ? new Peer(id, signalOptions()) : new Peer(signalOptions());
}
