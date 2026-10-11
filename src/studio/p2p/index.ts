// src/studio/p2p/index.ts
// Public surface of the serverless WebRTC module. UI/runtime code imports from here only.
// (qr.* is owned by another module and intentionally NOT re-exported; internal helpers such as
// throttle.ts, `safely` and `connectionHealth` stay private.)

export { P2PError, isP2PError, p2pErrorMessage } from "./errors";
export type { P2PErrorCode, SignalErrorCode } from "./errors";

export {
  MAX_DISPLAY_NAME_CHARS,
  MAX_MESSAGE_BYTES,
  encodeMessage,
  hostMessageSchema,
  parseHostMessage,
  parsePeerMessage,
  parseRemoteCommand,
  parseRemoteState,
  peerMessageSchema,
  remoteCommandSchema,
  remoteStateSchema,
  sanitizeName,
} from "./protocol";

export {
  CODE_PREFIX,
  CODE_PREFIX_PLAIN,
  MAX_CODE_LENGTH,
  SIGNAL_VERSION,
  SignalError,
  buildJoinUrl,
  buildRemoteUrl,
  decodeSignal,
  encodeSignal,
  extractCode,
  isCompressionSupported,
  isSignalError,
  parseFragment,
  waitForIceGathering,
} from "./signaling";
export type {
  EncodeSignalOptions,
  IceGatheringTarget,
  SignalPayload,
} from "./signaling";

export {
  DEFAULT_ICE_TIMEOUT_MS,
  PUBLIC_STUN_URLS,
  buildIceServers,
  buildRtcConfig,
  defaultRtcFactory,
  isP2PSupported,
} from "./rtc";
export type {
  RtcCandidateEventLike,
  RtcCodec,
  RtcDataChannelEventMap,
  RtcDataChannelLike,
  RtcFactory,
  RtcMessageEventLike,
  RtcPeerConnectionEventMap,
  RtcPeerConnectionLike,
  RtcReceiverLike,
  RtcSenderLike,
  RtcTrackEventLike,
  RtcTransceiverLike,
} from "./rtc";

export { applyCompactCodecs, selectCompactCodecs } from "./codecs";

export {
  DEFAULT_MAX_PEERS,
  DEFAULT_PEER_BITRATE_KBPS,
  REMOTE_STATE_MIN_INTERVAL_MS,
  StudioHost,
} from "./host";
export type {
  GuestStreamHandler,
  InviteResult,
  PeersListener,
  RemoteCommandHandler,
  StudioHostOptions,
} from "./host";

export { StudioClient } from "./client";
export type {
  AcceptOfferOptions,
  AcceptOfferResult,
  ClientStatus,
} from "./client";

export {
  DEFAULT_TEST_CONSTRAINTS,
  createLevelMeter,
  levelToUnit,
  rmsOfBytes,
  rmsOfFloat,
  stopStream,
  testMedia,
  toMediaError,
} from "./media";
export type {
  LevelMeter,
  LevelMeterDeps,
  MediaDevicesLike,
  TestMediaDeps,
  TestMediaResult,
} from "./media";
