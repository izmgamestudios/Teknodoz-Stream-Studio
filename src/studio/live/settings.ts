// src/studio/live/settings.ts
// Local (browser-only) persistence of the /live page. Stream keys and the operator token are
// secrets: they are NOT stored unless the user opts in, the token defaults to sessionStorage.
import { PLATFORMS, getPlatform, type PlatformId } from "./platforms";

export interface DestState {
  id: string;
  platform: PlatformId;
  label: string;
  server: string;
  key: string;
  enabled: boolean;
}

export interface LiveSettings {
  dests: DestState[];
  quality: string;
  rememberKeys: boolean;
}

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

const KEY = "tkz.live.v1";
const TOKEN = "tkz.live.token";
const MAX_DESTS = 4;

let counter = 0;
export function newDestId(): string {
  counter++;
  return `d${Date.now().toString(36)}${counter.toString(36)}`;
}

export function newDest(platform: PlatformId): DestState {
  const p = getPlatform(platform);
  return {
    id: newDestId(),
    platform: p.id,
    label: p.name,
    server: p.server,
    key: "",
    enabled: true,
  };
}

export function defaultLiveSettings(): LiveSettings {
  return {
    dests: [newDest("youtube")],
    quality: "720p30",
    rememberKeys: false,
  };
}

function local(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
function session(): StorageLike | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

const str = (v: unknown, max: number): string =>
  typeof v === "string" ? v.slice(0, max) : "";

export function loadLiveSettings(
  storage: StorageLike | null = local(),
): LiveSettings {
  const def = defaultLiveSettings();
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return def;
    const p = JSON.parse(raw) as Record<string, unknown>;
    const ids = new Set<string>(PLATFORMS.map((x) => x.id));
    const dests: DestState[] = [];
    if (Array.isArray(p["dests"])) {
      for (const d of p["dests"].slice(0, MAX_DESTS)) {
        if (typeof d !== "object" || d === null) continue;
        const o = d as Record<string, unknown>;
        const platform =
          typeof o["platform"] === "string" && ids.has(o["platform"])
            ? (o["platform"] as PlatformId)
            : "custom";
        dests.push({
          id: str(o["id"], 40) || newDestId(),
          platform,
          label: str(o["label"], 60) || getPlatform(platform).name,
          server: str(o["server"], 600),
          key: str(o["key"], 600),
          enabled: o["enabled"] !== false,
        });
      }
    }
    return {
      dests: dests.length ? dests : def.dests,
      quality: str(p["quality"], 20) || def.quality,
      rememberKeys: p["rememberKeys"] === true,
    };
  } catch {
    return def;
  }
}

export function saveLiveSettings(
  s: LiveSettings,
  storage: StorageLike | null = local(),
): void {
  try {
    const out: LiveSettings = {
      ...s,
      dests: s.dests.map((d) => ({ ...d, key: s.rememberKeys ? d.key : "" })),
    };
    storage?.setItem(KEY, JSON.stringify(out));
  } catch {
    // storage full / blocked: the page still works, nothing is remembered
  }
}

export function loadToken(): { token: string; remember: boolean } {
  try {
    const l = local()?.getItem(TOKEN);
    if (l) return { token: l, remember: true };
    return { token: session()?.getItem(TOKEN) ?? "", remember: false };
  } catch {
    return { token: "", remember: false };
  }
}

export function saveToken(token: string, remember: boolean): void {
  try {
    local()?.removeItem(TOKEN);
    session()?.removeItem(TOKEN);
    if (!token) return;
    (remember ? local() : session())?.setItem(TOKEN, token);
  } catch {
    // ignore
  }
}
