// src/studio/p2p/__fakes__/fake-rtc.ts
// In-memory stand-in for the WebRTC pieces host.ts / client.ts use (jsdom has no WebRTC).
// It models just enough of JSEP to exercise the real state machines end to end:
//  - offers/answers are fake SDP strings carrying an `a=x-fake-id` link to the creating pc
//  - setRemoteDescription(offer) mirrors the offered m-sections as recvonly transceivers (as
//    real browsers do) and fires `track` for sections the offerer sends on
//  - setRemoteDescription(answer) links the two peers and, on the next microtask, "connects" them:
//    connection state events, the client's `datachannel` event, then `open` on both channels
//  - data channel `send` delivers synchronously to the paired channel
// Not exported from index.ts.
import type {
  RtcCodec,
  RtcDataChannelEventMap,
  RtcDataChannelLike,
  RtcFactory,
  RtcPeerConnectionEventMap,
  RtcPeerConnectionLike,
  RtcSenderLike,
  RtcTransceiverLike,
} from "../rtc";

type Listener = (ev: unknown) => void;

class Bus {
  private readonly map = new Map<string, Set<Listener>>();
  on(type: string, fn: Listener): void {
    let set = this.map.get(type);
    if (!set) this.map.set(type, (set = new Set()));
    set.add(fn);
  }
  off(type: string, fn: Listener): void {
    this.map.get(type)?.delete(fn);
  }
  emit(type: string, ev: unknown = {}): void {
    for (const fn of [...(this.map.get(type) ?? [])]) fn(ev);
  }
  count(type: string): number {
    return this.map.get(type)?.size ?? 0;
  }
}

/* ---------------- media ---------------- */

let trackCounter = 0;

export class FakeTrack {
  readonly id = `track-${++trackCounter}`;
  readyState: "live" | "ended" = "live";
  stopCalls = 0;
  constructor(readonly kind: "audio" | "video") {}
  stop(): void {
    this.stopCalls++;
    this.readyState = "ended";
  }
}

export class FakeStream {
  readonly id = `stream-${++trackCounter}`;
  constructor(public tracks: FakeTrack[] = []) {}
  getTracks(): FakeTrack[] {
    return [...this.tracks];
  }
  getVideoTracks(): FakeTrack[] {
    return this.tracks.filter((t) => t.kind === "video");
  }
  getAudioTracks(): FakeTrack[] {
    return this.tracks.filter((t) => t.kind === "audio");
  }
  addTrack(track: FakeTrack): void {
    if (!this.tracks.includes(track)) this.tracks.push(track);
  }
}

export function fakeTrack(kind: "audio" | "video"): MediaStreamTrack {
  return new FakeTrack(kind) as unknown as MediaStreamTrack;
}

export function fakeStream(...kinds: Array<"audio" | "video">): MediaStream {
  return new FakeStream(
    kinds.map((k) => new FakeTrack(k)),
  ) as unknown as MediaStream;
}

export function asFake(track: MediaStreamTrack): FakeTrack {
  return track as unknown as FakeTrack;
}

/* ---------------- transceivers ---------------- */

export class FakeSender implements RtcSenderLike {
  track: MediaStreamTrack | null = null;
  readonly replaced: Array<MediaStreamTrack | null> = [];
  failReplace = false;
  parameters = { encodings: [{} as { maxBitrate?: number }] };
  setParametersCalls = 0;
  replaceTrack(track: MediaStreamTrack | null): Promise<void> {
    if (this.failReplace) return Promise.reject(new Error("replace failed"));
    this.track = track;
    this.replaced.push(track);
    return Promise.resolve();
  }
  getParameters(): RTCRtpSendParameters {
    return this.parameters as unknown as RTCRtpSendParameters;
  }
  setParameters(parameters: RTCRtpSendParameters): Promise<void> {
    this.setParametersCalls++;
    this.parameters = parameters as unknown as typeof this.parameters;
    return Promise.resolve();
  }
}

export class FakeTransceiver implements RtcTransceiverLike {
  mid: string | null = null;
  readonly sender = new FakeSender();
  readonly receiver: { track: MediaStreamTrack };
  codecPrefs: RtcCodec[] | null = null;
  offeredDirection: RTCRtpTransceiverDirection = "inactive";
  throwOnCodecPrefs = false;
  constructor(
    readonly kind: "audio" | "video",
    public direction: RTCRtpTransceiverDirection,
  ) {
    this.receiver = { track: fakeTrack(kind) };
  }
  setCodecPreferences(codecs: RtcCodec[]): void {
    if (this.throwOnCodecPrefs)
      throw new DOMException("bad codec", "InvalidAccessError");
    this.codecPrefs = codecs;
  }
}

function sends(d: RTCRtpTransceiverDirection): boolean {
  return d === "sendrecv" || d === "sendonly";
}
function receives(d: RTCRtpTransceiverDirection): boolean {
  return d === "sendrecv" || d === "recvonly";
}

/** JSEP direction negotiation from the answerer's point of view. */
export function answerDirection(
  offered: RTCRtpTransceiverDirection,
  ours: RTCRtpTransceiverDirection,
): RTCRtpTransceiverDirection {
  const weSend = sends(ours) && receives(offered);
  const weRecv = receives(ours) && sends(offered);
  if (weSend && weRecv) return "sendrecv";
  if (weSend) return "sendonly";
  if (weRecv) return "recvonly";
  return "inactive";
}

/* ---------------- data channel ---------------- */

export class FakeDataChannel implements RtcDataChannelLike {
  readyState: RTCDataChannelState = "connecting";
  bufferedAmount = 0;
  readonly sent: string[] = [];
  peer: FakeDataChannel | null = null;
  throwOnSend = false;
  private readonly bus = new Bus();
  constructor(readonly label: string) {}
  addEventListener<K extends keyof RtcDataChannelEventMap>(
    type: K,
    listener: (ev: RtcDataChannelEventMap[K]) => void,
  ): void {
    this.bus.on(type, listener as Listener);
  }
  removeEventListener<K extends keyof RtcDataChannelEventMap>(
    type: K,
    listener: (ev: RtcDataChannelEventMap[K]) => void,
  ): void {
    this.bus.off(type, listener as Listener);
  }
  listenerCount(type: keyof RtcDataChannelEventMap): number {
    return this.bus.count(type);
  }
  send(data: string): void {
    if (this.readyState !== "open" || this.throwOnSend)
      throw new Error("channel not open");
    this.sent.push(data);
    this.peer?.receive(data);
  }
  /** Deliver raw data as if the remote end had sent it. */
  receive(data: unknown): void {
    if (this.readyState === "open") this.bus.emit("message", { data });
  }
  /** Transition to open without firing the event (the remote end may observe it first). */
  setOpen(): void {
    if (this.readyState !== "closed") this.readyState = "open";
  }
  emitOpen(): void {
    if (this.readyState === "open") this.bus.emit("open");
  }
  markOpen(): void {
    this.setOpen();
    this.emitOpen();
  }
  close(): void {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    this.bus.emit("close");
    const peer = this.peer;
    if (peer && peer.readyState !== "closed") peer.close();
  }
  /** Parsed JSON of everything sent so far. */
  sentMessages(): Array<Record<string, unknown>> {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

/* ---------------- peer connection ---------------- */

export interface FakePcOptions {
  /** Never reach iceGatheringState "complete" (to test the gathering timeout). */
  neverGather?: boolean;
  /** Produce an SDP without any a=candidate line. */
  noCandidates?: boolean;
  /** Reject setRemoteDescription. */
  rejectRemote?: boolean;
  /** Never fire `track` events (receivers still exist and own their tracks). */
  suppressTrackEvents?: boolean;
  /** Make every transceiver's setCodecPreferences throw InvalidAccessError. */
  throwOnCodecPrefs?: boolean;
}

export class FakeNetwork {
  readonly pcs: FakePeerConnection[] = [];
  autoConnect = true;
  options: FakePcOptions = {};
  private nextId = 1;

  createPc(config: RTCConfiguration): FakePeerConnection {
    const pc = new FakePeerConnection(this, `pc${this.nextId++}`, config);
    this.pcs.push(pc);
    return pc;
  }
  byId(id: string): FakePeerConnection | undefined {
    return this.pcs.find((pc) => pc.id === id);
  }
  /** Complete the handshake between a linked offerer and answerer. */
  connect(offerer: FakePeerConnection, answerer: FakePeerConnection): void {
    if (offerer.closed || answerer.closed) return;
    // The answerer learns about the channels the offerer created. As with real SCTP the
    // receiving side's channel is already "open" when its `datachannel` event fires.
    const fresh: FakeDataChannel[] = [];
    for (const hostDc of offerer.channels) {
      if (hostDc.peer) continue;
      const clientDc = new FakeDataChannel(hostDc.label);
      clientDc.peer = hostDc;
      hostDc.peer = clientDc;
      answerer.channels.push(clientDc);
      hostDc.setOpen();
      clientDc.setOpen();
      fresh.push(clientDc);
    }
    offerer.setHealth("connected");
    answerer.setHealth("connected");
    for (const clientDc of fresh)
      answerer.bus.emit("datachannel", { channel: clientDc });
    for (const hostDc of offerer.channels) hostDc.emitOpen();
  }
}

export class FakePeerConnection implements RtcPeerConnectionLike {
  signalingState: RTCSignalingState = "stable";
  connectionState: RTCPeerConnectionState = "new";
  iceConnectionState: RTCIceConnectionState = "new";
  iceGatheringState: RTCIceGatheringState = "new";
  localDescription: { type: string; sdp: string } | null = null;
  remoteDescription: { type: string; sdp: string } | null = null;
  readonly transceivers: FakeTransceiver[] = [];
  readonly channels: FakeDataChannel[] = [];
  readonly bus = new Bus();
  closed = false;
  remote: FakePeerConnection | null = null;
  /** SDP we created; the final localDescription adds gathered candidates. */
  private pendingSdp = "";

  constructor(
    private readonly network: FakeNetwork,
    readonly id: string,
    readonly config: RTCConfiguration,
  ) {}

  /* ----- events ----- */
  addEventListener<K extends keyof RtcPeerConnectionEventMap>(
    type: K,
    listener: (ev: RtcPeerConnectionEventMap[K]) => void,
  ): void {
    this.bus.on(type, listener as Listener);
  }
  removeEventListener<K extends keyof RtcPeerConnectionEventMap>(
    type: K,
    listener: (ev: RtcPeerConnectionEventMap[K]) => void,
  ): void {
    this.bus.off(type, listener as Listener);
  }
  listenerCount(type: keyof RtcPeerConnectionEventMap): number {
    return this.bus.count(type);
  }

  /** Drive the connection state from tests ("disconnected", "failed", ...). */
  setHealth(state: "connected" | "disconnected" | "failed" | "closed"): void {
    this.connectionState = state;
    this.iceConnectionState = state;
    this.bus.emit("connectionstatechange");
    this.bus.emit("iceconnectionstatechange");
  }

  /* ----- media / channels ----- */
  createDataChannel(label: string): RtcDataChannelLike {
    const dc = new FakeDataChannel(label);
    this.channels.push(dc);
    return dc;
  }
  addTransceiver(
    kind: "audio" | "video",
    init?: RTCRtpTransceiverInit,
  ): RtcTransceiverLike {
    const t = new FakeTransceiver(kind, init?.direction ?? "sendrecv");
    t.throwOnCodecPrefs = this.network.options.throwOnCodecPrefs ?? false;
    this.transceivers.push(t);
    return t;
  }
  getTransceivers(): RtcTransceiverLike[] {
    return [...this.transceivers];
  }

  /* ----- SDP ----- */
  private buildSdp(type: "offer" | "answer"): string {
    const lines = [
      "v=0",
      `o=- ${this.id} 2 IN IP4 127.0.0.1`,
      "s=-",
      "t=0 0",
      `a=x-fake-id:${this.id}`,
    ];
    this.transceivers.forEach((t, i) => {
      const direction =
        type === "offer"
          ? t.direction
          : answerDirection(t.offeredDirection, t.direction);
      lines.push(
        `m=${t.kind} 9 UDP/TLS/RTP/SAVPF 111`,
        `a=mid:${i}`,
        `a=${direction}`,
      );
    });
    if (this.channels.length > 0) {
      lines.push(
        "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
        `a=mid:${this.transceivers.length}`,
      );
    }
    return lines.join("\r\n") + "\r\n";
  }

  createOffer(): Promise<RTCSessionDescriptionInit> {
    return Promise.resolve({ type: "offer", sdp: this.buildSdp("offer") });
  }
  createAnswer(): Promise<RTCSessionDescriptionInit> {
    if (this.signalingState !== "have-remote-offer") {
      return Promise.reject(new DOMException("no offer", "InvalidStateError"));
    }
    return Promise.resolve({ type: "answer", sdp: this.buildSdp("answer") });
  }

  setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.pendingSdp = description.sdp ?? "";
    this.signalingState =
      description.type === "offer" ? "have-local-offer" : "stable";
    // like real browsers, gathered candidates show up in localDescription as they are found
    const candidate = this.network.options.noCandidates
      ? ""
      : "a=candidate:1 1 udp 2122260223 192.168.1.5 50000 typ host\r\n";
    this.localDescription = {
      type: description.type,
      sdp: this.pendingSdp + candidate,
    };
    this.iceGatheringState = "gathering";
    this.bus.emit("icegatheringstatechange");
    if (!this.network.options.neverGather) {
      queueMicrotask(() => {
        if (this.closed) return;
        this.iceGatheringState = "complete";
        this.bus.emit("icegatheringstatechange");
      });
    }
    return Promise.resolve();
  }

  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    const sdp = description.sdp ?? "";
    const link = /^a=x-fake-id:(.+)\r?$/m.exec(sdp);
    if (this.network.options.rejectRemote || !sdp.startsWith("v=0") || !link) {
      return Promise.reject(
        new DOMException("Failed to parse SDP", "InvalidAccessError"),
      );
    }
    const other = this.network.byId((link[1] ?? "").trim());
    if (description.type === "offer") {
      this.remote = other ?? null;
      this.remoteDescription = { type: "offer", sdp };
      this.signalingState = "have-remote-offer";
      const sections = [
        ...sdp.matchAll(
          /^m=(audio|video) .*\r?\n(?:.*\r?\n)*?a=(sendrecv|sendonly|recvonly|inactive)/gm,
        ),
      ];
      for (const m of sections) {
        const kind = m[1] as "audio" | "video";
        const offered = m[2] as RTCRtpTransceiverDirection;
        const t = new FakeTransceiver(kind, "recvonly"); // JSEP: answerer starts recvonly
        t.offeredDirection = offered;
        this.transceivers.push(t);
        if (sends(offered) && !this.network.options.suppressTrackEvents) {
          this.bus.emit("track", {
            track: t.receiver.track,
            transceiver: t,
            streams: [],
          });
        }
      }
      return Promise.resolve();
    }
    // answer
    if (this.signalingState !== "have-local-offer") {
      return Promise.reject(
        new DOMException("wrong state", "InvalidStateError"),
      );
    }
    this.remote = other ?? null;
    this.remoteDescription = { type: "answer", sdp };
    this.signalingState = "stable";
    const answered = [
      ...sdp.matchAll(
        /^m=(audio|video) .*\r?\n(?:.*\r?\n)*?a=(sendrecv|sendonly|recvonly|inactive)/gm,
      ),
    ];
    answered.forEach((m, i) => {
      const t = this.transceivers[i];
      if (
        t &&
        sends(m[2] as RTCRtpTransceiverDirection) &&
        !this.network.options.suppressTrackEvents
      ) {
        this.bus.emit("track", {
          track: t.receiver.track,
          transceiver: t,
          streams: [],
        });
      }
    });
    if (this.network.autoConnect && other) {
      queueMicrotask(() => this.network.connect(this, other));
    }
    return Promise.resolve();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.signalingState = "closed";
    this.connectionState = "closed";
    this.iceConnectionState = "closed";
    for (const dc of this.channels) dc.close();
  }
}

/* ---------------- factory ---------------- */

export const CHROME_LIKE_AUDIO: RtcCodec[] = [
  { mimeType: "audio/opus", clockRate: 48000, channels: 2 },
  { mimeType: "audio/red", clockRate: 48000, channels: 2 },
  { mimeType: "audio/G722", clockRate: 8000, channels: 1 },
  { mimeType: "audio/PCMU", clockRate: 8000, channels: 1 },
  { mimeType: "audio/PCMA", clockRate: 8000, channels: 1 },
  { mimeType: "audio/CN", clockRate: 8000, channels: 1 },
  { mimeType: "audio/telephone-event", clockRate: 8000, channels: 1 },
];

export const CHROME_LIKE_VIDEO: RtcCodec[] = [
  { mimeType: "video/VP8", clockRate: 90000 },
  { mimeType: "video/VP9", clockRate: 90000, sdpFmtpLine: "profile-id=0" },
  { mimeType: "video/AV1", clockRate: 90000 },
  {
    mimeType: "video/H264",
    clockRate: 90000,
    sdpFmtpLine: "profile-level-id=42e01f",
  },
  { mimeType: "video/rtx", clockRate: 90000 },
  { mimeType: "video/red", clockRate: 90000 },
  { mimeType: "video/ulpfec", clockRate: 90000 },
];

export function fakeRtcFactory(
  network: FakeNetwork,
  withCodecs = true,
): RtcFactory {
  return {
    createPeerConnection: (config) => network.createPc(config),
    createMediaStream: (tracks) =>
      new FakeStream(
        tracks as unknown as FakeTrack[],
      ) as unknown as MediaStream,
    ...(withCodecs
      ? {
          getCodecCapabilities: (kind: "audio" | "video") =>
            kind === "audio" ? [...CHROME_LIKE_AUDIO] : [...CHROME_LIKE_VIDEO],
        }
      : {}),
  };
}

/** Let queued microtasks (fake connect, stream coalescing) run. */
export async function settle(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}
