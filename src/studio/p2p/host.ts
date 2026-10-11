// src/studio/p2p/host.ts
// StudioHost: the studio side of the serverless WebRTC layer.
//
// One RTCPeerConnection per invited peer (a MESH of 1 host to N peers). Signaling is manual and
// one-shot: `createInvite()` returns an offer code/link, the other side returns an answer code,
// `acceptAnswer()` completes the handshake. ICE is gathered completely before a code is
// produced (never trickled), so codes are self-contained.
//
// Roles (one separate invite per role; a peer cannot upgrade itself - the host decides):
//  - "viewer": receives the program stream (host transceivers are sendonly).
//  - "guest":  receives the program stream AND may publish camera/mic. Transceivers are created
//              sendrecv up front so the guest can `replaceTrack` later without renegotiation.
//              A guest that sends `join-request` enters the green room ("waiting"); the host
//              brings it on air / off air / rejects it. Guests hear the program audio, which
//              contains their own voice delayed: they should wear headphones (no mix-minus).
//  - "remote": only the "ctl" channel; sends RemoteCommands, receives RemoteState (<= 10 Hz).
//
// Real-browser limits (cannot be fixed client-side, by design there is no server):
//  - Mesh: the host encodes the program once PER peer. Practical ceiling is ~8 peers (default
//    cap), fewer on weak machines; viewer/guest video is capped at `maxPeerBitrateKbps`.
//  - No TURN: peers behind symmetric NAT / strict corporate firewalls may fail to connect
//    (status ends in "disconnected"). Same-LAN and most home networks work; enabling public
//    STUN (`usePublicStun`) helps across the internet.
//  - Without a getUserMedia grant, browsers hide LAN IPs behind mDNS names (*.local), which some
//    networks do not resolve. Ask for camera/mic (testMedia) BEFORE creating codes where possible.
//
// The host never stops tracks it did not create: the program stream belongs to the runtime.
import type {
  HostToPeer,
  PeerInfo,
  PeerRole,
  PeerStatus,
  RemoteCommand,
  RemoteState,
} from "../types";
import { uid } from "../defaults";
import { applyCompactCodecs } from "./codecs";
import { P2PError } from "./errors";
import { FixedWindowLimiter, LeadingTrailingThrottle } from "./throttle";
import { encodeMessage, parsePeerMessage, sanitizeName } from "./protocol";
import {
  buildRtcConfig,
  connectionHealth,
  DEFAULT_ICE_TIMEOUT_MS,
  defaultRtcFactory,
  safely,
  type RtcDataChannelLike,
  type RtcFactory,
  type RtcPeerConnectionLike,
  type RtcSenderLike,
} from "./rtc";
import {
  buildJoinUrl,
  buildRemoteUrl,
  decodeSignal,
  encodeSignal,
  waitForIceGathering,
} from "./signaling";

import {
  DEFAULT_DISCONNECT_GRACE_MS,
  DEFAULT_INVITE_TTL_MS,
  DEFAULT_MAX_PEERS,
  DEFAULT_NAMES,
  DEFAULT_PEER_BITRATE_KBPS,
  EMPTY_PEERS,
  MAX_BUFFERED_BYTES,
  MAX_GAIN,
  MAX_INVALID_MESSAGES,
  MAX_MESSAGES_PER_SECOND,
  MIN_GAIN,
  REMOTE_STATE_MIN_INTERVAL_MS,
  type GuestStreamHandler,
  type InviteResult,
  type PeerEntry,
  type PeersListener,
  type RemoteCommandHandler,
  type StudioHostOptions,
} from "./host-types";

export {
  DEFAULT_MAX_PEERS,
  DEFAULT_PEER_BITRATE_KBPS,
  REMOTE_STATE_MIN_INTERVAL_MS,
} from "./host-types";
export type {
  GuestStreamHandler,
  InviteResult,
  PeersListener,
  RemoteCommandHandler,
  StudioHostOptions,
} from "./host-types";

export class StudioHost {
  private readonly peers = new Map<string, PeerEntry>();
  private readonly listeners = new Set<PeersListener>();
  private readonly guestStreamHandlers = new Set<GuestStreamHandler>();
  private readonly remoteCommandHandlers = new Set<RemoteCommandHandler>();
  private readonly nameCounters: Record<PeerRole, number> = {
    viewer: 0,
    guest: 0,
    remote: 0,
  };
  private readonly options: StudioHostOptions;
  private factory: RtcFactory | null;
  private programStream: MediaStream | null = null;
  private snapshot: readonly PeerInfo[] = EMPTY_PEERS;
  private snapshotDirty = false;
  private latestRemoteState: RemoteState | null = null;
  private readonly stateThrottle = new LeadingTrailingThrottle<RemoteState>(
    REMOTE_STATE_MIN_INTERVAL_MS,
    (state) => this.flushRemoteState(state),
  );
  private disposed = false;

  constructor(options: StudioHostOptions) {
    this.options = options;
    this.factory = options.rtcFactory ?? null;
  }

  /* -------------------------------------------------------------- */
  /* Snapshot / subscription (arrow props: safe to pass detached,    */
  /* e.g. useSyncExternalStore(host.subscribe, host.getPeers))        */
  /* -------------------------------------------------------------- */

  /**
   * Immutable snapshot of all known peers (including "disconnected" ones until removed).
   * Referentially stable: the same array instance is returned until something changes, and
   * unchanged peers keep their object identity.
   */
  readonly getPeers = (): readonly PeerInfo[] => {
    if (!this.snapshotDirty) return this.snapshot;
    this.snapshotDirty = false;
    const next: PeerInfo[] = [];
    for (const entry of this.peers.values())
      if (entry.visible) next.push(entry.info);
    const previous = this.snapshot;
    const same =
      next.length === previous.length &&
      next.every((info, i) => info === previous[i]);
    if (!same) this.snapshot = Object.freeze(next);
    return this.snapshot;
  };

  readonly getPeer = (peerId: string): PeerInfo | undefined => {
    const entry = this.peers.get(peerId);
    return entry?.visible ? entry.info : undefined;
  };

  /** Subscribe to snapshot changes. Returns the unsubscribe function. */
  readonly subscribe = (listener: PeersListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * The guest's camera/mic became available (guest entered the green room) or went away
   * (`null`: left, rejected, disconnected, kicked). Returns the unsubscribe function.
   */
  onGuestStream(handler: GuestStreamHandler): () => void {
    this.guestStreamHandlers.add(handler);
    return () => {
      this.guestStreamHandlers.delete(handler);
    };
  }

  /** Current guest stream, for consumers that attach after the event fired. */
  getGuestStream(peerId: string): MediaStream | null {
    return this.peers.get(peerId)?.guestStream ?? null;
  }

  /** Validated commands from "remote" peers only. Returns the unsubscribe function. */
  onRemoteCommand(handler: RemoteCommandHandler): () => void {
    this.remoteCommandHandlers.add(handler);
    return () => {
      this.remoteCommandHandlers.delete(handler);
    };
  }

  /* -------------------------------------------------------------- */
  /* Signaling                                                       */
  /* -------------------------------------------------------------- */

  /**
   * Create an offer for a new peer and return its code + link. Resolves after ICE gathering
   * (<= `iceTimeoutMs`). The peer appears in `getPeers()` as "connecting".
   * @throws P2PError max-peers | unsupported | ice-failed | disposed
   */
  async createInvite(role: PeerRole, name?: string): Promise<InviteResult> {
    this.assertAlive();
    if (this.liveCount() >= (this.options.maxPeers ?? DEFAULT_MAX_PEERS)) {
      throw new P2PError("max-peers");
    }
    const factory = this.getFactory();
    const pc = factory.createPeerConnection(
      buildRtcConfig(this.options.usePublicStun),
    );
    const peerId = uid("peer");
    const entry = this.newEntry(peerId, role, name, pc);
    this.peers.set(peerId, entry);
    try {
      this.attachPeerConnection(entry);
      const dc = pc.createDataChannel("ctl", { ordered: true });
      this.attachChannel(entry, dc);
      if (role !== "remote") await this.addMediaTransceivers(entry, role);
      this.assertEntryAlive(entry);
      const offer = await pc.createOffer();
      this.assertEntryAlive(entry);
      await pc.setLocalDescription(offer);
      this.assertEntryAlive(entry);
      await waitForIceGathering(
        pc,
        this.options.iceTimeoutMs ?? DEFAULT_ICE_TIMEOUT_MS,
        entry.abort.signal,
      );
      this.assertEntryAlive(entry);
      const sdp = pc.localDescription?.sdp ?? offer.sdp ?? "";
      if (!/^a=candidate:/m.test(sdp)) throw new P2PError("ice-failed");
      const code = await encodeSignal({ v: 1, type: "offer", role, sdp });
      this.assertEntryAlive(entry);
      entry.visible = true;
      this.startInviteTimer(entry);
      this.changed();
      return { peerId, code, url: this.buildUrl(role, code) };
    } catch (error) {
      this.discard(entry);
      throw error;
    }
  }

  /**
   * Complete the handshake with the answer code the peer sent back.
   *
   * Idempotent for the *same* answer pasted twice (double click); a *different* second answer
   * throws `already-answered`; answers for peers that are gone/expired/closed throw
   * `unknown-peer` / `bad-state`; an offer pasted by mistake throws `wrong-direction`.
   * @throws SignalError | P2PError unknown-peer | bad-state | already-answered |
   *         wrong-direction | role-mismatch | bad-sdp | disposed
   */
  async acceptAnswer(peerId: string, answerCode: string): Promise<void> {
    this.assertAlive();
    const first = this.peers.get(peerId);
    if (!first) throw new P2PError("unknown-peer");
    this.assertEntryAlive(first);
    const payload = await decodeSignal(answerCode);
    this.assertAlive();
    // The peer may have been kicked / expired while we were decoding: re-resolve.
    const entry = this.peers.get(peerId);
    if (!entry) throw new P2PError("unknown-peer");
    this.assertEntryAlive(entry);
    if (payload.type === "offer") throw new P2PError("wrong-direction");
    if (payload.role !== undefined && payload.role !== entry.info.role) {
      throw new P2PError("role-mismatch");
    }
    if (entry.answerSdp !== null) {
      if (entry.answerSdp === payload.sdp && entry.answering)
        return entry.answering;
      throw new P2PError("already-answered");
    }
    if (entry.pc.signalingState !== "have-local-offer")
      throw new P2PError("bad-state");

    entry.answerSdp = payload.sdp;
    entry.answering = (async () => {
      try {
        await entry.pc.setRemoteDescription({
          type: "answer",
          sdp: payload.sdp,
        });
      } catch (cause) {
        throw new P2PError("bad-sdp", undefined, { cause });
      }
      this.assertEntryAlive(entry);
      if (entry.inviteTimer) {
        clearTimeout(entry.inviteTimer);
        entry.inviteTimer = null;
      }
      await this.limitBitrate(entry);
      this.onConnectionChange(entry);
    })();
    try {
      await entry.answering;
    } catch (error) {
      // a rejected answer leaves the offer pending: the user may paste a corrected one
      if (!entry.closed) {
        entry.answerSdp = null;
        entry.answering = null;
      }
      throw error;
    }
  }

  /* -------------------------------------------------------------- */
  /* Program output                                                  */
  /* -------------------------------------------------------------- */

  /**
   * Set (or clear with null) the program output that every viewer/guest watches. Tracks are
   * swapped with `replaceTrack` (no renegotiation) on all current peers and applied to peers
   * invited later. The host never stops these tracks.
   */
  setProgramStream(stream: MediaStream | null): void {
    this.programStream = stream;
    if (this.disposed) return;
    for (const entry of this.peers.values()) {
      if (!entry.closed) void this.applyProgramTracks(entry);
    }
  }

  /* -------------------------------------------------------------- */
  /* Green room / moderation                                         */
  /* -------------------------------------------------------------- */

  /**
   * Put a waiting guest on air. Returns true when the guest is on air afterwards (idempotent),
   * false for unknown peers or peers that are not in the green room.
   */
  bringOnAir(peerId: string): boolean {
    const entry = this.guestEntry(peerId);
    if (!entry) return false;
    if (entry.info.status === "on-air") return true;
    if (entry.info.status !== "waiting") return false;
    this.publishGuestStream(entry);
    this.patch(entry, { status: "on-air" });
    this.send(entry, { type: "guest-on-air" });
    return true;
  }

  /** Move an on-air guest back to the green room. True when the guest is waiting afterwards. */
  takeOffAir(peerId: string): boolean {
    const entry = this.guestEntry(peerId);
    if (!entry) return false;
    if (entry.info.status === "waiting") return true;
    if (entry.info.status !== "on-air") return false;
    this.patch(entry, { status: "waiting" });
    this.send(entry, { type: "guest-off-air" });
    return true;
  }

  /**
   * Refuse a waiting/on-air guest. The peer stays connected as a plain viewer (it receives
   * `guest-rejected` and stops publishing); use `kick` to drop the connection entirely.
   */
  rejectGuest(peerId: string): boolean {
    const entry = this.guestEntry(peerId);
    if (!entry) return false;
    if (entry.info.status !== "waiting" && entry.info.status !== "on-air")
      return false;
    this.retractGuestStream(entry);
    this.patch(entry, { status: "connected" });
    this.send(entry, { type: "guest-rejected" });
    return true;
  }

  /** Close the connection and remove the peer from the list. False for unknown ids. */
  kick(peerId: string): boolean {
    const entry = this.peers.get(peerId);
    if (!entry) return false;
    this.closeEntry(entry);
    this.peers.delete(peerId);
    if (entry.visible) this.changed();
    return true;
  }

  /** Remove every "disconnected" peer from the list. Returns how many were removed. */
  pruneDisconnected(): number {
    let removed = 0;
    for (const [id, entry] of this.peers) {
      if (entry.visible && entry.info.status === "disconnected") {
        this.peers.delete(id);
        removed++;
      }
    }
    if (removed > 0) this.changed();
    return removed;
  }

  /**
   * Bookkeeping only: stores the 0..1.5 gain in PeerInfo and emits. The actual audio gain is
   * applied by the runtime's AudioBus. Guests only; returns false otherwise or for NaN.
   */
  setGuestGain(peerId: string, gain: number): boolean {
    const entry = this.guestEntry(peerId);
    if (!entry || !Number.isFinite(gain)) return false;
    this.patch(entry, { gain: Math.min(MAX_GAIN, Math.max(MIN_GAIN, gain)) });
    return true;
  }

  /** Bookkeeping only (see `setGuestGain`). */
  setGuestMuted(peerId: string, muted: boolean): boolean {
    const entry = this.guestEntry(peerId);
    if (!entry) return false;
    this.patch(entry, { muted: Boolean(muted) });
    return true;
  }

  /* -------------------------------------------------------------- */
  /* Remote control                                                  */
  /* -------------------------------------------------------------- */

  /**
   * Send the studio state to every connected "remote" peer, coalesced to <= 10 Hz (leading +
   * trailing edge, latest state wins). Identical consecutive states are not re-sent.
   */
  broadcastRemoteState(state: RemoteState): void {
    if (this.disposed) return;
    this.latestRemoteState = state;
    this.stateThrottle.push(state);
  }

  /* -------------------------------------------------------------- */
  /* Lifecycle                                                       */
  /* -------------------------------------------------------------- */

  /**
   * Close every connection and drop all listeners. Afterwards `createInvite` / `acceptAnswer`
   * throw `disposed`; every other method is a harmless no-op. Idempotent.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stateThrottle.cancel();
    for (const entry of this.peers.values()) this.closeEntry(entry);
    this.peers.clear();
    this.listeners.clear();
    this.guestStreamHandlers.clear();
    this.remoteCommandHandlers.clear();
    this.programStream = null;
    this.latestRemoteState = null;
    this.snapshot = EMPTY_PEERS;
    this.snapshotDirty = false;
  }

  /* ============================================================== */
  /* Internals                                                       */
  /* ============================================================== */

  private assertAlive(): void {
    if (this.disposed) throw new P2PError("disposed");
  }

  private assertEntryAlive(entry: PeerEntry): void {
    this.assertAlive();
    if (entry.closed) throw new P2PError("bad-state");
  }

  private getFactory(): RtcFactory {
    this.factory ??= defaultRtcFactory();
    return this.factory;
  }

  private liveCount(): number {
    let n = 0;
    for (const entry of this.peers.values())
      if (entry.info.status !== "disconnected") n++;
    return n;
  }

  private buildUrl(role: PeerRole, code: string): string {
    const origin =
      this.options.origin ??
      (typeof location !== "undefined" ? location.origin : "");
    return role === "remote"
      ? buildRemoteUrl(origin, code)
      : buildJoinUrl(origin, code);
  }

  private newEntry(
    id: string,
    role: PeerRole,
    name: string | undefined,
    pc: RtcPeerConnectionLike,
  ): PeerEntry {
    this.nameCounters[role]++;
    const fallback = `${DEFAULT_NAMES[role]} ${this.nameCounters[role]}`;
    return {
      info: {
        id,
        role,
        name: sanitizeName(name, fallback),
        status: "connecting",
        gain: 1,
        muted: false,
      },
      visible: false,
      pc,
      dc: null,
      videoSender: null,
      audioSender: null,
      inbound: { video: null, audio: null },
      guestStream: null,
      answerSdp: null,
      answering: null,
      inviteTimer: null,
      graceTimer: null,
      limiter: new FixedWindowLimiter(MAX_MESSAGES_PER_SECOND, 1000),
      invalid: 0,
      lastStateJson: null,
      closed: false,
      abort: new AbortController(),
      cleanups: [],
    };
  }

  private guestEntry(peerId: string): PeerEntry | null {
    const entry = this.peers.get(peerId);
    if (!entry || this.disposed || entry.closed || entry.info.role !== "guest")
      return null;
    return entry;
  }

  private async addMediaTransceivers(
    entry: PeerEntry,
    role: PeerRole,
  ): Promise<void> {
    // Guests publish later (replaceTrack), so their transceivers must be sendrecv in the offer.
    // Viewers never publish: sendonly keeps their answer recvonly and wastes no decoder.
    const direction = role === "guest" ? "sendrecv" : "sendonly";
    const video = entry.pc.addTransceiver("video", { direction });
    const audio = entry.pc.addTransceiver("audio", { direction });
    entry.videoSender = video.sender;
    entry.audioSender = audio.sender;
    if (this.options.compactCodecs !== false) {
      const factory = this.getFactory();
      applyCompactCodecs(
        [audio, video],
        (kind) => factory.getCodecCapabilities?.(kind) ?? null,
      );
    }
    await this.applyProgramTracks(entry);
  }

  private async applyProgramTracks(entry: PeerEntry): Promise<void> {
    const stream = this.programStream;
    const video = stream?.getVideoTracks()[0] ?? null;
    const audio = stream?.getAudioTracks()[0] ?? null;
    const swap = async (
      sender: RtcSenderLike | null,
      track: MediaStreamTrack | null,
    ) => {
      if (!sender || sender.track === track) return;
      try {
        await sender.replaceTrack(track);
      } catch {
        /* sender closed or track ended: the next setProgramStream retries */
      }
    };
    await Promise.all([
      swap(entry.videoSender, video),
      swap(entry.audioSender, audio),
    ]);
  }

  /** Cap viewer/guest video bitrate once negotiated (mesh: host encodes per peer). */
  private async limitBitrate(entry: PeerEntry): Promise<void> {
    const kbps = this.options.maxPeerBitrateKbps ?? DEFAULT_PEER_BITRATE_KBPS;
    const sender = entry.videoSender;
    if (!(kbps > 0) || !sender?.getParameters || !sender.setParameters) return;
    try {
      const params = sender.getParameters();
      const encoding = params.encodings[0];
      if (!encoding) return;
      encoding.maxBitrate = Math.round(kbps * 1000);
      await sender.setParameters(params);
    } catch {
      /* optional optimisation */
    }
  }

  /* ---------------- connection events ---------------- */

  private attachPeerConnection(entry: PeerEntry): void {
    const { pc } = entry;
    const onConnection = (): void => this.onConnectionChange(entry);
    const onTrack = (ev: { track: MediaStreamTrack }): void =>
      this.onTrack(entry, ev.track);
    pc.addEventListener("connectionstatechange", onConnection);
    pc.addEventListener("iceconnectionstatechange", onConnection);
    pc.addEventListener("track", onTrack);
    entry.cleanups.push(() => {
      pc.removeEventListener("connectionstatechange", onConnection);
      pc.removeEventListener("iceconnectionstatechange", onConnection);
      pc.removeEventListener("track", onTrack);
    });
  }

  private attachChannel(entry: PeerEntry, dc: RtcDataChannelLike): void {
    entry.dc = dc;
    const onOpen = (): void => this.onChannelOpen(entry);
    const onMessage = (ev: { data: unknown }): void =>
      this.onChannelMessage(entry, ev.data);
    const onClose = (): void => this.markDisconnected(entry);
    dc.addEventListener("open", onOpen);
    dc.addEventListener("message", onMessage);
    dc.addEventListener("close", onClose);
    entry.cleanups.push(() => {
      dc.removeEventListener("open", onOpen);
      dc.removeEventListener("message", onMessage);
      dc.removeEventListener("close", onClose);
    });
  }

  private onConnectionChange(entry: PeerEntry): void {
    if (entry.closed || this.disposed) return;
    switch (connectionHealth(entry.pc)) {
      case "up":
        if (entry.graceTimer !== null) {
          clearTimeout(entry.graceTimer);
          entry.graceTimer = null;
        }
        if (entry.info.status === "connecting")
          this.patch(entry, { status: "connected" });
        break;
      case "down":
        // ICE "disconnected" often heals by itself: give it a grace period.
        entry.graceTimer ??= setTimeout(() => {
          entry.graceTimer = null;
          if (!entry.closed && connectionHealth(entry.pc) !== "up")
            this.markDisconnected(entry);
        }, this.options.disconnectGraceMs ?? DEFAULT_DISCONNECT_GRACE_MS);
        break;
      case "failed":
        this.markDisconnected(entry);
        break;
      default:
        break;
    }
  }

  private onTrack(entry: PeerEntry, track: MediaStreamTrack): void {
    if (entry.closed || entry.info.role !== "guest") return; // viewers/remotes never publish
    if (track.kind === "video") entry.inbound.video = track;
    else if (track.kind === "audio") entry.inbound.audio = track;
    else return;
    const { status } = entry.info;
    if (status === "waiting" || status === "on-air")
      this.publishGuestStream(entry);
  }

  private onChannelOpen(entry: PeerEntry): void {
    if (entry.closed) return;
    if (entry.info.status === "connecting")
      this.patch(entry, { status: "connected" });
    this.send(entry, { type: "hello", peerId: entry.info.id });
    if (entry.info.role === "remote" && this.latestRemoteState) {
      this.sendRemoteState(entry, this.latestRemoteState);
    }
  }

  /** Close + mark "disconnected" (idempotent). Failed, closed and channel-closed peers end here. */
  private markDisconnected(entry: PeerEntry): void {
    if (entry.closed) return;
    this.closeEntry(entry);
    this.patch(entry, { status: "disconnected" });
  }

  /** Release every resource of an entry. Never throws, never stops host-owned tracks. */
  private closeEntry(entry: PeerEntry): void {
    if (entry.closed) return;
    entry.closed = true;
    entry.abort.abort();
    if (entry.inviteTimer) clearTimeout(entry.inviteTimer);
    if (entry.graceTimer) clearTimeout(entry.graceTimer);
    entry.inviteTimer = null;
    entry.graceTimer = null;
    for (const cleanup of entry.cleanups) safely(cleanup);
    entry.cleanups = [];
    this.retractGuestStream(entry);
    // inbound tracks are ours to release; sender tracks (program) are NOT
    for (const track of [entry.inbound.video, entry.inbound.audio]) {
      if (track) safely(() => track.stop());
    }
    entry.inbound = { video: null, audio: null };
    const { dc, pc } = entry;
    if (dc) safely(() => dc.close());
    safely(() => pc.close());
  }

  /** Remove an entry that never became visible (failed createInvite). */
  private discard(entry: PeerEntry): void {
    this.closeEntry(entry);
    if (this.peers.get(entry.info.id) === entry)
      this.peers.delete(entry.info.id);
    if (entry.visible) this.changed();
  }

  private startInviteTimer(entry: PeerEntry): void {
    const ttl = this.options.inviteTtlMs ?? DEFAULT_INVITE_TTL_MS;
    if (!(ttl > 0)) return;
    entry.inviteTimer = setTimeout(() => {
      entry.inviteTimer = null;
      if (entry.answerSdp === null) this.discard(entry); // never answered: forget it
    }, ttl);
  }

  /* ---------------- guest stream ---------------- */

  private publishGuestStream(entry: PeerEntry): void {
    // `track` events are the normal path, but every pre-negotiated receiver already owns its
    // (muted until media flows) track: adopt those too so we never depend on event timing.
    for (const transceiver of entry.pc.getTransceivers()) {
      const track = transceiver.receiver.track;
      if (track.kind === "video" && !entry.inbound.video)
        entry.inbound.video = track;
      else if (track.kind === "audio" && !entry.inbound.audio)
        entry.inbound.audio = track;
    }
    const tracks = [entry.inbound.video, entry.inbound.audio].filter(
      (track): track is MediaStreamTrack => track !== null,
    );
    if (tracks.length === 0) return;
    const current = entry.guestStream;
    if (current) {
      const existing = current.getTracks();
      if (
        existing.length === tracks.length &&
        tracks.every((t) => existing.includes(t))
      )
        return;
    }
    entry.guestStream = this.getFactory().createMediaStream(tracks);
    this.emitGuestStream(entry.info.id, entry.guestStream);
  }

  private retractGuestStream(entry: PeerEntry): void {
    if (!entry.guestStream) return;
    entry.guestStream = null;
    this.emitGuestStream(entry.info.id, null);
  }

  private emitGuestStream(peerId: string, stream: MediaStream | null): void {
    for (const handler of [...this.guestStreamHandlers]) {
      this.guard(() => handler(peerId, stream));
    }
  }

  /* ---------------- ctl channel ---------------- */

  private send(entry: PeerEntry, message: HostToPeer): boolean {
    const dc = entry.dc;
    if (
      !dc ||
      dc.readyState !== "open" ||
      dc.bufferedAmount > MAX_BUFFERED_BYTES
    )
      return false;
    try {
      dc.send(encodeMessage(message));
      return true;
    } catch {
      return false;
    }
  }

  private onChannelMessage(entry: PeerEntry, raw: unknown): void {
    if (entry.closed || this.disposed) return;
    if (!entry.limiter.allow()) return; // flood: drop
    const message = parsePeerMessage(raw);
    if (!message) {
      if (++entry.invalid > MAX_INVALID_MESSAGES) this.markDisconnected(entry);
      return;
    }
    switch (message.type) {
      case "role":
        this.onRoleMessage(entry, message.role, message.name);
        break;
      case "join-request":
        this.onJoinRequest(entry, message.name);
        break;
      case "remote-cmd":
        if (entry.info.role === "remote")
          this.emitRemoteCommand(entry.info.id, message.cmd);
        break;
      default:
        // "sdp" / "ice": reserved for in-band renegotiation, intentionally unused in the MVP
        break;
    }
  }

  private onRoleMessage(
    entry: PeerEntry,
    role: PeerRole,
    rawName: string,
  ): void {
    const name = sanitizeName(rawName);
    if (name && name !== entry.info.name) this.patch(entry, { name });
    // A peer can never change the role its invite was created with. The one allowed
    // transition is a guest announcing "viewer": it leaves the green room / the air.
    if (role === "viewer" && entry.info.role === "guest") {
      const { status } = entry.info;
      if (status === "waiting" || status === "on-air") {
        this.retractGuestStream(entry);
        this.patch(entry, { status: "connected" });
      }
    }
  }

  private onJoinRequest(entry: PeerEntry, rawName: string): void {
    if (entry.info.role !== "guest") return; // viewers/remotes cannot ask to go on air
    const name = sanitizeName(rawName);
    if (name && name !== entry.info.name) this.patch(entry, { name });
    const { status } = entry.info;
    if (status === "connecting" || status === "connected") {
      this.patch(entry, { status: "waiting" });
      this.publishGuestStream(entry);
      this.send(entry, { type: "guest-approved" });
    } else if (status === "waiting") {
      this.send(entry, { type: "guest-approved" }); // resync an idempotent retry
    } else if (status === "on-air") {
      this.send(entry, { type: "guest-on-air" });
    }
  }

  private emitRemoteCommand(peerId: string, cmd: RemoteCommand): void {
    for (const handler of [...this.remoteCommandHandlers]) {
      this.guard(() => handler(peerId, cmd));
    }
  }

  private flushRemoteState(state: RemoteState): void {
    if (this.disposed) return;
    for (const entry of this.peers.values()) {
      if (entry.info.role === "remote" && !entry.closed)
        this.sendRemoteState(entry, state);
    }
  }

  private sendRemoteState(entry: PeerEntry, state: RemoteState): void {
    const json = JSON.stringify(state);
    if (json === entry.lastStateJson) return;
    if (this.send(entry, { type: "remote-state", state }))
      entry.lastStateJson = json;
  }

  /* ---------------- state / notifications ---------------- */

  private patch(
    entry: PeerEntry,
    change: Partial<Pick<PeerInfo, "name" | "status" | "gain" | "muted">>,
  ): void {
    const next: PeerInfo = { ...entry.info };
    let modified = false;
    if (change.name !== undefined && change.name !== next.name) {
      next.name = change.name;
      modified = true;
    }
    if (change.status !== undefined && change.status !== next.status) {
      next.status = change.status as PeerStatus;
      modified = true;
    }
    if (change.gain !== undefined && change.gain !== next.gain) {
      next.gain = change.gain;
      modified = true;
    }
    if (change.muted !== undefined && change.muted !== next.muted) {
      next.muted = change.muted;
      modified = true;
    }
    if (!modified) return;
    entry.info = next;
    if (entry.visible) this.changed();
  }

  private changed(): void {
    if (this.disposed) return;
    this.snapshotDirty = true;
    const peers = this.getPeers();
    for (const listener of [...this.listeners])
      this.guard(() => listener(peers));
    const { onPeersChange } = this.options;
    if (onPeersChange) this.guard(() => onPeersChange(peers));
  }

  /** Consumer callbacks must not be able to break the connection state machine. */
  private guard(fn: () => void): void {
    try {
      fn();
    } catch (error) {
      console.error("[p2p] listener threw", error);
    }
  }
}
