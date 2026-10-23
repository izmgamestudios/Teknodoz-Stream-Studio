// src/studio/podcast/host.ts
// The moderator side of a podcast room, independent of the video studio runtime:
//   room (short code, waiting pool)  +  P2P host (audio-only seats)  +  a small audio mixer
//   +  the two prompters (guest text goes out, the admin note never does)  +  audio recorder.
// Mix: host microphone (voice chain) + every on-air, un-muted guest -> one stream that goes to
// guests and listeners (program) and to the recorder.
import { VoiceProcessor } from "../engine/voice";
import { StudioHost } from "../p2p";
import { RoomHostSession, type RoomSnapshot } from "../room/host-session";
import { createKvStore } from "../storage";
import type { PeerInfo, PodcastPrompter, RemoteCommand } from "../types";
import {
  uploadMedia,
  type Chapter,
  type UploadResult,
} from "../watch/media-client";
import {
  openPodcastMic,
  podcastLink,
  type MediaDevicesLike,
  type OpenedMic,
} from "./mic";
import { normalizePrompter, stepSpeed } from "./prompter";
import type { PodcastVoicePlan } from "./voice-setup";

/** Gains of the guests that belong in the mix (on air and not muted); everybody else is silent. */
export function mixTargets(peers: readonly PeerInfo[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of peers) {
    if (p.role !== "guest") continue;
    out.set(p.id, p.status === "on-air" && !p.muted ? p.gain : 0);
  }
  return out;
}

/** localStorage wrapper that keeps the podcast room apart from the video studio's room. */
export function prefixedStorage(prefix: string, base: Storage | null) {
  if (!base) return null;
  return {
    getItem: (k: string) => base.getItem(prefix + k),
    setItem: (k: string, v: string) => base.setItem(prefix + k, v),
    removeItem: (k: string) => base.removeItem(prefix + k),
  };
}

export interface PodcastSnapshot {
  readonly phase: "idle" | "starting" | "live" | "error";
  readonly error: string | null;
  readonly room: RoomSnapshot | null;
  readonly peers: readonly PeerInfo[];
  readonly micMuted: boolean;
  /** the moderator hears the guests (use headphones) */
  readonly monitorOn: boolean;
  readonly micLabel: string;
  readonly voice: PodcastVoicePlan["summary"] | null;
  readonly recording: { on: boolean; startedAt: number | null };
  readonly lastRecording: { blob: Blob; ms: number; markers: Chapter[] } | null;
  readonly guestPrompter: PodcastPrompter;
  readonly autoOnAir: boolean;
  /** public live stream for a big audience (HTTP relay), null while off */
  readonly broadcast: { link: string; listeners: number } | null;
  readonly links: { guest: string; listener: string; remote: string } | null;
}

export interface PodcastHostDeps {
  mediaDevices?: MediaDevicesLike;
  origin?: string;
}

type Level = { an: AnalyserNode; buf: Uint8Array<ArrayBuffer> };

export class PodcastHost {
  private p2p: StudioHost | null = null;
  private session: RoomHostSession | null = null;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private mic: OpenedMic | null = null;
  private voice: VoiceProcessor | null = null;
  private micGain: GainNode | null = null;
  private guests = new Map<
    string,
    { src: MediaStreamAudioSourceNode; gain: GainNode; el: HTMLAudioElement }
  >();
  private levels = new Map<string, Level>();
  /** what the moderator hears in the headphones: the on-air guests (never their own mic) */
  private monitor: GainNode | null = null;
  /** mix-minus buses: what guest `id` hears = host mic + every other guest, never itself */
  private rets = new Map<
    string,
    { dest: MediaStreamAudioDestinationNode; wired: Set<string> }
  >();
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private markers: Chapter[] = [];
  private offs: Array<() => void> = [];
  private bcast: {
    id: string;
    token: string;
    link: string;
    listeners: number;
    rec: MediaRecorder;
    queue: Promise<void>;
    poll: ReturnType<typeof setInterval>;
  } | null = null;
  private airTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private snap: PodcastSnapshot;
  private state = {
    phase: "idle" as PodcastSnapshot["phase"],
    error: null as string | null,
    micMuted: false,
    monitorOn: true,
    recordingStartedAt: null as number | null,
    last: null as PodcastSnapshot["lastRecording"],
    prompter: normalizePrompter({}),
    autoOnAir: true,
  };

  constructor(private readonly deps: PodcastHostDeps = {}) {
    this.snap = this.build();
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getSnapshot = (): PodcastSnapshot => this.snap;

  private origin(): string {
    return (
      this.deps.origin ??
      (typeof location === "undefined" ? "" : location.origin)
    );
  }

  private build(): PodcastSnapshot {
    const room = this.session?.getSnapshot() ?? null;
    const code = room?.code ?? null;
    return {
      phase: this.state.phase,
      error: this.state.error,
      room,
      peers: this.p2p?.getPeers() ?? [],
      micMuted: this.state.micMuted,
      monitorOn: this.state.monitorOn,
      micLabel: this.mic?.label ?? "",
      voice: this.mic?.plan.summary ?? null,
      recording: {
        on: this.recorder?.state === "recording",
        startedAt: this.state.recordingStartedAt,
      },
      lastRecording: this.state.last,
      guestPrompter: this.state.prompter,
      autoOnAir: this.state.autoOnAir,
      broadcast: this.bcast
        ? { link: this.bcast.link, listeners: this.bcast.listeners }
        : null,
      links: code
        ? {
            remote: podcastLink(this.origin(), code, "remote"),
            guest: podcastLink(this.origin(), code, "guest"),
            listener: podcastLink(this.origin(), code, "listener"),
          }
        : null,
    };
  }
  private emit(): void {
    this.snap = this.build();
    this.pushRemoteState();
    for (const l of [...this.listeners]) l();
  }

  /* ------------------------------- lifecycle ------------------------------- */

  /** Opens the microphone, the mixer and the room. Call from a click (autoplay / mic permission). */
  async start(
    opts: { deviceId?: string; strong?: boolean } = {},
  ): Promise<boolean> {
    if (this.state.phase === "starting" || this.state.phase === "live")
      return true;
    this.state.phase = "starting";
    this.state.error = null;
    this.emit();
    try {
      const devices =
        this.deps.mediaDevices ?? (navigator.mediaDevices as MediaDevicesLike);
      const mic = await openPodcastMic(devices, opts);
      this.mic = mic;
      const ctx = new AudioContext({
        latencyHint: "interactive",
        sampleRate: 48_000,
      });
      await ctx.resume().catch(() => undefined);
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.dest = ctx.createMediaStreamDestination();
      // two people talking at once add up: a fast limiter keeps the mix (and the WAV) off 0 dBFS
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -4;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.12;
      this.master.connect(limiter);
      limiter.connect(this.dest);
      this.monitor = ctx.createGain();
      this.monitor.gain.value = this.state.monitorOn ? 1 : 0;
      this.monitor.connect(ctx.destination);

      // host microphone through the voice chain
      this.voice = new VoiceProcessor();
      const processed = await this.voice.attach(mic.stream, mic.plan.settings);
      const src = ctx.createMediaStreamSource(processed);
      this.micGain = ctx.createGain();
      this.micGain.gain.value = this.state.micMuted ? 0 : 1;
      src.connect(this.micGain);
      this.micGain.connect(this.master);
      this.tap("host", this.micGain);

      const p2p = new StudioHost({ usePublicStun: true });
      this.p2p = p2p;
      p2p.setProgramStream(this.dest.stream);
      this.offs.push(
        p2p.subscribe(() => this.onPeers()),
        p2p.onGuestStream((id, stream) => this.onGuestStream(id, stream)),
        p2p.onRemoteCommand((_id, cmd) => this.onRemote(cmd)),
      );
      const session = new RoomHostSession({
        bridge: {
          createInvite: (role, name, o) => p2p.createInvite(role, name, o),
          acceptAnswer: (id, code) => p2p.acceptAnswer(id, code),
          kickPeer: (id) => p2p.kick(id),
          getPeers: () => p2p.getPeers(),
          subscribePeers: (cb) => p2p.subscribe(() => cb()),
        },
        kv: createKvStore(),
        storage: prefixedStorage(
          "podcast:",
          typeof localStorage === "undefined" ? null : localStorage,
        ),
      });
      this.session = session;
      this.offs.push(session.subscribe(() => this.emit()));
      const ok = await session.open();
      if (!ok) throw new Error(session.getSnapshot().error ?? "room");
      this.state.phase = "live";
      this.emit();
      return true;
    } catch (e) {
      this.state.phase = "error";
      this.state.error = e instanceof Error ? e.message : "error";
      this.teardown();
      this.emit();
      return false;
    }
  }

  async stop(): Promise<void> {
    await this.stopBroadcast();
    if (this.recorder?.state === "recording") await this.stopRecording();
    await this.session?.close().catch(() => undefined);
    this.teardown();
    this.state.phase = "idle";
    this.emit();
  }

  private teardown(): void {
    if (this.airTimer) clearTimeout(this.airTimer);
    this.airTimer = null;
    for (const off of this.offs.splice(0)) off();
    for (const g of this.guests.values()) {
      g.el.srcObject = null;
      g.src.disconnect();
    }
    this.guests.clear();
    this.rets.clear();
    this.levels.clear();
    this.session?.dispose();
    this.p2p?.dispose();
    this.voice?.detach();
    this.mic?.stream.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => undefined);
    this.monitor = null;
    this.session =
      this.p2p =
      this.ctx =
      this.master =
      this.dest =
      this.mic =
      this.voice =
      this.micGain =
        null;
  }

  /* --------------------------------- mixer --------------------------------- */

  private tap(id: string, node: AudioNode): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    node.connect(an);
    this.levels.set(id, { an, buf: new Uint8Array(an.fftSize) });
  }

  /** 0..1 level of "host" or a peer id (for the meters). */
  getLevel(id: string): number {
    const l = this.levels.get(id);
    if (!l) return 0;
    l.an.getByteTimeDomainData(l.buf);
    let sum = 0;
    for (const v of l.buf) {
      const x = (v - 128) / 128;
      sum += x * x;
    }
    return Math.min(1, Math.sqrt(sum / l.buf.length) * 3.2);
  }

  /** Frequency bytes (512 bins) of "host" or a peer id, for visualisers; false when unknown. */
  readSpectrum(id: string, out: Uint8Array<ArrayBuffer>): boolean {
    const l = this.levels.get(id);
    if (!l) return false;
    l.an.getByteFrequencyData(out);
    return true;
  }

  /** The finished mix (host mic + on-air guests) as a stream, e.g. to feed the studio mixer. */
  getMixStream(): MediaStream | null {
    return this.dest?.stream ?? null;
  }

  /** Who is on the air right now: the moderator and every on-air guest, with display names. */
  voices(): { id: string; label: string }[] {
    const out = [{ id: "host", label: "Yönetici" }];
    for (const p of this.p2p?.getPeers() ?? [])
      if (p.role === "guest" && p.status === "on-air")
        out.push({ id: p.id, label: p.name || "Konuk" });
    return out;
  }

  setMonitor(on: boolean): void {
    this.state.monitorOn = on;
    if (this.monitor && this.ctx)
      this.monitor.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.02);
    this.emit();
  }

  private onGuestStream(id: string, stream: MediaStream | null): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const old = this.guests.get(id);
    if (old) {
      old.el.srcObject = null;
      old.src.disconnect();
      old.gain.disconnect();
      this.guests.delete(id);
      this.levels.delete(id);
      for (const r of this.rets.values()) r.wired.delete(id);
    }
    if (!stream) return;
    // Chrome only delivers a remote stream into WebAudio while it is attached to a media element
    const el = new Audio();
    el.srcObject = stream;
    el.muted = true;
    void el.play().catch(() => undefined);
    const src = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain);
    gain.connect(this.master);
    if (this.monitor) gain.connect(this.monitor);
    this.tap(id, src);
    this.guests.set(id, { src, gain, el });
    this.syncReturns();
    this.syncMix();
  }

  /**
   * Keeps one return bus per guest seat and wires every OTHER guest (and the host microphone)
   * into it, so a guest hears the conversation without hearing their own voice back.
   */
  private syncReturns(): void {
    const ctx = this.ctx;
    const p2p = this.p2p;
    if (!ctx || !p2p || !this.micGain) return;
    const seats = new Set(
      p2p
        .getPeers()
        .filter((p) => p.role === "guest")
        .map((p) => p.id),
    );
    for (const [id, r] of this.rets)
      if (!seats.has(id)) {
        const bus = r.dest;
        const off = (n: AudioNode) => {
          try {
            n.disconnect(bus);
          } catch {
            /* not connected (that guest never reached this bus) */
          }
        };
        off(this.micGain);
        for (const g of this.guests.values()) off(g.gain);
        this.rets.delete(id);
      }
    for (const id of seats) {
      let r = this.rets.get(id);
      if (!r) {
        r = { dest: ctx.createMediaStreamDestination(), wired: new Set() };
        this.micGain.connect(r.dest);
        this.rets.set(id, r);
        p2p.setPeerProgram(id, r.dest.stream);
      }
      for (const [other, g] of this.guests)
        if (other !== id && !r.wired.has(other)) {
          g.gain.connect(r.dest);
          r.wired.add(other);
        }
    }
  }

  private syncMix(): void {
    const ctx = this.ctx;
    if (!ctx || !this.p2p) return;
    const targets = mixTargets(this.p2p.getPeers());
    for (const [id, g] of this.guests)
      g.gain.gain.setTargetAtTime(targets.get(id) ?? 0, ctx.currentTime, 0.03);
  }

  private onPeers(): void {
    this.syncReturns();
    this.syncMix();
    this.emit();
    // The host answers a join request with "guest-approved" right after publishing the peer
    // change; going on air in the same tick would let that message overwrite "on-air" on the guest.
    if (this.state.autoOnAir && !this.airTimer)
      this.airTimer = setTimeout(() => {
        this.airTimer = null;
        const p2p = this.p2p;
        if (!p2p || !this.state.autoOnAir) return;
        for (const p of p2p.getPeers())
          if (p.role === "guest" && p.status === "waiting")
            p2p.bringOnAir(p.id);
      }, 0);
  }

  /* ------------------------- second moderator device ------------------------- */

  /**
   * Commands from an approved "remote" peer (a phone as a second moderator): the same ones the
   * video studio remote sends, mapped onto the podcast controls. No scenes here.
   */
  private onRemote(cmd: RemoteCommand): void {
    switch (cmd.kind) {
      case "mute":
        this.setMicMuted(cmd.value ?? !this.state.micMuted);
        break;
      case "prompter": {
        const p = this.state.prompter;
        if (cmd.action === "toggle")
          this.setGuestPrompter({ playing: !p.playing });
        else if (cmd.action === "rewind")
          this.setGuestPrompter({ playing: false, pos: 0 });
        else
          this.setGuestPrompter({
            speed: stepSpeed(p.speed, cmd.action === "speedUp" ? 1 : -1),
          });
        break;
      }
      case "record": {
        const on = this.recorder?.state === "recording";
        if (cmd.action === "stop" || (cmd.action === "toggle" && on))
          void this.stopRecording();
        else if (!on) this.startRecording();
        break;
      }
      case "marker":
        this.addMarker("");
        break;
      default:
        break; // scenes do not exist in a podcast room
    }
  }

  private pushRemoteState(): void {
    const s = this.snap;
    this.p2p?.broadcastRemoteState({
      scenes: [],
      activeSceneId: "",
      recording: s.recording.on,
      micMuted: s.micMuted,
      prompterPlaying: s.guestPrompter.playing,
      prompterSpeed: s.guestPrompter.speed,
      recordingMs: s.recording.startedAt
        ? Date.now() - s.recording.startedAt
        : 0,
    });
  }

  /* -------------------------------- controls -------------------------------- */

  setMicMuted(muted: boolean): void {
    this.state.micMuted = muted;
    if (this.micGain && this.ctx)
      this.micGain.gain.setTargetAtTime(
        muted ? 0 : 1,
        this.ctx.currentTime,
        0.02,
      );
    this.emit();
  }
  setAutoOnAir(on: boolean): void {
    this.state.autoOnAir = on;
    this.onPeers();
  }
  approve = (guestId: string): Promise<boolean> =>
    this.session?.approve(guestId) ?? Promise.resolve(false);
  approveAll = (): Promise<void> =>
    this.session?.approveAll() ?? Promise.resolve();
  reject = (guestId: string): Promise<boolean> =>
    this.session?.reject(guestId) ?? Promise.resolve(false);
  setAutoApprove(on: boolean): void {
    this.session?.setAutoApprove("guest", on);
    this.session?.setAutoApprove("viewer", on);
  }
  lockMute(peerId: string, muted: boolean): void {
    this.p2p?.lockGuestMute(peerId, muted);
    this.syncMix();
  }
  muteAll(muted: boolean): void {
    for (const p of this.p2p?.getPeers() ?? [])
      if (p.role === "guest") this.lockMute(p.id, muted);
  }
  kick(peerId: string): void {
    this.p2p?.kick(peerId);
  }

  /* --------------------------- mass listening relay --------------------------- */

  /**
   * Streams the mix to the server as small WebM/Opus chunks; the server turns it into a live
   * MP3 for any number of listeners (`/listen/<id>`). Guests stay on WebRTC.
   */
  async startBroadcast(title = "Podcast"): Promise<boolean> {
    if (this.bcast || !this.dest) return false;
    const type = ["audio/webm;codecs=opus", "audio/webm"].find((t) =>
      MediaRecorder.isTypeSupported(t),
    );
    if (!type) return false;
    let made: { id: string; token: string };
    try {
      const res = await fetch("/api/listen", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) return false;
      made = (await res.json()) as { id: string; token: string };
    } catch {
      return false;
    }
    const rec = new MediaRecorder(this.dest.stream, {
      mimeType: type,
      audioBitsPerSecond: 96_000,
    });
    const b = {
      ...made,
      link: `${this.origin()}/listen/${made.id}`,
      listeners: 0,
      rec,
      queue: Promise.resolve(),
      poll: setInterval(() => void this.pollBroadcast(), 5000),
    };
    this.bcast = b;
    rec.ondataavailable = (e) => {
      if (e.data.size === 0) return;
      // sequential, so the server receives the chunks in order
      b.queue = b.queue.then(async () => {
        try {
          const res = await fetch(`/api/listen/${made.id}/chunk`, {
            method: "POST",
            headers: { "x-listen-token": made.token },
            body: e.data,
          });
          if (res.ok) {
            const d = (await res.json()) as { listeners?: number };
            b.listeners = d.listeners ?? b.listeners;
          } else if (res.status === 404 || res.status === 401)
            void this.stopBroadcast();
        } catch {
          /* a lost chunk is a short glitch for listeners; the next one follows */
        }
      });
    };
    rec.start(1000);
    this.emit();
    return true;
  }

  private async pollBroadcast(): Promise<void> {
    const b = this.bcast;
    if (!b) return;
    try {
      const d = (await (await fetch(`/api/listen/${b.id}`)).json()) as {
        live?: boolean;
        listeners?: number;
      };
      if (!d.live) return void this.stopBroadcast();
      if (d.listeners !== b.listeners) {
        b.listeners = d.listeners ?? 0;
        this.emit();
      }
    } catch {
      /* offline: keep trying */
    }
  }

  async stopBroadcast(): Promise<void> {
    const b = this.bcast;
    if (!b) return;
    this.bcast = null;
    clearInterval(b.poll);
    try {
      if (b.rec.state !== "inactive") b.rec.stop();
    } catch {
      /* already stopped */
    }
    await b.queue;
    await fetch(`/api/listen/${b.id}/stop`, {
      method: "POST",
      headers: { "x-listen-token": b.token },
    }).catch(() => undefined);
    this.emit();
  }

  /* ------------------------------- guest prompter ------------------------------ */

  setGuestPrompter(patch: Partial<PodcastPrompter>): void {
    this.state.prompter = normalizePrompter({
      ...this.state.prompter,
      ...patch,
    });
    this.p2p?.setPrompter(this.state.prompter);
    this.emit();
  }
  /** The moderator's own preview reports where the text is; guests follow. */
  reportGuestPos(pos: number): void {
    if (!this.state.prompter.playing) return;
    this.state.prompter = {
      ...this.state.prompter,
      pos: normalizePrompter({ pos }).pos,
    };
    this.p2p?.setPrompter(this.state.prompter);
  }
  setGuestScript(peerId: string, text: string | null): void {
    this.p2p?.setPrompterText(
      peerId,
      text === null ? null : text.slice(0, 20_000),
    );
    this.emit();
  }
  getGuestScript(peerId: string): string | null {
    return this.p2p?.getPrompterText(peerId) ?? null;
  }

  /* --------------------------------- recording --------------------------------- */

  startRecording(): boolean {
    if (!this.dest || this.recorder?.state === "recording") return false;
    const type = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
    ].find((t) => MediaRecorder.isTypeSupported(t));
    this.chunks = [];
    this.markers = [];
    const rec = new MediaRecorder(this.dest.stream, {
      ...(type ? { mimeType: type } : {}),
      audioBitsPerSecond: 128_000,
    });
    rec.ondataavailable = (e) => e.data.size > 0 && this.chunks.push(e.data);
    rec.start(1000);
    this.recorder = rec;
    this.state.recordingStartedAt = Date.now();
    this.state.last = null;
    this.emit();
    return true;
  }

  addMarker(label: string): void {
    if (this.state.recordingStartedAt === null) return;
    this.markers.push({
      t: Date.now() - this.state.recordingStartedAt,
      label: label.slice(0, 80) || `Bölüm ${this.markers.length + 1}`,
    });
    this.emit();
  }

  stopRecording(): Promise<PodcastSnapshot["lastRecording"]> {
    const rec = this.recorder;
    const started = this.state.recordingStartedAt;
    if (!rec || rec.state === "inactive" || started === null)
      return Promise.resolve(this.state.last);
    return new Promise((resolve) => {
      rec.onstop = () => {
        const blob = new Blob(this.chunks, {
          type: rec.mimeType || "audio/webm",
        });
        this.state.last = {
          blob,
          ms: Date.now() - started,
          markers: [...this.markers],
        };
        this.state.recordingStartedAt = null;
        this.recorder = null;
        this.emit();
        resolve(this.state.last);
      };
      rec.stop();
    });
  }

  /** Sends the last recording to the media library (admin session cookie authenticates). */
  async uploadLast(
    title: string,
    onProgress?: (f: number) => void,
  ): Promise<UploadResult | null> {
    const last = this.state.last;
    if (!last) return null;
    return uploadMedia(
      "",
      last.blob,
      {
        title,
        filename: `${title}.webm`,
        origin: "studio",
        chapters: last.markers,
      },
      onProgress,
    );
  }

  dispose(): void {
    this.teardown();
    this.listeners.clear();
  }
}
