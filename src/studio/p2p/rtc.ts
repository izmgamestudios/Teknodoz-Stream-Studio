// src/studio/p2p/rtc.ts
// Minimal structural view of the WebRTC objects host.ts / client.ts use, plus the injectable
// factory. Real browsers satisfy it through `defaultRtcFactory()` (one documented cast at the
// boundary); unit tests inject a fake (see __fakes__/fake-rtc.ts) because jsdom has no WebRTC.
//
// SSR: nothing here touches RTCPeerConnection / MediaStream at module load.
import { P2PError } from "./errors";
import { loadCustomIce } from "./ice-config";

/** Public STUN servers used ONLY when the `usePublicStun` setting is on. */
export const PUBLIC_STUN_URLS: readonly string[] = [
  "stun:stun.l.google.com:19302",
  "stun:stun1.l.google.com:19302",
];

/** ICE gathering budget. We never trickle, so this bounds how long a code takes to appear. */
export const DEFAULT_ICE_TIMEOUT_MS = 4000;

/**
 * `[]` (LAN / host candidates only) unless public STUN is allowed or the user configured their
 * own STUN/TURN servers (device-local, see ice-config.ts).
 */
export function buildIceServers(
  usePublicStun: boolean,
  custom: readonly RTCIceServer[] = loadCustomIce(),
): RTCIceServer[] {
  return [
    ...(usePublicStun ? [{ urls: [...PUBLIC_STUN_URLS] }] : []),
    ...custom,
  ];
}

/**
 * RTCConfiguration used by both sides. `max-bundle` puts every m-section on one transport,
 * which keeps the SDP (and therefore the copy/paste code) small and is supported by every
 * browser that implements unified plan.
 */
export function buildRtcConfig(usePublicStun: boolean): RTCConfiguration {
  return {
    iceServers: buildIceServers(usePublicStun),
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
  };
}

/** Codec description used by setCodecPreferences / getCapabilities (DOM lib name varies by TS version). */
export type RtcCodec = RTCRtpCodec;

export interface RtcSenderLike {
  readonly track: MediaStreamTrack | null;
  replaceTrack(track: MediaStreamTrack | null): Promise<void>;
  getParameters?(): RTCRtpSendParameters;
  setParameters?(parameters: RTCRtpSendParameters): Promise<void>;
}

export interface RtcReceiverLike {
  readonly track: MediaStreamTrack;
}

export interface RtcTransceiverLike {
  readonly mid: string | null;
  readonly sender: RtcSenderLike;
  readonly receiver: RtcReceiverLike;
  direction: RTCRtpTransceiverDirection;
  /** Not available everywhere; callers feature-detect and swallow InvalidAccessError. */
  setCodecPreferences?(codecs: RtcCodec[]): void;
}

export interface RtcTrackEventLike {
  readonly track: MediaStreamTrack;
  readonly transceiver?: RtcTransceiverLike;
  readonly streams?: readonly MediaStream[];
}

export interface RtcCandidateEventLike {
  readonly candidate: { readonly candidate?: string } | null;
}

export interface RtcMessageEventLike {
  readonly data: unknown;
}

export interface RtcDataChannelEventMap {
  open: unknown;
  close: unknown;
  error: unknown;
  message: RtcMessageEventLike;
}

export interface RtcDataChannelLike {
  readonly label: string;
  readonly readyState: RTCDataChannelState;
  readonly bufferedAmount: number;
  send(data: string): void;
  close(): void;
  addEventListener<K extends keyof RtcDataChannelEventMap>(
    type: K,
    listener: (ev: RtcDataChannelEventMap[K]) => void,
  ): void;
  removeEventListener<K extends keyof RtcDataChannelEventMap>(
    type: K,
    listener: (ev: RtcDataChannelEventMap[K]) => void,
  ): void;
}

export interface RtcPeerConnectionEventMap {
  connectionstatechange: unknown;
  iceconnectionstatechange: unknown;
  icegatheringstatechange: unknown;
  icecandidate: RtcCandidateEventLike;
  track: RtcTrackEventLike;
  datachannel: { readonly channel: RtcDataChannelLike };
}

export interface RtcPeerConnectionLike {
  readonly signalingState: RTCSignalingState;
  /** Missing in some older browsers; callers fall back to `iceConnectionState`. */
  readonly connectionState?: RTCPeerConnectionState;
  readonly iceConnectionState: RTCIceConnectionState;
  readonly iceGatheringState: RTCIceGatheringState;
  readonly localDescription: {
    readonly type: string;
    readonly sdp: string;
  } | null;
  readonly remoteDescription: {
    readonly type: string;
    readonly sdp: string;
  } | null;
  createOffer(): Promise<RTCSessionDescriptionInit>;
  createAnswer(): Promise<RTCSessionDescriptionInit>;
  setLocalDescription(description: RTCSessionDescriptionInit): Promise<void>;
  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void>;
  createDataChannel(
    label: string,
    init?: RTCDataChannelInit,
  ): RtcDataChannelLike;
  addTransceiver(
    kind: "audio" | "video",
    init?: RTCRtpTransceiverInit,
  ): RtcTransceiverLike;
  getTransceivers(): RtcTransceiverLike[];
  close(): void;
  addEventListener<K extends keyof RtcPeerConnectionEventMap>(
    type: K,
    listener: (ev: RtcPeerConnectionEventMap[K]) => void,
  ): void;
  removeEventListener<K extends keyof RtcPeerConnectionEventMap>(
    type: K,
    listener: (ev: RtcPeerConnectionEventMap[K]) => void,
  ): void;
}

/** Everything host.ts / client.ts need from the platform. Inject a fake in tests. */
export interface RtcFactory {
  createPeerConnection(config: RTCConfiguration): RtcPeerConnectionLike;
  createMediaStream(tracks: MediaStreamTrack[]): MediaStream;
  /** Codec capabilities for `setCodecPreferences`, or null when the platform can't tell. */
  getCodecCapabilities?(kind: "audio" | "video"): RtcCodec[] | null;
}

/** True when this runtime can create peer connections (false during SSR / old browsers). */
export function isP2PSupported(): boolean {
  return (
    typeof RTCPeerConnection !== "undefined" &&
    typeof MediaStream !== "undefined"
  );
}

/**
 * Factory backed by the real browser APIs. Throws `P2PError("unsupported")` when WebRTC is
 * missing so callers can show a friendly message instead of a ReferenceError.
 */
export function defaultRtcFactory(): RtcFactory {
  if (!isP2PSupported()) throw new P2PError("unsupported");
  return {
    createPeerConnection(config) {
      // The DOM object structurally satisfies the subset declared above; the only mismatch is
      // the generic addEventListener overloads, which TS cannot relate to the narrowed map.
      return new RTCPeerConnection(config) as unknown as RtcPeerConnectionLike;
    },
    createMediaStream(tracks) {
      return new MediaStream(tracks);
    },
    getCodecCapabilities(kind) {
      try {
        if (typeof RTCRtpReceiver === "undefined") return null;
        if (typeof RTCRtpReceiver.getCapabilities !== "function") return null;
        return RTCRtpReceiver.getCapabilities(kind)?.codecs ?? null;
      } catch {
        return null;
      }
    },
  };
}

/** Collapsed view of the two (differently spelled) connection state machines. */
export type ConnectionHealth = "pending" | "up" | "down" | "failed";

/**
 * - `up`: media/data can flow
 * - `down`: transient loss (ICE "disconnected"), may recover on its own
 * - `failed`: terminal (failed / closed)
 * - `pending`: still negotiating
 */
export function connectionHealth(pc: RtcPeerConnectionLike): ConnectionHealth {
  const state: string =
    typeof pc.connectionState === "string"
      ? pc.connectionState
      : pc.iceConnectionState;
  switch (state) {
    case "connected":
    case "completed":
      return "up";
    case "disconnected":
      return "down";
    case "failed":
    case "closed":
      return "failed";
    default:
      return "pending";
  }
}

/** Run `fn`, ignoring any exception (cleanup paths must never throw). */
export function safely(fn: () => void): void {
  try {
    fn();
  } catch {
    /* intentionally ignored */
  }
}
