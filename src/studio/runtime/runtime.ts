// src/studio/runtime/runtime.ts
// The glue: one StudioRuntime owns the project store, asset store, audio bus, prompter engine,
// media sources, compositor and recorder, and exposes the actions the UI needs.
// Browser-only: create it inside an effect (see use-studio.tsx), never at module scope.
import { Compositor } from "../engine/compositor";
import { AudioBus } from "../engine/audio-bus";
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
import { defaultProject } from "../defaults";
import type {
  AssetStore,
  CompositorHooks,
  Layer,
  PrompterLayer,
  Rect,
  RemoteCommand,
  RemoteState,
  Scene,
  WebLayer,
} from "../types";
import { SourceManager } from "./sources";

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
  }

  /* ---------------------------- snapshot store ---------------------------- */

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getSnapshot = (): RuntimeSnapshot => this.snap;
  private patch(p: Partial<RuntimeSnapshot>): void {
    this.snap = { ...this.snap, ...p };
    for (const l of [...this.listeners]) l();
  }

  /* -------------------------------- startup ------------------------------- */

  /** Restore the autosaved project (validated + repaired). Safe to call once after creation. */
  async restore(): Promise<boolean> {
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

  /** Bind the preview/program canvas and start the render loop. */
  attachCanvas(canvas: HTMLCanvasElement): void {
    if (this.compositor) this.detachCanvas();
    const out = this.project.getState().settings.output;
    canvas.width = out.width;
    canvas.height = out.height;
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

  detachCanvas(): void {
    this.compositor?.dispose();
    this.compositor = null;
    this.canvas = null;
  }

  getCompositor(): Compositor | null {
    return this.compositor;
  }

  private hooks: CompositorHooks = {
    resolveSource: (layer: Layer) => this.sources.resolve(layer),
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
    const assetIds = new Set<string>();
    for (const s of state.scenes)
      for (const l of s.layers) {
        layerIds.add(l.id);
        if ((l.kind === "image" || l.kind === "video") && l.assetId)
          assetIds.add(l.assetId);
      }
    this.sources.gc(layerIds, assetIds);
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
    return this.project.setActiveScene(id);
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
    this.voice?.stop();
    if (this.recorder) await this.stopRecording();
    await this.autosaver.flush();
    this.detachCanvas();
    for (const el of this.music.values()) el.pause();
    this.music.clear();
    this.sources.dispose();
    this.audio.dispose();
    this.assets.dispose();
    this.listeners.clear();
  }
}
