// src/studio/runtime/runtime.ts
// The glue: one StudioRuntime owns the project store, asset store, audio bus, prompter engine,
// media sources, compositor and recorder, and exposes the actions the UI needs.
// Browser-only: create it inside an effect (see use-studio.tsx), never at module scope.
import { Compositor } from "../engine/compositor";
import { AudioBus } from "../engine/audio-bus";
import {
  publishScript,
  readSharedScript,
  subscribeHandoff,
  subscribeScript,
  takeHandoff,
  type ScriptMessage,
} from "../sync/shared";
import { createMusicPlayer, TRACKS, type MusicPlayer } from "../engine/music";
import { buildSfxBuffer, SFX_PRESETS } from "../engine/sfx-presets";
import { downloadRecordingBundle, timestampName } from "../engine/download";
import {
  StudioRecorder,
  type RecorderSnapshot,
  type RecorderWarning,
} from "../engine/recorder";
import {
  PrompterEngine,
  ScriptAligner,
  createVoiceFollower,
  drawBurnIn,
  getBurnInView,
  isVoiceFollowSupported,
  parseScript,
  type ScriptModel,
  type VoiceFollowErrorCode,
  type VoiceFollower,
} from "../prompter";
import {
  assetIdsInProject,
  createProjectStore,
  getActiveScene,
  type ProjectStore,
} from "../project/store";
import { parseProject } from "../project/schema";
import {
  drawDeviceFrame,
  drawDeviceOverlay,
  getRippleField,
  releaseRippleField,
  type RippleKind,
} from "../proto";
import {
  createAssetStore,
  createAutosaver,
  createKvStore,
  loadSettings,
  resolveShortcut,
  saveSettings,
  type Autosaver,
} from "../storage";
import { createLayer, defaultProject } from "../defaults";
import { StudioHost, type InviteResult } from "../p2p";
import { ensureBackdrop } from "../templates/backdrop";
import { buildTemplateScene, resolveOptions } from "../templates/build";
import { getTemplate } from "../templates/catalog";
import type { TemplateMode, TemplateOptions } from "../templates/types";
import { roomBadge } from "../room/badge";
import { LiveStreamer } from "../live/streamer";
import { drawSponsors, sortForAir, type SponsorItem } from "../sponsors/draw";
import { SponsorExposure } from "../sponsors/exposure";
import { sponsorReportCsv } from "../sponsors/report";
import { drawChat, type ChatLine } from "../room/chat-draw";
import { RoomHostSession } from "../room/host-session";
import type {
  AssetStore,
  ChatLayer,
  CompositorHooks,
  PeerInfo,
  PeerRole,
  Layer,
  PrompterLayer,
  Rect,
  RemoteCommand,
  RemoteState,
  Scene,
  SponsorLayer,
  WebLayer,
} from "../types";
import { SourceManager } from "./sources";

const EXPOSURE_KEY = "sponsors:exposure:v1";
const GEN_CHANNEL = "music:gen";
const AUTO_WHOOSH_KEY = "studio.autoWhoosh.v1";

export interface RuntimeSnapshot {
  readonly recorder: RecorderSnapshot | null;
  readonly recorderWarning: RecorderWarning | null;
  readonly micMuted: boolean;
  readonly voice: {
    readonly active: boolean;
    readonly speaking: boolean;
    readonly error: VoiceFollowErrorCode | null;
  };
  /** last user-facing runtime error code (recording / compositor) */
  readonly error: string | null;
}

const EMPTY_PEERS: readonly PeerInfo[] = Object.freeze([]);

const INITIAL: RuntimeSnapshot = {
  recorder: null,
  recorderWarning: null,
  micMuted: false,
  voice: { active: false, speaking: false, error: null },
  error: null,
};

export class StudioRuntime {
  readonly project: ProjectStore;
  readonly assets: AssetStore;
  readonly audio: AudioBus;
  readonly prompter: PrompterEngine;
  readonly sources: SourceManager;

  private autosaver: Autosaver;
  private compositor: Compositor | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private recorder: StudioRecorder | null = null;
  private recorderUnsub: (() => void) | null = null;
  private unsubProject: () => void;
  private lastActiveId: string | null = null;
  private lastSettingsJson = "";

  private snap: RuntimeSnapshot = INITIAL;
  private listeners = new Set<() => void>();

  private model: ScriptModel;
  private modelScript: string;
  private voice: VoiceFollower | null = null;
  private voiceWord: number | null = null;
  private webBoxes = new Map<string, Rect>();
  private music = new Map<string, HTMLAudioElement>();
  /** Procedural (code-generated) music: own AudioContext -> MediaStream -> "music:gen" channel. */
  private gen: {
    ctx: AudioContext;
    player: MusicPlayer;
    stream: MediaStream;
    trackId: string | null;
  } | null = null;
  private sfxBuffers = new Map<string, AudioBuffer>();
  private syncUnsubs: Array<() => void> = [];
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSyncedScript = "";
  private lastSyncAt = 0;
  private host: StudioHost | null = null;
  private hostUnsubs: Array<() => void> = [];
  private programStream: MediaStream | null = null;
  private hostStun: boolean | null = null;
  private peers: readonly PeerInfo[] = EMPTY_PEERS;
  private peerListeners = new Set<() => void>();
  private remoteTimer: ReturnType<typeof setInterval> | null = null;
  private roomSession: RoomHostSession | null = null;
  private liveStreamer: LiveStreamer | null = null;
  /** screen time of on-air sponsors (recording or live), see sponsors/exposure.ts */
  readonly sponsorExposure = new SponsorExposure();
  private exposureKv = createKvStore();
  private exposureTimer: ReturnType<typeof setInterval> | null = null;
  private roomUnsub: (() => void) | null = null;
  private disposed = false;

  constructor() {
    const settings = loadSettings();
    const initial = defaultProject();
    initial.settings = settings;
    this.project = createProjectStore(initial);
    this.assets = createAssetStore();
    this.audio = new AudioBus();
    this.prompter = new PrompterEngine({
      speedPx: initial.prompter.settings.speedPx,
    });
    this.sources = new SourceManager(this.assets, this.audio);
    this.autosaver = createAutosaver(createKvStore());

    const st = this.project.getState();
    this.modelScript = st.prompter.script;
    this.model = parseScript(this.modelScript);
    this.unsubProject = this.project.subscribe(() => this.onProjectChange());
    this.initCompositor();
    // persist sponsor screen time (only when it changed)
    this.exposureTimer = setInterval(() => void this.flushExposure(), 15_000);
  }

  private async flushExposure(): Promise<void> {
    if (!this.sponsorExposure.takeDirty()) return;
    try {
      await this.exposureKv.set(EXPOSURE_KEY, this.sponsorExposure.snapshot());
    } catch {
      // storage blocked: the numbers stay in memory
    }
  }

  private syncOnAir(): void {
    const rec = this.snap.recorder?.status === "recording";
    const live = this.liveStreamer?.getSnapshot().phase === "live";
    this.sponsorExposure.setOnAir(rec || live);
  }

  /** CSV of sponsor screen time (this on-air session and all time). */
  sponsorReport(): string {
    return sponsorReportCsv(
      this.project.getState().sponsors,
      this.sponsorExposure.snapshot(),
    );
  }

  clearSponsorExposure(): void {
    this.sponsorExposure.clear();
    void this.flushExposure();
  }

  /* ---------------------------- snapshot store ---------------------------- */

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getSnapshot = (): RuntimeSnapshot => this.snap;
  private patch(p: Partial<RuntimeSnapshot>): void {
    this.snap = { ...this.snap, ...p };
    this.syncOnAir();
    for (const l of [...this.listeners]) l();
  }

  /* -------------------------------- startup ------------------------------- */

  /** Restore the autosaved project (validated + repaired). Safe to call once after creation. */
  async restore(): Promise<boolean> {
    try {
      this.sponsorExposure.restore(await this.exposureKv.get(EXPOSURE_KEY));
    } catch {
      // no stored report
    }
    try {
      const raw = await this.autosaver.loadLatest();
      if (raw === undefined || this.disposed) return false;
      const parsed = parseProject(raw);
      if (!parsed.ok) return false;
      this.project.replaceProject(parsed.project);
      this.prompter.setSpeed(parsed.project.prompter.settings.speedPx);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The runtime owns ONE program canvas for its whole life (it keeps rendering, recording and
   * feeding P2P viewers even while no page shows it). Pages display it with `mountCanvas`.
   */
  private initCompositor(): void {
    const out = this.project.getState().settings.output;
    const canvas = document.createElement("canvas");
    canvas.width = out.width;
    canvas.height = out.height;
    canvas.className = "absolute inset-0 h-full w-full";
    this.canvas = canvas;
    this.compositor = new Compositor(canvas, this.hooks, {
      width: out.width,
      height: out.height,
      fps: out.fps,
    });
    const scene = getActiveScene(this.project.getState());
    this.lastActiveId = scene.id;
    this.compositor.setScene(scene);
    this.compositor.start();
  }

  /** Show the program canvas inside `container` (moves it if it was mounted elsewhere). */
  mountCanvas(container: HTMLElement): void {
    if (this.canvas && this.canvas.parentElement !== container) {
      container.appendChild(this.canvas);
    }
  }

  /** Remove the canvas from the DOM; rendering and recording continue. */
  unmountCanvas(container?: HTMLElement): void {
    const c = this.canvas;
    if (c && c.parentElement && (!container || c.parentElement === container)) {
      c.parentElement.removeChild(c);
    }
  }

  /** Persist the project right now (used on `pagehide`). */
  flushAutosave(): Promise<void> {
    return this.autosaver.flush();
  }

  getCompositor(): Compositor | null {
    return this.compositor;
  }

  private hooks: CompositorHooks = {
    resolveSource: (layer: Layer) => this.sources.resolve(layer),
    drawSponsors: (ctx, layer: SponsorLayer, box, now) => {
      const items: SponsorItem[] = sortForAir(
        this.project.getState().sponsors.filter((s) => s.onAir),
      ).map((s) => {
        const f = s.logoAssetId
          ? this.sources.getAssetImage(s.logoAssetId)
          : null;
        return {
          id: s.id,
          name: s.name,
          tagline: s.tagline,
          kind: s.kind,
          tier: s.tier,
          logo: f
            ? { source: f.source, width: f.width, height: f.height }
            : null,
        };
      });
      this.sponsorExposure.record(
        drawSponsors(ctx, layer, box, now, items),
        now,
      );
    },
    drawChat: (ctx, layer: ChatLayer, box) => {
      const chat = this.roomSession?.chat.getSnapshot();
      if (!chat || chat.status === "idle") return;
      const line = (m: { author: string; text: string }): ChatLine => ({
        author: m.author,
        text: m.text,
      });
      const feed: ChatLine[] = [];
      for (
        let i = chat.messages.length - 1;
        i >= 0 && feed.length < layer.maxMessages;
        i--
      ) {
        const m = chat.messages[i];
        if (m && m.status === "approved") feed.unshift(line(m));
      }
      drawChat(ctx, layer, box, {
        spotlight: chat.onAir ? line(chat.onAir) : null,
        feed,
      });
    },
    drawPrompter: (ctx, layer: PrompterLayer, box, now) => {
      const p = this.project.getState().prompter;
      if (!p.settings.burnIn) return;
      this.syncModel();
      const view = getBurnInView(
        this.model,
        this.currentWordIndex(),
        layer.mode,
      );
      drawBurnIn(
        ctx,
        layer.mode,
        box,
        view,
        {
          fontFamily: '"Space Grotesk", sans-serif',
          fontSize: Math.max(18, Math.min(box.h * 0.32, p.settings.fontSize)),
          color: "#ffffff",
          contrast: p.settings.contrast,
        },
        now,
      );
    },
    drawWebChrome: (ctx, layer: WebLayer, box) => {
      this.webBoxes.set(layer.id, box);
      return drawDeviceFrame(ctx, layer.frame, box, { url: layer.url });
    },
    drawWebOverlay: (ctx, layer: WebLayer, screen, now) => {
      const box = this.webBoxes.get(layer.id);
      if (box) drawDeviceOverlay(ctx, layer.frame, box);
      if (layer.ripples) getRippleField(layer.id).draw(ctx, screen, now);
    },
  };

  /* ----------------------------- project wiring ---------------------------- */

  private onProjectChange(): void {
    const state = this.project.getState();
    const scene = getActiveScene(state);
    if (this.compositor) {
      if (this.lastActiveId !== scene.id) {
        this.compositor.transitionTo(scene, scene.transition);
      } else {
        this.compositor.setScene(scene);
      }
    }
    this.lastActiveId = scene.id;

    // free per-layer resources of removed layers
    const layerIds = new Set<string>();
    for (const s of state.scenes) for (const l of s.layers) layerIds.add(l.id);
    this.sources.gc(layerIds, new Set(assetIdsInProject(state)));
    this.sponsorExposure.prune(new Set(state.sponsors.map((s) => s.id)));
    for (const id of [...this.webBoxes.keys()])
      if (!layerIds.has(id)) {
        this.webBoxes.delete(id);
        releaseRippleField(id);
      }

    // settings side effects
    const settingsJson = JSON.stringify(state.settings);
    if (settingsJson !== this.lastSettingsJson) {
      this.lastSettingsJson = settingsJson;
      saveSettings(state.settings);
      const o = state.settings.output;
      if (this.canvas && !this.recorder) {
        this.compositor?.resize(o.width, o.height);
        this.canvas.width = o.width;
        this.canvas.height = o.height;
      }
      this.compositor?.setFps(o.fps);
    }
    this.prompter.setSpeed(state.prompter.settings.speedPx);
    this.autosaver.schedule(state);
  }

  /** Switch the live scene (with the scene's transition). */
  switchScene(id: string): boolean {
    const st = this.project.getState();
    const changing = id !== st.activeSceneId;
    const type = st.scenes.find((s) => s.id === id)?.transition.type;
    const ok = this.project.setActiveScene(id);
    if (ok && changing && type && type !== "cut" && this.getAutoWhoosh()) {
      void this.playPresetEffect("whoosh");
    }
    return ok;
  }

  /** Plays a "whoosh" effect on every non-cut scene transition (preference, default on). */
  getAutoWhoosh(): boolean {
    try {
      return localStorage.getItem(AUTO_WHOOSH_KEY) !== "0";
    } catch {
      return true;
    }
  }
  setAutoWhoosh(on: boolean): void {
    try {
      localStorage.setItem(AUTO_WHOOSH_KEY, on ? "1" : "0");
    } catch {
      /* storage blocked: stays on for this session only */
    }
  }
  switchSceneByIndex(index: number): boolean {
    const s = this.project.getState().scenes[index];
    return s ? this.switchScene(s.id) : false;
  }
  stepScene(delta: 1 | -1): void {
    const st = this.project.getState();
    const i = st.scenes.findIndex((s) => s.id === st.activeSceneId);
    const n = st.scenes.length;
    const next = st.scenes[(i + delta + n) % n];
    if (next) this.switchScene(next.id);
  }

  /* -------------------------------- prompter ------------------------------ */

  private syncModel(): void {
    const script = this.project.getState().prompter.script;
    if (script !== this.modelScript) {
      this.modelScript = script;
      this.model = parseScript(script);
      if (this.voice) this.voice.setAligner(new ScriptAligner(this.model));
    }
  }

  getScriptModel(): ScriptModel {
    this.syncModel();
    return this.model;
  }

  /** Word index used by burn-in: voice follow wins, otherwise scroll progress. */
  currentWordIndex(): number {
    if (this.voiceWord !== null) return this.voiceWord;
    const s = this.prompter.getSnapshot();
    const total = this.model.wordCount;
    if (total === 0 || s.maxPx <= 0) return 0;
    return Math.round((s.positionPx / s.maxPx) * (total - 1));
  }

  setVoiceFollow(on: boolean): boolean {
    if (!on) {
      this.voice?.stop();
      this.voice = null;
      this.voiceWord = null;
      this.prompter.release("voice");
      this.patch({ voice: { active: false, speaking: false, error: null } });
      return true;
    }
    if (!isVoiceFollowSupported()) {
      this.patch({
        voice: { active: false, speaking: false, error: "unsupported" },
      });
      return false;
    }
    this.syncModel();
    const settings = this.project.getState().prompter.settings;
    this.voice = createVoiceFollower({
      lang: settings.voiceLang,
      aligner: new ScriptAligner(this.model),
      onProgress: ({ wordIndex }) => {
        this.voiceWord = wordIndex;
        const total = this.model.wordCount;
        const s = this.prompter.getSnapshot();
        if (total > 1 && s.maxPx > 0)
          this.prompter.seek((wordIndex / (total - 1)) * s.maxPx);
      },
      onSpeaking: (speaking) => {
        // pause scrolling while the speaker is silent / improvising
        if (speaking) this.prompter.release("voice");
        else this.prompter.hold("voice");
        this.patch({ voice: { ...this.snap.voice, speaking } });
      },
      onError: (code, info) => {
        this.patch({
          voice: { active: !info.fatal, speaking: false, error: code },
        });
      },
    });
    const ok = this.voice.start();
    this.patch({
      voice: { active: ok, speaking: false, error: ok ? null : "unsupported" },
    });
    return ok;
  }

  /* --------------------------------- audio -------------------------------- */

  setMicMuted(muted: boolean): void {
    this.sources.setMicMuted(muted);
    this.patch({ micMuted: muted });
  }
  toggleMicMuted(): void {
    this.setMicMuted(!this.snap.micMuted);
  }

  /* ------------------------------ live (P2P) ------------------------------ */

  subscribePeers = (cb: () => void): (() => void) => {
    this.peerListeners.add(cb);
    return () => this.peerListeners.delete(cb);
  };
  getPeersSnapshot = (): readonly PeerInfo[] => this.peers;

  /** Drop the P2P host (and its timers/subscriptions). Connected peers are closed. */
  private teardownHost(): void {
    if (this.remoteTimer) clearInterval(this.remoteTimer);
    this.remoteTimer = null;
    for (const u of this.hostUnsubs) u();
    this.hostUnsubs = [];
    this.host?.dispose();
    this.host = null;
    this.programStream = null;
    this.peers = EMPTY_PEERS;
    for (const l of [...this.peerListeners]) l();
  }

  private ensureHost(): StudioHost {
    const wantStun = this.project.getState().settings.output.usePublicStun;
    // The STUN choice is baked into each connection: apply a changed setting to NEW invites by
    // rebuilding the host, but only while nobody is connected (never drop a live guest).
    if (
      this.host &&
      this.hostStun !== wantStun &&
      this.host.getPeers().length === 0
    ) {
      this.teardownHost();
    }
    if (this.host) return this.host;
    const host = new StudioHost({ usePublicStun: wantStun });
    this.hostStun = wantStun;
    this.host = host;
    this.hostUnsubs.push(
      host.subscribe((peers) => {
        this.peers = peers;
        this.applyGuestAudio(peers);
        this.pushRemoteState();
        for (const l of [...this.peerListeners]) l();
      }),
      host.onGuestStream((peerId, stream) => {
        this.sources.setGuestStream(peerId, stream);
        this.applyGuestAudio(host.getPeers());
      }),
      host.onRemoteCommand((_peerId, cmd) => this.executeRemote(cmd)),
      this.project.subscribe(() => this.pushRemoteState()),
      this.subscribe(() => this.pushRemoteState()),
      this.prompter.subscribeCoarse(() => this.pushRemoteState()),
    );
    // new remotes receive the latest state as soon as their channel opens
    this.pushRemoteState();
    this.remoteTimer = setInterval(() => {
      if (this.isRecording()) this.pushRemoteState();
    }, 1000);
    return host;
  }

  private pushRemoteState(): void {
    this.host?.broadcastRemoteState(this.getRemoteState());
  }

  /** Program output (canvas video + mixed audio) that viewers/guests watch. */
  private updateProgramStream(): void {
    if (!this.canvas || !this.host) return;
    try {
      const tracks = [
        ...this.canvas.captureStream(30).getVideoTracks(),
        ...this.audio.getMixStream().getAudioTracks(),
      ];
      this.programStream = new MediaStream(tracks);
      this.host.setProgramStream(this.programStream);
    } catch {
      // no audio context yet: viewers get video only until the next invite
    }
  }

  /** Create an invite (link + code). Call from a click: it unlocks the audio context. */
  async createInvite(role: PeerRole, name?: string): Promise<InviteResult> {
    const host = this.ensureHost();
    await this.audio.ensureRunning();
    if (!this.programStream) this.updateProgramStream();
    return host.createInvite(role, name);
  }

  async acceptAnswer(peerId: string, code: string): Promise<void> {
    await this.ensureHost().acceptAnswer(peerId, code);
  }

  /** Host guest controls. Gain/mute are applied to the audio bus from the peer record. */
  bringGuestOnAir(peerId: string): boolean {
    const host = this.ensureHost();
    const ok = host.bringOnAir(peerId);
    if (!ok) return false;
    const st = this.project.getState();
    const scene = getActiveScene(st);
    const guests = scene.layers.filter(
      (l): l is Extract<Layer, { kind: "guest" }> => l.kind === "guest",
    );
    if (guests.some((l) => l.peerId === peerId)) return true;
    const info = host.getPeer(peerId);
    const label = info?.name ?? "Konuk";
    // Template slots: take the first empty guest panel, or one whose guest left.
    const free = guests.find((l) => {
      if (l.peerId === "") return true;
      const p = host.getPeer(l.peerId);
      return !p || p.status === "disconnected";
    });
    if (free) {
      this.project.updateLayer(scene.id, free.id, { peerId, label });
      return true;
    }
    this.project.addLayer(
      scene.id,
      createLayer("guest", { peerId, label, name: label }),
    );
    return true;
  }
  /**
   * Build a broadcast-frame template and add it as a new scene (or replace the active
   * scene's layers). Returns the id of the affected scene.
   */
  async applyTemplate(
    templateId: string,
    options: Partial<TemplateOptions>,
    mode: TemplateMode,
  ): Promise<string | undefined> {
    const def = getTemplate(templateId);
    if (!def) return undefined;
    const resolved = resolveOptions(def, options);
    // an uploaded background replaces the generated dotted one
    const bg =
      def.backdrop && !resolved.backgroundAssetId
        ? await ensureBackdrop(this.assets, resolved.accent)
        : undefined;
    const scene = buildTemplateScene(def, resolved, bg);
    if (mode === "replace-active") {
      const active = getActiveScene(this.project.getState());
      return this.project.replaceSceneLayers(
        active.id,
        scene.layers,
        scene.name,
      )
        ? active.id
        : undefined;
    }
    return this.project.insertScene(scene);
  }

  takeGuestOffAir(peerId: string): boolean {
    return this.ensureHost().takeOffAir(peerId);
  }
  rejectGuest(peerId: string): boolean {
    return this.ensureHost().rejectGuest(peerId);
  }
  kickPeer(peerId: string): boolean {
    return this.ensureHost().kick(peerId);
  }
  setGuestGain(peerId: string, gain: number): void {
    this.ensureHost().setGuestGain(peerId, gain);
  }
  setGuestMuted(peerId: string, muted: boolean): void {
    this.ensureHost().setGuestMuted(peerId, muted);
  }
  getGuestStream(peerId: string): MediaStream | null {
    return this.host?.getGuestStream(peerId) ?? null;
  }

  /** The audio bus mirrors the host's peer records: only on-air, unmuted guests are heard. */
  private applyGuestAudio(peers: readonly PeerInfo[]): void {
    for (const p of peers) {
      if (p.role !== "guest") continue;
      const id = `guest:${p.id}`;
      if (!this.audio.hasChannel(id)) continue;
      this.audio.setMuted(id, p.status !== "on-air" || p.muted);
      this.audio.setGain(id, p.gain);
    }
  }

  /* --------------------------------- room --------------------------------- */

  /**
   * The room (short code + waiting pool). Created lazily; it only talks to the relay once
   * `room.open()` is called (or a saved room is resumed on startup).
   */
  /** RTMP(S) live broadcast controller (server-side ffmpeg bridge), created on first use. */
  get live(): LiveStreamer {
    if (!this.liveStreamer) {
      const streamer = new LiveStreamer({
        getCanvas: () => this.canvas,
        getAudioStream: () => this.audio.getMixStream(),
        ensureAudio: async () => {
          await this.audio.ensureRunning();
        },
      });
      streamer.subscribe(() => this.syncOnAir());
      this.liveStreamer = streamer;
    }
    return this.liveStreamer;
  }

  get room(): RoomHostSession {
    if (!this.roomSession) {
      const session = new RoomHostSession({
        bridge: {
          createInvite: (role, name) => this.createInvite(role, name),
          acceptAnswer: (peerId, code) => this.acceptAnswer(peerId, code),
          kickPeer: (peerId) => this.kickPeer(peerId),
          getPeers: () => this.peers,
          subscribePeers: this.subscribePeers,
        },
        kv: createKvStore(),
      });
      const announce = () => {
        const waiting = session.getSnapshot().waiting;
        const chat = session.chat.getSnapshot().pending;
        roomBadge.set({ waiting, chat });
        const n = waiting + chat;
        const base = document.title.replace(/^\(\d+\)\s*/, "");
        document.title = n > 0 ? `(${n}) ${base}` : base;
      };
      const offRoom = session.subscribe(announce);
      const offChat = session.chat.subscribe(announce);
      this.roomUnsub = () => {
        offRoom();
        offChat();
      };
      this.roomSession = session;
    }
    return this.roomSession;
  }

  /** Reopen the saved room after a page reload (no-op when there is none). */
  resumeSavedRoom(): void {
    try {
      if (localStorage.getItem("tkz.room.v1")) void this.room.open();
    } catch {
      // storage blocked
    }
  }

  /* ---------------------------- music & effects --------------------------- */

  isMusicPlaying(assetId: string): boolean {
    const el = this.music.get(assetId);
    return !!el && !el.paused;
  }

  /** Start/stop looping background music from an audio asset. Returns the new playing state. */
  async toggleMusic(assetId: string, label = "Müzik"): Promise<boolean> {
    const cur = this.music.get(assetId);
    if (cur) {
      cur.pause();
      this.audio.removeChannel(`music:${assetId}`);
      cur.removeAttribute("src");
      this.music.delete(assetId);
      return false;
    }
    const url = await this.assets.getUrl(assetId);
    if (!url) return false;
    await this.audio.ensureRunning();
    const el = new Audio(url);
    el.loop = true;
    this.audio.addChannel(
      { id: `music:${assetId}`, label, kind: "music" },
      el,
      {
        gain: 0.3,
      },
    );
    this.music.set(assetId, el);
    await el.play().catch(() => undefined);
    return true;
  }

  /* ------------------- cross-tab / Classic studio sync ------------------- */

  /**
   * Keeps the prompter script in sync with other tabs and the Classic studio, and imports
   * scenes handed over by it. Safe to call once after `restore()`; undone by `dispose()`.
   */
  startSync(): void {
    if (this.syncUnsubs.length > 0 || typeof window === "undefined") return;
    const script = () => this.project.getState().prompter.script;

    const shared = readSharedScript();
    if (shared && shared.text !== script() && script().trim() === "") {
      this.adoptScript(shared);
    } else if (script().trim() !== "" && shared?.text !== script()) {
      this.pushScript();
    }
    this.lastSyncedScript = script();

    this.syncUnsubs.push(
      subscribeScript((m) => {
        if (m.at > this.lastSyncAt && m.text !== script()) this.adoptScript(m);
      }),
      subscribeHandoff(() => this.importHandoff()),
      this.project.subscribe(() => {
        if (script() === this.lastSyncedScript) return;
        this.lastSyncedScript = script();
        if (this.syncTimer) clearTimeout(this.syncTimer);
        this.syncTimer = setTimeout(() => this.pushScript(), 400);
      }),
    );
    this.importHandoff();
  }

  private adoptScript(m: ScriptMessage): void {
    this.lastSyncAt = m.at;
    this.lastSyncedScript = m.text;
    this.project.setPrompterScript(m.text);
  }

  private pushScript(): void {
    const at = Date.now();
    this.lastSyncAt = at;
    publishScript(this.project.getState().prompter.script, "main", at);
  }

  /** Scenes queued by the Classic studio; validated through the project schema before use. */
  importHandoff(): number {
    const h = takeHandoff();
    if (!h) return 0;
    const base = this.project.getState();
    const parsed = parseProject({ ...base, scenes: h.scenes, activeSceneId: "" });
    if (!parsed.ok) return 0;
    let n = 0;
    for (const sc of parsed.project.scenes) {
      if (this.project.appendScene({ ...sc, name: `↪ ${sc.name}` })) n++;
    }
    return n;
  }

  isTrackPlaying(trackId: string): boolean {
    return this.gen?.trackId === trackId;
  }

  /** Start/stop a built-in procedural lo-fi / ambient track (no files, no licences). */
  async toggleTrack(trackId: string): Promise<boolean> {
    const bus = this.audio;
    if (this.gen?.trackId === trackId) {
      this.stopTrack();
      return false;
    }
    if (typeof AudioContext === "undefined") return false;
    await bus.ensureRunning();
    if (!this.gen) {
      const ctx = new AudioContext();
      const dest = ctx.createMediaStreamDestination();
      this.gen = { ctx, player: createMusicPlayer(ctx, dest), stream: dest.stream, trackId: null };
    }
    const gen = this.gen;
    await gen.ctx.resume();
    gen.player.setVolume(0.9);
    gen.player.start(trackId);
    gen.trackId = trackId;
    // Re-adding the channel also notifies audio-state subscribers (UI) about the track change.
    const label = TRACKS.find((t) => t.id === trackId)?.name ?? "Müzik listesi";
    const gain = bus.getState().channels.find((c) => c.id === GEN_CHANNEL)?.gain ?? 0.5;
    bus.removeChannel(GEN_CHANNEL);
    bus.addChannel({ id: GEN_CHANNEL, label, kind: "music" }, gen.stream, { gain });
    return true;
  }

  stopTrack(): void {
    if (!this.gen) return;
    this.gen.player.stop();
    this.gen.trackId = null;
    this.audio.removeChannel(GEN_CHANNEL);
  }

  /** Built-in synthesized sound effect (ZzFX) through the "sfx" channel. */
  async playPresetEffect(presetId: string): Promise<boolean> {
    const preset = SFX_PRESETS.find((p) => p.id === presetId);
    if (!preset || typeof AudioContext === "undefined") return false;
    let buf = this.sfxBuffers.get(presetId);
    if (!buf) {
      buf = await buildSfxBuffer(preset);
      this.sfxBuffers.set(presetId, buf);
    }
    await this.audio.ensureRunning();
    this.audio.playSfx(buf);
    return true;
  }

  async playEffect(assetId: string): Promise<boolean> {
    const rec = await this.assets.get(assetId);
    if (!rec) return false;
    await this.audio.ensureRunning();
    this.audio.playSfx(rec.blob);
    return true;
  }

  /* -------------------------------- recording ----------------------------- */

  async startRecording(): Promise<boolean> {
    if (!this.canvas || this.recorder) return false;
    try {
      await this.audio.ensureRunning();
      const o = this.project.getState().settings.output;
      const rec = new StudioRecorder(this.canvas, this.audio.getMixStream(), {
        fps: o.fps,
        videoBitrate: o.videoBitrate,
        audioBitrate: o.audioBitrate,
        container: o.container,
        onWarning: (w) => this.patch({ recorderWarning: w }),
      });
      this.recorder = rec;
      this.recorderUnsub = rec.subscribe(() =>
        this.patch({ recorder: rec.getState() }),
      );
      rec.start();
      this.patch({
        recorder: rec.getState(),
        recorderWarning: null,
        error: null,
      });
      return true;
    } catch (e) {
      this.recorderUnsub?.();
      this.recorder = null;
      this.patch({
        recorder: null,
        error: (e as { code?: string } | null)?.code ?? "record-failed",
      });
      return false;
    }
  }

  async stopRecording(): Promise<boolean> {
    const rec = this.recorder;
    if (!rec) return false;
    try {
      const result = await rec.stop();
      const base = timestampName(this.project.getState().name || "kayit");
      await downloadRecordingBundle(result, base);
      return true;
    } catch (e) {
      this.patch({
        error: (e as { code?: string } | null)?.code ?? "record-failed",
      });
      return false;
    } finally {
      this.recorderUnsub?.();
      this.recorderUnsub = null;
      rec.dispose();
      this.recorder = null;
      this.patch({ recorder: null });
    }
  }

  toggleRecording(): void {
    if (this.recorder) void this.stopRecording();
    else void this.startRecording();
  }

  addMarker(label?: string): boolean {
    return this.recorder?.addMarker(label) != null;
  }

  isRecording(): boolean {
    const s = this.recorder?.getState().status;
    return s === "recording" || s === "paused";
  }

  getRecordingElapsedMs(): number {
    return this.recorder?.getElapsedMs() ?? 0;
  }

  /* --------------------------- ripples (prototype) ------------------------- */

  addRipple(
    layerId: string,
    nx: number,
    ny: number,
    kind: RippleKind = "touch",
  ): void {
    getRippleField(layerId).add(nx, ny, performance.now(), kind);
  }

  /* --------------------------- hotkeys & remote --------------------------- */

  /** Handle a keydown. Returns true when the event was consumed (caller should preventDefault). */
  handleKey(e: KeyboardEvent): boolean {
    const st = this.project.getState();
    const action = resolveShortcut(e, st.settings.shortcuts, {
      allowRepeat: false,
    });
    if (action) {
      this.runAction(action);
      return true;
    }
    // scene hotkeys: a bare key such as "1".."9" bound to a scene
    if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) {
      const t = e.target as HTMLElement | null;
      const typing =
        !!t &&
        (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if (!typing) {
        const scene = st.scenes.find((s) => s.hotkey && s.hotkey === e.key);
        if (scene) {
          this.switchScene(scene.id);
          return true;
        }
      }
    }
    return false;
  }

  runAction(action: string): void {
    switch (action) {
      case "record.toggle":
        this.toggleRecording();
        break;
      case "marker.add":
        this.addMarker();
        break;
      case "prompter.toggle":
        this.prompter.toggle();
        break;
      case "prompter.speedUp":
        this.prompter.speedUp();
        break;
      case "prompter.speedDown":
        this.prompter.speedDown();
        break;
      case "prompter.rewind":
        this.prompter.rewind();
        break;
      case "audio.muteMic":
        this.toggleMicMuted();
        break;
      case "scene.next":
        this.stepScene(1);
        break;
      case "scene.prev":
        this.stepScene(-1);
        break;
    }
  }

  /** Execute a command from the phone remote (already validated by the p2p layer). */
  executeRemote(cmd: RemoteCommand): void {
    switch (cmd.kind) {
      case "scene":
        this.switchScene(cmd.id);
        break;
      case "scene-index":
        this.switchSceneByIndex(cmd.index);
        break;
      case "prompter":
        this.runAction(
          cmd.action === "toggle"
            ? "prompter.toggle"
            : cmd.action === "speedUp"
              ? "prompter.speedUp"
              : cmd.action === "speedDown"
                ? "prompter.speedDown"
                : "prompter.rewind",
        );
        break;
      case "mute":
        if (cmd.value === undefined) this.toggleMicMuted();
        else this.setMicMuted(cmd.value);
        break;
      case "record":
        if (cmd.action === "toggle") this.toggleRecording();
        else if (cmd.action === "start") void this.startRecording();
        else void this.stopRecording();
        break;
      case "marker":
        this.addMarker();
        break;
    }
  }

  getRemoteState(): RemoteState {
    const st = this.project.getState();
    const p = this.prompter.getSnapshot();
    return {
      scenes: st.scenes.map((s: Scene) => ({
        id: s.id,
        name: s.name,
        ...(s.hotkey ? { hotkey: s.hotkey } : {}),
      })),
      activeSceneId: st.activeSceneId,
      recording: this.isRecording(),
      micMuted: this.snap.micMuted,
      prompterPlaying: p.playing,
      prompterSpeed: p.speedPx,
      recordingMs: Math.round(this.getRecordingElapsedMs()),
    };
  }

  /* -------------------------------- lifecycle ----------------------------- */

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubProject();
    if (this.exposureTimer) clearInterval(this.exposureTimer);
    await this.flushExposure();
    this.voice?.stop();
    if (this.recorder) await this.stopRecording();
    await this.autosaver.flush();
    this.unmountCanvas();
    this.compositor?.dispose();
    this.compositor = null;
    this.canvas = null;
    this.roomUnsub?.();
    this.roomSession?.dispose();
    this.roomSession = null;
    this.liveStreamer?.dispose();
    this.liveStreamer = null;
    this.teardownHost();
    for (const el of this.music.values()) el.pause();
    this.music.clear();
    for (const u of this.syncUnsubs) u();
    this.syncUnsubs = [];
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.gen?.player.stop();
    void this.gen?.ctx.close();
    this.gen = null;
    this.sources.dispose();
    this.audio.dispose();
    this.assets.dispose();
    this.listeners.clear();
  }
}
