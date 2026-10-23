// src/studio/p2p/host-types.ts
// Public option/handler types and tuning constants of StudioHost, plus its internal per-peer
// record. Split out of host.ts to keep the state machine readable. Public names are re-exported
// from host.ts / index.ts; everything marked internal stays private to the module.
import type { PeerInfo, PeerRole, RemoteCommand } from "../types";
import type {
  RtcDataChannelLike,
  RtcFactory,
  RtcPeerConnectionLike,
  RtcSenderLike,
} from "./rtc";
import type { FixedWindowLimiter } from "./throttle";

/** Default cap on simultaneously live peers (pending invites included). */
export const DEFAULT_MAX_PEERS = 8;
/** remote-state broadcasts are coalesced to at most 10 per second. */
export const REMOTE_STATE_MIN_INTERVAL_MS = 100;
/** Default ceiling for each viewer/guest video sender (kbit/s). 0 disables the cap. */
export const DEFAULT_PEER_BITRATE_KBPS = 2500;

export const DEFAULT_INVITE_TTL_MS = 10 * 60_000;
export const DEFAULT_DISCONNECT_GRACE_MS = 8_000;
export const MAX_MESSAGES_PER_SECOND = 60;
export const MAX_INVALID_MESSAGES = 50;
export const MAX_BUFFERED_BYTES = 256 * 1024;
export const MIN_GAIN = 0;
export const MAX_GAIN = 1.5;

export interface StudioHostOptions {
  /** Allow public STUN servers (the `usePublicStun` setting). Otherwise LAN candidates only. */
  usePublicStun: boolean;
  /** Called with the new snapshot after every change (same data as `subscribe`). */
  onPeersChange?: (peers: readonly PeerInfo[]) => void;
  /** Max live peers (default 8). Exceeding it makes `createInvite` throw `max-peers`. */
  maxPeers?: number;
  /** Platform access; inject a fake in unit tests. Default: the real browser APIs. */
  rtcFactory?: RtcFactory;
  /** ICE gathering budget in ms (default 4000). */
  iceTimeoutMs?: number;
  /** Unanswered invites are dropped after this many ms (default 10 min, 0 = never). */
  inviteTtlMs?: number;
  /** How long a transient ICE "disconnected" may last before the peer counts as gone. */
  disconnectGraceMs?: number;
  /** Cap for each viewer/guest video sender in kbit/s (default 2500, 0 = unlimited). */
  maxPeerBitrateKbps?: number;
  /** Offer only opus + VP8/H.264(+rtx) to keep codes small (default true). See codecs.ts. */
  compactCodecs?: boolean;
  /** Origin used to build invite links; default `location.origin` (empty string during SSR). */
  origin?: string;
}

export interface InviteResult {
  peerId: string;
  /** The offer code (copy/paste or QR). */
  code: string;
  /** Link carrying the code in the URL fragment (`/join#c=` or `/remote#c=`). */
  url: string;
}

export type PeersListener = (peers: readonly PeerInfo[]) => void;
export type GuestStreamHandler = (
  peerId: string,
  stream: MediaStream | null,
) => void;
export type RemoteCommandHandler = (peerId: string, cmd: RemoteCommand) => void;

/** Internal per-peer state of StudioHost (not part of the public API). */
export interface PeerEntry {
  info: PeerInfo;
  /** Hidden until the invite code exists (it already counts toward the cap). */
  visible: boolean;
  pc: RtcPeerConnectionLike;
  dc: RtcDataChannelLike | null;
  videoSender: RtcSenderLike | null;
  audioSender: RtcSenderLike | null;
  inbound: { video: MediaStreamTrack | null; audio: MediaStreamTrack | null };
  guestStream: MediaStream | null;
  answerSdp: string | null;
  answering: Promise<void> | null;
  inviteTimer: ReturnType<typeof setTimeout> | null;
  graceTimer: ReturnType<typeof setTimeout> | null;
  /** Drops floods of messages (see MAX_MESSAGES_PER_SECOND). */
  limiter: FixedWindowLimiter;
  invalid: number;
  lastStateJson: string | null;
  /** last prompter message sent (podcast guests), to skip identical repeats */
  lastPrompterJson: string | null;
  /** podcast mix-minus: this peer's own program (overrides the shared one) */
  programOverride: MediaStream | null;
  closed: boolean;
  /** Aborted on close so an in-flight ICE wait ends immediately. */
  abort: AbortController;
  cleanups: Array<() => void>;
}

export const EMPTY_PEERS: readonly PeerInfo[] = Object.freeze([]);

export const DEFAULT_NAMES: Record<PeerRole, string> = {
  viewer: "İzleyici",
  guest: "Konuk",
  remote: "Kumanda",
};
