// src/lib/remote/protocol.ts
export type SfxInfo = { id: string; label: string; emoji: string };

export type StudioState = {
  page: "studio";
  scenes: string[];
  live: number; // index of the live scene, -1 when the live scene is not from the rundown
  editing: number;
  isLive: boolean;
  recording: boolean;
  recSecs: number;
  music: string | null;
  tracks: { id: string; name: string }[];
  sfx: SfxInfo[];
  guest: boolean;
};

export type PrompterState = {
  page: "prompter";
  playing: boolean;
  speed: number;
  font: number;
  mirror: boolean;
  recording: boolean;
  recSecs: number;
  progress: number; // 0..100
};

export type HostState = StudioState | PrompterState | { page: "idle" };

/** Remote -> host */
export type Command = { cmd: string; arg?: string | number };

export type Msg = { t: "state"; state: HostState } | ({ t: "cmd" } & Command);

export const isMsg = (v: unknown): v is Msg => {
  if (typeof v !== "object" || v === null) return false;
  const m = v as { t?: unknown };
  return m.t === "state" || m.t === "cmd";
};

export const ROOM_PREFIX = "tkd-";
export const newRoomId = () =>
  ROOM_PREFIX +
  Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) =>
    (b % 36).toString(36),
  ).join("");
export const isRoomId = (s: string | null | undefined): s is string =>
  !!s && /^tkd-[a-z0-9]{8}$/.test(s);
