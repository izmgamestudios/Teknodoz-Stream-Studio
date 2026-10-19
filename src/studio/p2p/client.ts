// src/studio/p2p/client.ts
// StudioClient: the other side of a StudioHost invite (the /join page for viewers and guests,
// the /remote page for the phone controller).
//
// Flow: paste/scan/open the invite -> `StudioClient.acceptOffer(code)` -> show `answerCode` (copy,
// QR or link) to the host -> the host calls `acceptAnswer` -> the connection comes up and
// `status` moves from "connecting" to "connected".
//
//  - viewer: `onStream` delivers the program output.
//  - guest:  like a viewer, plus `startGuest(localStream, name)` publishes camera/mic into the
//            green room (tracks are swapped into the pre-negotiated senders with replaceTrack,
//            no renegotiation) and `onStatus` follows the host's decisions. Nothing leaves the
//            device before `startGuest` is called. Wear headphones: the program audio you
//            receive contains your own voice (no mix-minus).
//  - remote: `sendCommand` / `onRemoteState`.
//
// Tip: call `testMedia()` (media.ts) BEFORE `acceptOffer` on a guest page - once the user has
// granted camera/mic access browsers expose real LAN IPs instead of mDNS (*.local) names, which
// makes same-network connections much more reliable. There is no TURN server by design, so
// symmetric NAT / strict firewalls may still fail.
import type { PeerRole, RemoteCommand, RemoteState } from "../types";
import { P2PError } from "./errors";
import {
  encodeMessage,
  parseHostMessage,
  parseRemoteCommand,
  sanitizeName,
} from "./protocol";
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
import { decodeSignal, encodeSignal, waitForIceGathering } from "./signaling";
import type { PeerToHost } from "../types";

/**
 * - connecting:  answer not yet accepted by the host / transport not up
 * - connected:   transport up; viewer watching (or guest not yet asking to join)
 * - requesting:  guest sent `join-request`, waiting for the host to acknowledge
 * - waiting:     guest is in the green room (`guest-approved` / `guest-off-air`)
 * - on-air:      the host put this guest on air (`guest-on-air`)
 * - rejected:    the host refused this guest (`guest-rejected`); publishing was stopped
 * - disconnected: terminal (connection lost, closed or disposed)
 */
export type ClientStatus =
  | "connecting"
  | "connected"
  | "requesting"
  | "waiting"
  | "on-air"
  | "rejected"
  | "disconnected";

export interface AcceptOfferOptions {
  /** Display name announced to the host (sanitized, max 40 chars). */
  name?: string;
  /** Allow public STUN (the `usePublicStun` setting). Default false: LAN candidates only. */
  usePublicStun?: boolean;
  /** Platform access; inject a fake in unit tests. Default: the real browser APIs. */
  rtcFactory?: RtcFactory;
  /** ICE gathering budget in ms (default 4000). */
  iceTimeoutMs?: number;
  /** Transient ICE "disconnected" grace period before giving up (default 8000 ms). */
  disconnectGraceMs?: number;
}

export interface AcceptOfferResult {
  client: StudioClient;
  /** Hand this to the host (copy, QR or link). */
  answerCode: string;
}

const DEFAULT_DISCONNECT_GRACE_MS = 8_000;
const MAX_BUFFERED_BYTES = 256 * 1024;

export class StudioClient {
  readonly role: PeerRole;

  private readonly pc: RtcPeerConnectionLike;
  private readonly factory: RtcFactory;
  private readonly graceMs: number;
  private readonly streamListeners = new Set<(stream: MediaStream) => void>();
  private readonly statusListeners = new Set<(status: ClientStatus) => void>();
  private readonly stateListeners = new Set<(state: RemoteState) => void>();
  private readonly cleanups: Array<() => void> = [];
  /** Aborted on dispose so an in-flight ICE wait ends immediately. */
  private readonly abort = new AbortController();
  private readonly inbound: {
    video: MediaStreamTrack | null;
    audio: MediaStreamTrack | null;
  } = {
    video: null,
    audio: null,
  };
  private dc: RtcDataChannelLike | null = null;
  private mediaStream: MediaStream | null = null;
  private streamFlushQueued = false;
  private currentStatus: ClientStatus = "connecting";
  private currentPeerId: string | null = null;
  private currentName: string;
  private latestState: RemoteState | null = null;
  private joined = false;
  private joinPending = false;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  private constructor(
    pc: RtcPeerConnectionLike,
    factory: RtcFactory,
    role: PeerRole,
    name: string,
    graceMs: number,
  ) {
    this.pc = pc;
    this.factory = factory;
    this.role = role;
    this.currentName = name;
    this.graceMs = graceMs;
  }

  /**
   * Consume an invite (bare code, or a full /join /remote link) and produce the answer code.
   * Resolves after ICE gathering (<= `iceTimeoutMs`).
   * @throws SignalError (bad/corrupt/oversized/unsupported-version code) |
   *         P2PError unsupported | wrong-direction | bad-sdp | ice-failed
   */
  static async acceptOffer(
    code: string,
    opts: AcceptOfferOptions = {},
  ): Promise<AcceptOfferResult> {
    const payload = await decodeSignal(code);
    if (payload.type === "answer") throw new P2PError("wrong-direction");
    const role: PeerRole = payload.role ?? "viewer";
    const factory = opts.rtcFactory ?? defaultRtcFactory();
    const pc = factory.createPeerConnection(
      buildRtcConfig(opts.usePublicStun ?? false),
    );
    const client = new StudioClient(
      pc,
      factory,
      role,
      sanitizeName(opts.name),
      opts.disconnectGraceMs ?? DEFAULT_DISCONNECT_GRACE_MS,
    );
    try {
      client.attach();
      try {
        await pc.setRemoteDescription({ type: "offer", sdp: payload.sdp });
      } catch (cause) {
        throw new P2PError("bad-sdp", undefined, { cause });
      }
      if (role !== "remote") {
        // `track` events are the normal path; the receivers already own their tracks, so adopt
        // them directly too (covers browsers/timings where the event is late or missing).
        for (const transceiver of pc.getTransceivers())
          client.onTrack(transceiver.receiver.track);
      }
      if (role === "guest") {
        // JSEP creates answerer transceivers as recvonly. Switch to sendrecv BEFORE answering so
        // the host's pre-negotiated senders can be fed later with replaceTrack.
        for (const transceiver of pc.getTransceivers()) {
          safely(() => {
            transceiver.direction = "sendrecv";
          });
        }
      }
      const answer = await pc.createAnswer();
      client.assertAlive();
      await pc.setLocalDescription(answer);
      client.assertAlive();
      await waitForIceGathering(
        pc,
        opts.iceTimeoutMs ?? DEFAULT_ICE_TIMEOUT_MS,
        client.abort.signal,
      );
      client.assertAlive();
      const sdp = pc.localDescription?.sdp ?? answer.sdp ?? "";
      if (!/^a=candidate:/m.test(sdp)) throw new P2PError("ice-failed");
      const answerCode = await encodeSignal({
        v: 1,
        type: "answer",
        role,
        sdp,
      });
      client.assertAlive();
      return { client, answerCode };
    } catch (error) {
      client.dispose();
      throw error;
    }
  }

  /* -------------------------------------------------------------- */
  /* Observable state                                                */
  /* -------------------------------------------------------------- */

  get status(): ClientStatus {
    return this.currentStatus;
  }

  /** Id the host assigned to us (from its `hello`), null until the channel is up. */
  get peerId(): string | null {
    return this.currentPeerId;
  }

  get name(): string {
    return this.currentName;
  }

  /** Program stream (viewer/guest) once the offer's tracks exist, else null. */
  get stream(): MediaStream | null {
    return this.mediaStream;
  }

  get remoteState(): RemoteState | null {
    return this.latestState;
  }

  /**
   * Called when the program stream is available. The stream object is stable: the callback may
   * fire again with the SAME stream when a track is added. Invoked immediately if one already
   * exists. The tracks are muted until the host actually sends media. Returns unsubscribe.
   */
  onStream(listener: (stream: MediaStream) => void): () => void {
    this.streamListeners.add(listener);
    if (this.mediaStream)
      this.guard(() => listener(this.mediaStream as MediaStream));
    return () => {
      this.streamListeners.delete(listener);
    };
  }

  /** Status changes; invoked immediately with the current status. Returns unsubscribe. */
  onStatus(listener: (status: ClientStatus) => void): () => void {
    this.statusListeners.add(listener);
    this.guard(() => listener(this.currentStatus));
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  /** RemoteState pushes (remote role); invoked immediately if one was already received. */
  onRemoteState(listener: (state: RemoteState) => void): () => void {
    this.stateListeners.add(listener);
    if (this.latestState)
      this.guard(() => listener(this.latestState as RemoteState));
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  /* -------------------------------------------------------------- */
  /* Guest                                                           */
  /* -------------------------------------------------------------- */

  /**
   * Publish `localStream` (camera and/or mic) into the host's green room and ask to join.
   * Safe to call again (e.g. after switching camera) or after a rejection.
   * @throws P2PError wrong-role | bad-state (disconnected) | no-device (stream has no tracks)
   */
  async startGuest(localStream: MediaStream, name: string): Promise<void> {
    this.assertAlive();
    if (this.role !== "guest") throw new P2PError("wrong-role");
    if (this.currentStatus === "disconnected") throw new P2PError("bad-state");
    const video = localStream.getVideoTracks()[0] ?? null;
    const audio = localStream.getAudioTracks()[0] ?? null;
    if (!video && !audio) throw new P2PError("no-device");
    this.currentName = sanitizeName(name, this.currentName);
    try {
      await this.swapTracks(video, audio);
    } catch (error) {
      // don't leave half of the media attached when the request as a whole failed
      await this.swapTracks(null, null).catch(() => undefined);
      throw error;
    }
    this.assertAlive();
    this.joined = true;
    this.joinPending = true;
    this.setStatus("requesting");
    this.flushJoin();
  }

  /**
   * Stop publishing and leave the green room / the air. The connection stays up so the page
   * keeps watching the program as a viewer. The camera/mic tracks stay with the caller.
   */
  async leaveGuest(): Promise<void> {
    this.assertAlive();
    if (this.role !== "guest") throw new P2PError("wrong-role");
    this.joined = false;
    this.joinPending = false;
    await this.swapTracks(null, null);
    // The ctl protocol has no explicit "leave": a guest announcing role "viewer" means it
    // stepped down (see StudioHost.onRoleMessage).
    this.sendMessage({ type: "role", role: "viewer", name: this.currentName });
    if (this.isStatusActive()) this.setStatus("connected");
  }

  /* -------------------------------------------------------------- */
  /* Remote                                                          */
  /* -------------------------------------------------------------- */

  /**
   * Send a command to the studio (remote role). Returns false when the channel is not open or
   * the command is malformed (nothing is sent in either case).
   * @throws P2PError wrong-role | disposed
   */
  sendCommand(cmd: RemoteCommand): boolean {
    this.assertAlive();
    if (this.role !== "remote") throw new P2PError("wrong-role");
    const valid = parseRemoteCommand(cmd);
    if (!valid) return false;
    return this.sendMessage({ type: "remote-cmd", cmd: valid });
  }

  /** Close the connection and drop all listeners. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    if (this.graceTimer !== null) clearTimeout(this.graceTimer);
    this.graceTimer = null;
    for (const cleanup of this.cleanups) safely(cleanup);
    this.cleanups.length = 0;
    for (const track of [this.inbound.video, this.inbound.audio]) {
      if (track) safely(() => track.stop());
    }
    const { dc } = this;
    if (dc) safely(() => dc.close());
    safely(() => this.pc.close());
    this.joined = false;
    this.joinPending = false;
    this.setStatus("disconnected");
    this.statusListeners.clear();
    this.streamListeners.clear();
    this.stateListeners.clear();
  }

  /* ============================================================== */
  /* Internals                                                       */
  /* ============================================================== */

  private assertAlive(): void {
    if (this.disposed) throw new P2PError("disposed");
  }

  private attach(): void {
    const { pc } = this;
    const onConnection = (): void => this.onConnectionChange();
    const onTrack = (ev: { track: MediaStreamTrack }): void =>
      this.onTrack(ev.track);
    const onChannel = (ev: { channel: RtcDataChannelLike }): void =>
      this.onDataChannel(ev.channel);
    pc.addEventListener("connectionstatechange", onConnection);
    pc.addEventListener("iceconnectionstatechange", onConnection);
    pc.addEventListener("track", onTrack);
    pc.addEventListener("datachannel", onChannel);
    this.cleanups.push(() => {
      pc.removeEventListener("connectionstatechange", onConnection);
      pc.removeEventListener("iceconnectionstatechange", onConnection);
      pc.removeEventListener("track", onTrack);
      pc.removeEventListener("datachannel", onChannel);
    });
  }

  private onConnectionChange(): void {
    if (this.disposed) return;
    switch (connectionHealth(this.pc)) {
      case "up":
        if (this.graceTimer !== null) {
          clearTimeout(this.graceTimer);
          this.graceTimer = null;
        }
        if (this.currentStatus === "connecting") this.setStatus("connected");
        break;
      case "down":
        this.graceTimer ??= setTimeout(() => {
          this.graceTimer = null;
          if (!this.disposed && connectionHealth(this.pc) !== "up")
            this.dispose();
        }, this.graceMs);
        break;
      case "failed":
        this.dispose();
        break;
      default:
        break;
    }
  }

  private onTrack(track: MediaStreamTrack): void {
    if (this.disposed || this.role === "remote") return;
    if (track.kind === "video") this.inbound.video = track;
    else if (track.kind === "audio") this.inbound.audio = track;
    else return;
    // Both pre-negotiated tracks arrive in the same setRemoteDescription: coalesce into one stream.
    if (this.streamFlushQueued) return;
    this.streamFlushQueued = true;
    queueMicrotask(() => {
      this.streamFlushQueued = false;
      this.flushStream();
    });
  }

  private flushStream(): void {
    if (this.disposed) return;
    const tracks = [this.inbound.video, this.inbound.audio].filter(
      (track): track is MediaStreamTrack => track !== null,
    );
    if (tracks.length === 0) return;
    let stream = this.mediaStream;
    if (!stream) {
      stream = this.factory.createMediaStream(tracks);
      this.mediaStream = stream;
    } else {
      const have = stream.getTracks();
      const missing = tracks.filter((track) => !have.includes(track));
      if (missing.length === 0) return;
      for (const track of missing) stream.addTrack(track);
    }
    const ready = stream;
    for (const listener of [...this.streamListeners])
      this.guard(() => listener(ready));
  }

  private onDataChannel(channel: RtcDataChannelLike): void {
    // Only the host's single "ctl" channel is meaningful; ignore anything else.
    if (this.disposed || channel.label !== "ctl" || this.dc) return;
    this.dc = channel;
    const onOpen = (): void => this.onChannelOpen();
    const onMessage = (ev: { data: unknown }): void =>
      this.onChannelMessage(ev.data);
    const onClose = (): void => this.dispose();
    channel.addEventListener("open", onOpen);
    channel.addEventListener("message", onMessage);
    channel.addEventListener("close", onClose);
    this.cleanups.push(() => {
      channel.removeEventListener("open", onOpen);
      channel.removeEventListener("message", onMessage);
      channel.removeEventListener("close", onClose);
    });
    if (channel.readyState === "open") this.onChannelOpen();
  }

  private onChannelOpen(): void {
    if (this.disposed) return;
    if (this.currentStatus === "connecting") this.setStatus("connected");
    this.sendMessage({ type: "role", role: this.role, name: this.currentName });
    this.flushJoin();
  }

  private onChannelMessage(raw: unknown): void {
    if (this.disposed) return;
    const message = parseHostMessage(raw);
    if (!message) return;
    switch (message.type) {
      case "hello":
        this.currentPeerId = message.peerId;
        break;
      case "remote-state":
        if (this.role !== "remote") break;
        this.latestState = message.state;
        for (const listener of [...this.stateListeners]) {
          this.guard(() => listener(message.state));
        }
        break;
      case "guest-approved":
        if (this.joined) this.setStatus("waiting");
        break;
      case "guest-on-air":
        if (this.joined) this.setStatus("on-air");
        break;
      case "guest-off-air":
        if (this.joined) this.setStatus("waiting");
        break;
      case "guest-rejected":
        if (this.joined) {
          this.joined = false;
          this.joinPending = false;
          // stop sending media the moment we are refused
          void this.swapTracks(null, null).catch(() => undefined);
          this.setStatus("rejected");
        }
        break;
      default:
        // "sdp" / "ice": reserved for in-band renegotiation, intentionally unused in the MVP
        break;
    }
  }

  private flushJoin(): void {
    if (!this.joinPending || !this.joined) return;
    if (this.sendMessage({ type: "join-request", name: this.currentName })) {
      this.joinPending = false;
    }
  }

  private sendMessage(message: PeerToHost): boolean {
    const dc = this.dc;
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

  private senders(): {
    video: RtcSenderLike | null;
    audio: RtcSenderLike | null;
  } {
    let video: RtcSenderLike | null = null;
    let audio: RtcSenderLike | null = null;
    for (const transceiver of this.pc.getTransceivers()) {
      const kind = transceiver.receiver.track.kind;
      if (kind === "video" && !video) video = transceiver.sender;
      else if (kind === "audio" && !audio) audio = transceiver.sender;
    }
    return { video, audio };
  }

  private async swapTracks(
    video: MediaStreamTrack | null,
    audio: MediaStreamTrack | null,
  ): Promise<void> {
    const senders = this.senders();
    const swap = async (
      sender: RtcSenderLike | null,
      track: MediaStreamTrack | null,
    ) => {
      if (!sender || sender.track === track) return;
      await sender.replaceTrack(track);
    };
    // the offer always carries both pre-negotiated senders; none means a foreign/odd offer
    if (!senders.video && !senders.audio) throw new P2PError("bad-state");
    // wait for BOTH swaps to settle so a caller's rollback never races an in-flight replaceTrack
    const results = await Promise.allSettled([
      swap(senders.video, video),
      swap(senders.audio, audio),
    ]);
    const failed = results.find(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    if (failed) throw failed.reason;
  }

  private isStatusActive(): boolean {
    return (
      this.currentStatus === "requesting" ||
      this.currentStatus === "waiting" ||
      this.currentStatus === "on-air" ||
      this.currentStatus === "rejected"
    );
  }

  private setStatus(status: ClientStatus): void {
    if (this.currentStatus === "disconnected" && status !== "disconnected")
      return; // terminal
    if (status === this.currentStatus) return;
    this.currentStatus = status;
    for (const listener of [...this.statusListeners])
      this.guard(() => listener(status));
  }

  private guard(fn: () => void): void {
    try {
      fn();
    } catch (error) {
      console.error("[p2p] listener threw", error);
    }
  }
}
