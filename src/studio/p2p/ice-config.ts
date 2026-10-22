// src/studio/p2p/ice-config.ts
// User-supplied STUN/TURN servers. Stored per device in localStorage — never in the project
// (credentials must not leak through project export / handoff / sync).
//
// Line format:  url | username | credential      (username/credential only for turn:/turns:)

export const ICE_STORAGE_KEY = "studio.ice.v1";
export const MAX_ICE_SERVERS = 6;

const URL_RE = /^(stun|stuns|turn|turns):[^\s,|]+$/i;

export interface IceParseResult {
  servers: RTCIceServer[];
  /** 1-based line numbers that were ignored. */
  invalid: number[];
}

export function parseIceLines(text: string): IceParseResult {
  const servers: RTCIceServer[] = [];
  const invalid: number[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) return;
    const [url = "", username = "", ...rest] = line
      .split("|")
      .map((p) => p.trim());
    const credential = rest.join("|");
    const isTurn = /^turns?:/i.test(url);
    if (
      !URL_RE.test(url) ||
      servers.length >= MAX_ICE_SERVERS ||
      (isTurn && (username === "" || credential === ""))
    ) {
      invalid.push(i + 1);
      return;
    }
    servers.push(isTurn ? { urls: url, username, credential } : { urls: url });
  });
  return { servers, invalid };
}

export function loadIceText(): string {
  try {
    return globalThis.localStorage?.getItem(ICE_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveIceText(text: string): void {
  try {
    if (text.trim() === "")
      globalThis.localStorage?.removeItem(ICE_STORAGE_KEY);
    else globalThis.localStorage?.setItem(ICE_STORAGE_KEY, text);
  } catch {
    /* storage unavailable: setting just won't persist */
  }
}

export function loadCustomIce(): RTCIceServer[] {
  return parseIceLines(loadIceText()).servers;
}
