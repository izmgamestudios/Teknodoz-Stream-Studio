import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { toMainScene } from "@/classic/sync";
import { AdjustControls } from "@/studio/ui/adjust-controls";
import { hasFx } from "@/studio/engine/adjust";
import { FxProcessor } from "@/studio/engine/fx";
import {
  applyVoicePreset,
  duckStep,
  loadVoiceSettings,
  saveVoiceSettings,
  VoiceProcessor,
  type VoiceMeter,
  type VoicePreset,
  type VoiceSettings,
} from "@/studio/engine/voice";
import { sendHandoff } from "@/studio/sync/shared";
import { ClassicNav } from "@/classic/components/classic-nav";
import { RemotePanel } from "@/classic/components/remote-panel";
import {
  RundownBar,
  type RundownEntry,
} from "@/classic/components/rundown-bar";
import { useRemoteHost } from "@/classic/remote/host";
import type { Command } from "@/classic/remote/protocol";
import { TRACKS } from "@/studio/engine/music";
import { drawScene, itemBoxPct } from "@/classic/studio/render";
import { buildSfxBuffer, SFX_PRESETS } from "@/studio/engine/sfx-presets";
import { ITEM_PRESETS, TEMPLATES } from "@/classic/studio/templates";
import {
  createTransitionEngine,
  NO_TRANSITION,
  GL_TRANSITIONS,
  type TransitionEngine,
} from "@/studio/engine/gl-transitions";
import {
  ASPECTS,
  type Aspect,
  type Base,
  type Corner,
  emptyScene,
  H,
  type Item,
  type Layout,
  type Scene,
  type Sources,
  STAGES,
  uid,
  W,
} from "@/classic/studio/types";
import { useAudioMixer } from "@/classic/studio/use-audio-mixer";
import {
  addTemplate,
  duplicateTemplate,
  moveTemplate,
  removeTemplate,
  renameTemplate,
  updateTemplate,
  TPL_KEY,
  type SavedTemplate,
} from "@/classic/studio/saved-templates";
import { LibraryPicker } from "@/studio/ui/library-picker";
import { mediaUrl } from "@/studio/watch/media-client";

export const Route = createFileRoute("/classic/")({
  head: () => ({
    meta: [
      { title: "Klasik Stüdyo — Teknodoz" },
      {
        name: "description",
        content:
          "Solda düzenle, sağda canlı yayını izle: şablonlar, geçiş efektleri, ses efektleri ve kayıt.",
      },
      { property: "og:title", content: "Klasik Stüdyo — Teknodoz" },
      {
        property: "og:description",
        content:
          "Şablonlu sahneler, WebGL geçişleri, sentezlenmiş ses efektleri ve tarayıcıda kayıt.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Studio,
});

const ASPECT_KEY = "classic.aspect.v1";
const CORNERS: [Corner, string][] = [
  ["tl", "↖"],
  ["tr", "↗"],
  ["bl", "↙"],
  ["br", "↘"],
];
const LAYOUTS: [Layout, string][] = [
  ["full", "Tam ekran"],
  ["pip", "Köşede kamera"],
  ["split", "Yan yana"],
];
const SOURCES: [Base, string][] = [
  ["camera", "Kamera"],
  ["screen", "Ekran"],
  ["video", "Video"],
  ["guest", "Konuk"],
];
const RUNDOWN_KEY = "studio.rundown.v1";
type RundownScene = RundownEntry & { scene: Scene };
const stripImages = (sc: Scene): Scene => ({
  ...structuredClone(sc),
  items: sc.items.filter((i) => i.kind !== "image"),
});
const defaultRundown = (): RundownScene[] =>
  ["podcast", "split", "news", "clean"].map((id, i) => {
    const t = TEMPLATES.find((x) => x.id === id)!;
    return {
      id: uid(),
      name: ["Açılış", "Sohbet", "Haber", "Kapanış"][i]!,
      scene: t.build(),
    };
  });
function loadRundown(): RundownScene[] {
  try {
    const raw = localStorage.getItem(RUNDOWN_KEY);
    if (raw) return JSON.parse(raw) as RundownScene[];
  } catch {
    /* storage blocked or corrupt */
  }
  return defaultRundown();
}
const ITEM_TILES: [string, string][] = [
  ["text", "T Yazı"],
  ["banner", "▭ Banner"],
  ["sub", "💬 Altyazı"],
  ["lower", "▤ Alt bant"],
  ["badge", "● Rozet"],
  ["ticker", "➡ Kayan yazı"],
];

type Transition = {
  from: Scene;
  to: Scene;
  start: number;
  dur: number;
  name: string;
};
type Tab = "templates" | "source" | "items";

const ease = (p: number) =>
  p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;

function loadSaved(): SavedTemplate[] {
  try {
    const raw = localStorage.getItem(TPL_KEY);
    return raw ? (JSON.parse(raw) as SavedTemplate[]) : [];
  } catch {
    return [];
  }
}
function persistSaved(list: SavedTemplate[]) {
  try {
    localStorage.setItem(TPL_KEY, JSON.stringify(list));
  } catch {
    /* storage blocked */
  }
}

function Studio() {
  const camRef = useRef<HTMLVideoElement>(null);
  const scrRef = useRef<HTMLVideoElement>(null);
  const bgvRef = useRef<HTMLVideoElement>(null);
  const bgaRef = useRef<HTMLAudioElement>(null);
  const draftCanvas = useRef<HTMLCanvasElement>(null);
  const progCanvas = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const camStream = useRef<MediaStream | null>(null);
  const scrStream = useRef<MediaStream | null>(null);
  const images = useRef<Sources["images"]>({});
  const recRef = useRef<MediaRecorder | null>(null);
  const engineRef = useRef<TransitionEngine | null>(null);
  const transRef = useRef<Transition | null>(null);
  const sfxCache = useRef(new Map<string, AudioBuffer>());
  const mixer = useAudioMixer();

  const [draft, setDraft] = useState<Scene>(() => TEMPLATES[1]!.build());
  const [program, setProgram] = useState<Scene>(() => emptyScene());
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const programRef = useRef(program);
  programRef.current = program;

  const [tab, setTab] = useState<Tab>("templates");
  const [selected, setSelected] = useState<string | null>(null);
  const [hasScreen, setHasScreen] = useState(false);
  const [hasBgVideo, setHasBgVideo] = useState(false);
  const [bgAudioName, setBgAudioName] = useState("");
  const [bgVol, setBgVol] = useState(0.3);
  const [uploads, setUploads] = useState<
    { id: string; label: string; buffer: AudioBuffer }[]
  >([]);
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const [camErr, setCamErr] = useState("");
  const [saved, setSaved] = useState<SavedTemplate[]>([]);
  /** id of the saved template whose scene is being edited in the draft */
  const [editingTpl, setEditingTpl] = useState<string | null>(null);
  const [transition, setTransition] = useState("fade");
  const [transMs, setTransMs] = useState(900);
  const [available, setAvailable] = useState<string[]>([]);
  const [liveTick, setLiveTick] = useState(0);
  const [live, setLive] = useState(false);
  const [rundown, setRundown] = useState<RundownScene[]>([]);
  const [rundownReady, setRundownReady] = useState(false);
  const [syncNote, setSyncNote] = useState("");
  const [liveIdx, setLiveIdx] = useState(-1);
  const [editIdx, setEditIdx] = useState(-1);
  const [pane, setPane] = useState<"edit" | "live">("edit");
  const [trackId, setTrackId] = useState<string | null>(null);
  const [aspect, setAspect] = useState<Aspect>("16:9");
  const [hd, setHd] = useState(false);
  const [voice, setVoice] = useState<VoiceSettings>(() => loadVoiceSettings());
  const [meter, setMeter] = useState<VoiceMeter>({ open: true, db: -100 });
  const { register, publish, guest } = useRemoteHost();
  const stage = STAGES[aspect];
  const outScale = hd ? 1.5 : 1;
  const prog = {
    w: Math.round(stage.w * outScale),
    h: Math.round(stage.h * outScale),
  };
  const draftDims = {
    w: Math.round(stage.w * 0.75),
    h: Math.round(stage.h * 0.75),
  };
  const ratio = stage.w / stage.h;
  const aspectRef = useRef(aspect);
  aspectRef.current = aspect;
  const fxRef = useRef<FxProcessor | null>(null);
  const voiceRef = useRef(new VoiceProcessor());
  const micState = useRef<"none" | "pending" | "ready">("none");
  const voiceSettingsRef = useRef(voice);
  voiceSettingsRef.current = voice;
  const duckMul = useRef(1);
  const bgVolRef = useRef(0.3);
  const trackIdRef = useRef<string | null>(null);
  const guestRef = useRef<HTMLVideoElement>(null);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(program),
    [draft, program],
  );
  const sel = draft.items.find((i) => i.id === selected);

  // saved templates + WebGL transition engine (client only)
  useEffect(() => {
    setSaved(loadSaved());
    setRundown(loadRundown());
    setRundownReady(true);
    let dead = false;
    createTransitionEngine()
      .then((eng) => {
        if (dead) return eng?.dispose();
        engineRef.current = eng;
        setAvailable(eng?.available ?? []);
      })
      .catch(() => setAvailable([]));
    return () => {
      dead = true;
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!rundownReady) return;
    try {
      localStorage.setItem(
        RUNDOWN_KEY,
        JSON.stringify(
          rundown.map((r) => ({ ...r, scene: stripImages(r.scene) })),
        ),
      );
    } catch {
      /* storage blocked */
    }
  }, [rundown, rundownReady]);

  // guest camera (from /join or phone remote) arrives as a WebRTC stream
  useEffect(() => {
    const el = guestRef.current;
    if (el) el.srcObject = guest?.stream ?? null;
    if (guest) mixer.connectStream(guest.stream, true);
    if (!guest)
      setDraft((d) => (d.base === "guest" ? { ...d, base: "camera" } : d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guest]);

  // camera + mic
  useEffect(() => {
    let dead = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { width: 1280, height: 720 }, audio: true })
      .then((s) => {
        if (dead) return s.getTracks().forEach((t) => t.stop());
        camStream.current = s;
        if (camRef.current) camRef.current.srcObject = s;
      })
      .catch(() => setCamErr("Kameraya erişilemedi. İzinleri kontrol edin."));
    return () => {
      dead = true;
      camStream.current?.getTracks().forEach((t) => t.stop());
      scrStream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const prepareAudio = useCallback(() => {
    mixer.ensure();
    const mic = camStream.current;
    if (mic && micState.current === "none" && mic.getAudioTracks().length) {
      // the mic goes through the voice chain (gate / EQ / compressor / limiter); raw on failure
      micState.current = "pending";
      voiceRef.current
        .attach(new MediaStream(mic.getAudioTracks()), voiceSettingsRef.current)
        .then((processed) => {
          mixer.connectStream(processed);
          micState.current = "ready";
        })
        .catch(() => {
          mixer.connectStream(mic);
          micState.current = "ready";
        });
    }
    mixer.connectElement(bgaRef.current);
    mixer.connectElement(bgvRef.current);
  }, [mixer]);

  // voice settings: persist, apply to the live chain, follow the gate meter
  useEffect(() => {
    saveVoiceSettings(voice);
    voiceRef.current.update(voice);
  }, [voice]);
  useEffect(() => voiceRef.current.subscribe(setMeter), []);
  useEffect(() => () => voiceRef.current.detach(), []);

  // automatic music ducking: lower music while the mic is speaking
  useEffect(() => {
    if (!voice.ducking.enabled) {
      duckMul.current = 1;
      return;
    }
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const m = voiceRef.current.getMeter();
      const speaking = voiceSettingsRef.current.enabled
        ? m.open && m.db > voice.ducking.thresholdDb
        : m.db > voice.ducking.thresholdDb;
      duckMul.current = duckStep(
        duckMul.current,
        speaking,
        voice.ducking,
        now - last,
      );
      last = now;
      const level = bgVolRef.current * duckMul.current;
      if (bgaRef.current) bgaRef.current.volume = Math.min(1, level);
      if (bgvRef.current) bgvRef.current.volume = Math.min(1, level);
      if (trackIdRef.current) mixer.music().setVolume(level);
    }, 50);
    return () => {
      clearInterval(id);
      duckMul.current = 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.ducking]);

  // one render loop: draft preview + live program (with WebGL transition)
  useEffect(() => {
    const fromC = document.createElement("canvas");
    const toC = document.createElement("canvas");
    fromC.width = toC.width = W;
    fromC.height = toC.height = H;
    fxRef.current = new FxProcessor();
    let raf = 0;
    const loop = () => {
      const st = STAGES[aspectRef.current];
      const fxp = fxRef.current;
      const t = performance.now() / 1000;
      const src: Sources = {
        cam: camRef.current,
        scr: scrRef.current,
        bgv: bgvRef.current,
        guest: guestRef.current,
        images: images.current,
      };

      const dctx = draftCanvas.current?.getContext("2d");
      const dcv = draftCanvas.current;
      if (dctx && dcv)
        drawScene(
          dctx,
          draftRef.current,
          src,
          t,
          dcv.width,
          dcv.height,
          st,
          fxp,
        );

      const pcv = progCanvas.current;
      const pctx = pcv?.getContext("2d");
      if (pctx && pcv) {
        const PW = pcv.width;
        const PH = pcv.height;
        if (fromC.width !== PW || fromC.height !== PH) {
          fromC.width = toC.width = PW;
          fromC.height = toC.height = PH;
        }
        const tr = transRef.current;
        const eng = engineRef.current;
        const p = tr ? (performance.now() - tr.start) / tr.dur : 1;
        if (tr && p < 1 && eng) {
          const f = fromC.getContext("2d")!,
            g = toC.getContext("2d")!;
          drawScene(f, tr.from, src, t, PW, PH, st, fxp);
          drawScene(g, tr.to, src, t, PW, PH, st, fxp);
          if (eng.render(tr.name, fromC, toC, ease(p), PW, PH))
            pctx.drawImage(eng.canvas, 0, 0, PW, PH);
          else {
            pctx.globalAlpha = 1;
            pctx.drawImage(fromC, 0, 0);
            pctx.globalAlpha = ease(p);
            pctx.drawImage(toC, 0, 0);
            pctx.globalAlpha = 1;
          }
        } else {
          transRef.current = null;
          drawScene(pctx, programRef.current, src, t, PW, PH, st, fxp);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      fxRef.current?.dispose();
    };
  }, []);

  // recording timer
  useEffect(() => {
    if (!recording) return;
    setRecSecs(0);
    const id = setInterval(() => setRecSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

  useEffect(() => {
    bgVolRef.current = bgVol;
    trackIdRef.current = trackId;
    const level = bgVol * duckMul.current;
    if (bgaRef.current) bgaRef.current.volume = Math.min(1, level);
    if (bgvRef.current) bgvRef.current.volume = Math.min(1, level);
    if (trackId) mixer.music().setVolume(level);
  }, [bgVol, trackId]);

  // output aspect: remembered, locked while recording (the recorder owns the canvas size)
  useEffect(() => {
    try {
      const a = localStorage.getItem(ASPECT_KEY) as Aspect | null;
      if (a && a in STAGES) setAspect(a);
    } catch {
      /* storage blocked */
    }
  }, []);
  const chooseAspect = (a: Aspect) => {
    if (recording || a === aspect) return;
    setAspect(a);
    // programs already on air keep their look; the program is re-drawn for the new stage
    try {
      localStorage.setItem(ASPECT_KEY, a);
    } catch {
      /* storage blocked */
    }
  };

  // ---------- scene editing ----------
  const patch = (p: Partial<Scene>) => setDraft((d) => ({ ...d, ...p }));

  function applyTemplate(scene: Scene) {
    setDraft((d) => ({
      ...scene,
      items: [...d.items.filter((i) => i.kind === "image"), ...scene.items],
    }));
    setSelected(null);
  }

  function commitSaved(next: SavedTemplate[]) {
    setSaved(next);
    persistSaved(next);
  }
  function saveTemplate(defaultName = "") {
    const name = window.prompt("Şablon adı?", defaultName);
    if (!name?.trim()) return;
    const r = addTemplate(saved, name, draft);
    commitSaved(r.list);
    setEditingTpl(r.id);
  }
  function deleteSaved(id: string) {
    commitSaved(removeTemplate(saved, id));
    if (editingTpl === id) setEditingTpl(null);
  }
  function renameSaved(t: SavedTemplate) {
    const name = window.prompt("Yeni ad?", t.name);
    if (name?.trim()) commitSaved(renameTemplate(saved, t.id, name));
  }
  function copySaved(id: string) {
    const r = duplicateTemplate(saved, id);
    commitSaved(r.list);
  }

  function addItem(it: Omit<Item, "id">) {
    const n: Item = { ...it, id: uid() };
    if (n.src && !images.current[n.src]) {
      const im = new Image();
      im.src = n.src;
      images.current[n.src] = im;
    }
    setDraft((d) => ({ ...d, items: [...d.items, n] }));
    setSelected(n.id);
  }
  function addPreset(key: string, at?: { x: number; y: number }) {
    const p = ITEM_PRESETS[key];
    if (!p) return;
    const fixed = p.kind === "subtitle" || p.kind === "ticker";
    addItem(at && !fixed ? { ...p, x: at.x, y: at.y } : p);
  }
  function updateItem(id: string, p: Partial<Item>) {
    setDraft((d) => ({
      ...d,
      items: d.items.map((i) => (i.id === id ? { ...i, ...p } : i)),
    }));
  }
  function removeItem(id: string) {
    setDraft((d) => ({ ...d, items: d.items.filter((i) => i.id !== id) }));
    setSelected(null);
  }
  function moveLayer(id: string, dir: -1 | 1) {
    setDraft((d) => {
      const idx = d.items.findIndex((i) => i.id === id),
        to = idx + dir;
      if (idx < 0 || to < 0 || to >= d.items.length) return d;
      const items = [...d.items];
      [items[idx], items[to]] = [items[to]!, items[idx]!];
      return { ...d, items };
    });
  }
  function duplicate(it: Item) {
    addItem({ ...it, x: Math.min(95, it.x + 4), y: Math.min(95, it.y + 4) });
  }

  function onStageDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const at = {
      x: ((e.clientX - r.left) / r.width) * 100,
      y: ((e.clientY - r.top) / r.height) * 100,
    };
    const f = e.dataTransfer.files?.[0];
    if (f?.type.startsWith("image/"))
      return addItem({
        kind: "image",
        src: URL.createObjectURL(f),
        ...at,
        w: 20,
      });
    addPreset(e.dataTransfer.getData("text/plain"), at);
  }

  function startDrag(e: React.PointerEvent, it: Item) {
    e.stopPropagation();
    setSelected(it.id);
    const stage = stageRef.current!.getBoundingClientRect();
    const move = (ev: PointerEvent) =>
      updateItem(it.id, {
        x: Math.min(
          100,
          Math.max(0, ((ev.clientX - stage.left) / stage.width) * 100),
        ),
        y: Math.min(
          100,
          Math.max(0, ((ev.clientY - stage.top) / stage.height) * 100),
        ),
      });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // ---------- sources ----------
  async function shareScreen() {
    if (hasScreen) {
      scrStream.current?.getTracks().forEach((t) => t.stop());
      setHasScreen(false);
      return;
    }
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      scrStream.current = s;
      if (scrRef.current) scrRef.current.srcObject = s;
      const vt = s.getVideoTracks()[0];
      if (vt) vt.onended = () => setHasScreen(false);
      mixer.connectStream(s);
      setHasScreen(true);
      patch({ base: "screen" });
    } catch {
      /* cancelled */
    }
  }

  // ---------- audio ----------
  async function playPreset(id: string) {
    const preset = SFX_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    prepareAudio();
    let buf = sfxCache.current.get(id);
    if (!buf) {
      buf = await buildSfxBuffer(preset);
      sfxCache.current.set(id, buf);
    }
    mixer.playBuffer(buf);
  }
  const playPresetRef = useRef(playPreset);
  playPresetRef.current = playPreset;

  // keyboard: 1-8 fires sound effects, Delete removes the selected item
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Delete" && selected) return removeItem(selected);
      const n = Number(e.key);
      if (e.key === "n" || e.key === "N")
        return cmdRef.current({ cmd: "next" });
      if (e.key === "p" || e.key === "P")
        return cmdRef.current({ cmd: "prev" });
      if (n >= 1 && n <= Math.min(8, SFX_PRESETS.length))
        void playPresetRef.current(SFX_PRESETS[n - 1]!.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  // ---------- rundown ----------
  const stepScene = (dir: 1 | -1) => {
    if (!rundown.length) return;
    const from = liveIdx >= 0 ? liveIdx : editIdx;
    playScene(
      Math.min(rundown.length - 1, Math.max(0, from < 0 ? 0 : from + dir)),
    );
  };
  function playScene(i: number) {
    const r = rundown[i];
    if (!r) return;
    setDraft(structuredClone(r.scene));
    setEditIdx(i);
    setSelected(null);
    void goLive(r.scene, i);
  }
  function editScene(i: number) {
    const r = rundown[i];
    if (!r) return;
    setDraft(structuredClone(r.scene));
    setEditIdx(i);
    setSelected(null);
    setPane("edit");
  }
  function addScene() {
    const name = window.prompt("Sahne adı?", `Sahne ${rundown.length + 1}`);
    if (!name?.trim()) return;
    setRundown((r) => [
      ...r,
      {
        id: uid(),
        name: name.trim(),
        scene: structuredClone(draftRef.current),
      },
    ]);
    setEditIdx(rundown.length);
  }
  function updateScene() {
    setRundown((r) =>
      r.map((x, i) =>
        i === editIdx ? { ...x, scene: structuredClone(draftRef.current) } : x,
      ),
    );
  }
  function renameScene(i: number) {
    const name = window.prompt("Sahne adı?", rundown[i]?.name);
    if (name?.trim())
      setRundown((r) =>
        r.map((x, k) => (k === i ? { ...x, name: name.trim() } : x)),
      );
  }
  function moveScene(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= rundown.length) return;
    setRundown((r) => {
      const c = [...r];
      [c[i], c[j]] = [c[j]!, c[i]!];
      return c;
    });
    const follow = (x: number) => (x === i ? j : x === j ? i : x);
    setLiveIdx(follow);
    setEditIdx(follow);
  }
  function deleteScene(i: number) {
    if (!window.confirm(`“${rundown[i]?.name}” sahnesi silinsin mi?`)) return;
    setRundown((r) => r.filter((_, k) => k !== i));
    const shift = (x: number) => (x === i ? -1 : x > i ? x - 1 : x);
    setLiveIdx(shift);
    setEditIdx(shift);
  }

  // ---------- sync to the main Studio ----------
  function exportToMain() {
    const results = rundown.map((r) => toMainScene(r.scene, r.name, aspect));
    const ok = sendHandoff(
      results.map((r) => r.scene),
      "classic",
      results[0]?.stage,
    );
    const skipped = new Set(results.flatMap((r) => r.skipped));
    setSyncNote(
      ok
        ? `${results.length} sahne ana Stüdyo'ya gönderildi.${skipped.size ? ` Aktarılamayanlar: ${[...skipped].join("; ")}.` : ""}`
        : "Gönderilemedi (tarayıcı depolaması kapalı veya veri çok büyük).",
    );
  }

  // ---------- music ----------
  function playTrack(id: string) {
    prepareAudio();
    const m = mixer.music();
    m.setVolume(bgVol);
    m.start(id);
    setTrackId(id);
  }
  function stopMusic() {
    mixer.stopMusic();
    setTrackId(null);
  }

  // ---------- phone remote ----------
  const cmdRef = useRef<(c: Command) => void>(() => {});
  cmdRef.current = (c) => {
    switch (c.cmd) {
      case "next":
        return stepScene(1);
      case "prev":
        return stepScene(-1);
      case "golive":
        return void goLive();
      case "rec":
        return toggleRec();
      case "scene":
        return playScene(Number(c.arg));
      case "edit":
        return editScene(Number(c.arg));
      case "sfx":
        return void playPreset(String(c.arg));
      case "music":
        return c.arg === "stop" ? stopMusic() : playTrack(String(c.arg));
    }
  };
  useEffect(() => register((c) => cmdRef.current(c)), [register]);
  useEffect(() => {
    publish({
      page: "studio",
      scenes: rundown.map((r) => r.name),
      live: liveIdx,
      editing: editIdx,
      isLive: live && !dirty,
      recording,
      recSecs,
      music: trackId,
      tracks: TRACKS.map((t) => ({ id: t.id, name: t.name })),
      sfx: SFX_PRESETS.map((p) => ({
        id: p.id,
        label: p.label,
        emoji: p.emoji,
      })),
      guest: !!guest,
    });
  }, [
    publish,
    rundown,
    liveIdx,
    editIdx,
    live,
    dirty,
    recording,
    recSecs,
    trackId,
    guest,
  ]);
  useEffect(() => () => publish({ page: "idle" }), [publish]);

  // ---------- go live / record ----------
  async function goLive(scene: Scene = draftRef.current, idx = -1) {
    const next = structuredClone(scene);
    const name = transition;
    const hadProgram = live;
    if (name !== NO_TRANSITION && engineRef.current && hadProgram) {
      transRef.current = {
        from: structuredClone(programRef.current),
        to: next,
        start: performance.now(),
        dur: transMs,
        name,
      };
    } else {
      transRef.current = null;
    }
    programRef.current = next;
    setProgram(next);
    setLive(true);
    setLiveIdx(idx);
    setLiveTick((n) => n + 1);
  }

  function toggleRec() {
    if (recording) {
      recRef.current?.stop();
      return;
    }
    prepareAudio();
    const { dest } = mixer.ensure();
    const stream = new MediaStream([
      ...progCanvas.current!.captureStream(30).getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ]);
    const mime = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ].find((m) => MediaRecorder.isTypeSupported(m));
    const chunks: Blob[] = [];
    const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    r.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    r.onstop = () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob(chunks, { type: r.mimeType }));
      a.download = `studio-${Date.now()}.webm`;
      a.click();
      setRecording(false);
    };
    r.start(1000);
    recRef.current = r;
    setRecording(true);
    if (!live) void goLive();
  }

  const mmss = `${String(Math.floor(recSecs / 60)).padStart(2, "0")}:${String(recSecs % 60).padStart(2, "0")}`;
  const transitions = GL_TRANSITIONS.filter(([id]) => available.includes(id));
  const btn = "rounded bg-accent px-2 py-1 text-sm hover:brightness-110";
  const on = "bg-speaker-a text-background";

  return (
    <div className="min-h-screen p-3 pb-28 sm:p-4 xl:pb-4">
      {/* hidden media sources */}
      <video ref={camRef} autoPlay muted playsInline className="hidden" />
      <video ref={scrRef} autoPlay muted playsInline className="hidden" />
      <video
        ref={bgvRef}
        loop
        playsInline
        crossOrigin="anonymous"
        className="hidden"
      />
      <video ref={guestRef} autoPlay muted playsInline className="hidden" />
      <audio ref={bgaRef} loop />

      <header className="mb-4 flex flex-wrap items-center gap-3">
        <Link
          to="/classic/prompter"
          className="rounded-md bg-secondary px-3 py-2 text-sm hover:bg-accent"
        >
          ← Prompter
        </Link>
        <h1 className="text-2xl font-bold">Klasik Stüdyo</h1>
        {camErr && <span className="text-sm text-destructive">{camErr}</span>}
        <ClassicNav className="w-full sm:ml-auto sm:w-auto" />
      </header>

      <div
        className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-secondary p-1 text-sm font-semibold xl:hidden"
        role="tablist"
      >
        <button
          role="tab"
          aria-selected={pane === "edit"}
          onClick={() => setPane("edit")}
          className={`rounded-md py-2 ${pane === "edit" ? "bg-speaker-b text-background" : ""}`}
        >
          ✎ Düzenle
        </button>
        <button
          role="tab"
          aria-selected={pane === "live"}
          onClick={() => setPane("live")}
          className={`rounded-md py-2 ${pane === "live" ? "bg-red-700 text-white" : ""}`}
        >
          ● Canlı{recording ? ` · ${mmss}` : ""}
        </button>
      </div>

      <RundownBar
        items={rundown}
        live={liveIdx}
        editing={editIdx}
        onEdit={editScene}
        onLive={playScene}
        onAdd={addScene}
        onUpdate={updateScene}
        onRename={renameScene}
        onMove={moveScene}
        onDelete={deleteScene}
        onNext={() => stepScene(1)}
        onPrev={() => stepScene(-1)}
        onExport={exportToMain}
        note={syncNote}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        {/* ============ EDIT (left) ============ */}
        <section
          className={`rounded-xl border bg-card p-3 ${pane === "edit" ? "" : "hidden xl:block"}`}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="font-semibold text-speaker-b">
              ✎ DÜZENLE{" "}
              {dirty && (
                <span className="ml-2 rounded bg-speaker-a px-2 py-0.5 text-xs text-background">
                  yayına alınmadı
                </span>
              )}
            </h2>
            <button
              onClick={() => void goLive()}
              className={`rounded-md bg-speaker-b px-4 py-2 text-sm font-bold text-background ${dirty ? "animate-pulse" : "opacity-80"}`}
            >
              Yayına al →
            </button>
          </div>

          <div
            ref={stageRef}
            className="relative mx-auto w-full overflow-hidden rounded-lg bg-background"
            style={{
              aspectRatio: `${stage.w} / ${stage.h}`,
              width: `min(100%, ${(70 * ratio).toFixed(2)}vh)`,
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onStageDrop}
            onPointerDown={() => setSelected(null)}
          >
            <canvas
              ref={draftCanvas}
              width={draftDims.w}
              height={draftDims.h}
              className="pointer-events-none absolute inset-0 h-full w-full"
            />
            {draft.items.map((it) => {
              const b = itemBoxPct(it, images.current, stage);
              return (
                <div
                  key={it.id}
                  onPointerDown={(e) => startDrag(e, it)}
                  className={`absolute cursor-move touch-none select-none ${selected === it.id ? "outline-2 outline-dashed outline-ring" : "hover:outline hover:outline-1 hover:outline-ring/50"}`}
                  style={{
                    left: `${b.left}%`,
                    top: `${b.top}%`,
                    width: `${b.width}%`,
                    height: `${b.height}%`,
                  }}
                />
              );
            })}
          </div>

          <div className="mt-3 flex gap-1 text-sm">
            {(
              [
                ["templates", "Şablonlar"],
                ["source", "Kaynak & Görüntü"],
                ["items", "Öğeler"],
              ] as [Tab, string][]
            ).map(([k, l]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`rounded-t px-3 py-1.5 ${tab === k ? "bg-secondary font-semibold" : "text-muted-foreground hover:bg-accent"}`}
              >
                {l}
              </button>
            ))}
          </div>

          <div className="space-y-3 rounded-b-lg rounded-tr-lg bg-secondary p-3 text-sm">
            {tab === "templates" && (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {TEMPLATES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => {
                        applyTemplate(t.build());
                        setEditingTpl(null);
                      }}
                      title={t.hint}
                      className="rounded-lg bg-accent p-2 text-left hover:brightness-110"
                    >
                      <span className="text-xl">{t.emoji}</span>
                      <span className="block font-semibold">{t.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {t.hint}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="space-y-2 border-t pt-2">
                  {editingTpl && saved.some((s) => s.id === editingTpl) && (
                    <div
                      role="status"
                      className="flex flex-wrap items-center gap-2 rounded bg-primary/15 px-2 py-1"
                    >
                      <span>
                        ✎ Düzenleniyor:{" "}
                        <b>{saved.find((s) => s.id === editingTpl)?.name}</b>
                      </span>
                      <button
                        className={btn}
                        onClick={() =>
                          commitSaved(updateTemplate(saved, editingTpl, draft))
                        }
                      >
                        💾 Değişiklikleri kaydet
                      </button>
                      <button
                        className={btn}
                        onClick={() => setEditingTpl(null)}
                      >
                        Bırak
                      </button>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => saveTemplate()} className={btn}>
                      💾 Şablon olarak kaydet
                    </button>
                    <button
                      onClick={() => saveTemplate("Yeni şablon")}
                      className={btn}
                      title="Seçili şablonu / taslağı yeni bir ad ile kopyalar"
                    >
                      ⧉ Kopyasını oluştur
                    </button>
                  </div>
                  <ul className="space-y-1">
                    {saved.map((s, i) => (
                      <li
                        key={s.id}
                        className={`flex flex-wrap items-center gap-1 rounded bg-accent px-1 ${editingTpl === s.id ? "ring-2 ring-primary" : ""}`}
                      >
                        <button
                          onClick={() => {
                            applyTemplate(structuredClone(s.scene));
                            setEditingTpl(s.id);
                          }}
                          className="min-w-0 flex-1 truncate px-1.5 py-1 text-left hover:brightness-125"
                          title="Uygula ve düzenle"
                        >
                          ★ {s.name}
                        </button>
                        <button
                          onClick={() => renameSaved(s)}
                          aria-label={`${s.name} adını değiştir`}
                          title="Adı değiştir"
                          className="px-1.5 hover:bg-secondary"
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => copySaved(s.id)}
                          aria-label={`${s.name} şablonunu kopyala`}
                          title="Kopyala"
                          className="px-1.5 hover:bg-secondary"
                        >
                          ⧉
                        </button>
                        <button
                          onClick={() =>
                            commitSaved(moveTemplate(saved, s.id, -1))
                          }
                          disabled={i === 0}
                          aria-label="Yukarı taşı"
                          className="px-1.5 hover:bg-secondary disabled:opacity-40"
                        >
                          ↑
                        </button>
                        <button
                          onClick={() =>
                            commitSaved(moveTemplate(saved, s.id, 1))
                          }
                          disabled={i === saved.length - 1}
                          aria-label="Aşağı taşı"
                          className="px-1.5 hover:bg-secondary disabled:opacity-40"
                        >
                          ↓
                        </button>
                        <button
                          onClick={() => deleteSaved(s.id)}
                          aria-label={`${s.name} şablonunu sil`}
                          className="px-1.5 hover:bg-destructive"
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="text-xs text-muted-foreground">
                  Şablon seçince eklediğin logolar korunur. Hazır bir şablonu
                  değiştirmek için uygula, öğeleri düzenle, sonra "Şablon olarak
                  kaydet"; kayıtlı şablonu ★ ile açıp "Değişiklikleri kaydet"
                  diyebilirsin. Şablonlar bu tarayıcıda saklanır.
                </p>
              </>
            )}

            {tab === "source" && (
              <>
                <div className="flex flex-wrap gap-2">
                  {SOURCES.filter(([b]) => b !== "guest" || guest).map(
                    ([b, l]) => (
                      <button
                        key={b}
                        onClick={() => patch({ base: b })}
                        className={`${btn} ${draft.base === b ? on : ""}`}
                      >
                        {l}
                      </button>
                    ),
                  )}
                  <button onClick={() => void shareScreen()} className={btn}>
                    {hasScreen ? "Ekranı kapat" : "🖥 Ekran paylaş"}
                  </button>
                  <label className={`${btn} cursor-pointer`}>
                    🎞 Video yükle
                    <input
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f || !bgvRef.current) return;
                        bgvRef.current.src = URL.createObjectURL(f);
                        prepareAudio();
                        void bgvRef.current.play();
                        setHasBgVideo(true);
                        patch({ base: "video" });
                      }}
                    />
                  </label>
                  <LibraryPicker
                    kinds={["video"]}
                    buttonClassName={btn}
                    onPick={(m) => {
                      if (!bgvRef.current) return;
                      bgvRef.current.src = mediaUrl(m.id);
                      prepareAudio();
                      void bgvRef.current.play();
                      setHasBgVideo(true);
                      patch({ base: "video" });
                    }}
                  />
                  {hasBgVideo && (
                    <button
                      className={btn}
                      onClick={() =>
                        bgvRef.current?.paused
                          ? void bgvRef.current.play()
                          : bgvRef.current?.pause()
                      }
                    >
                      ⏯ Video
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">Düzen</span>
                  {LAYOUTS.map(([l, label]) => (
                    <button
                      key={l}
                      onClick={() => patch({ layout: l })}
                      className={`${btn} ${draft.layout === l ? on : ""}`}
                    >
                      {label}
                    </button>
                  ))}
                  {draft.layout === "pip" &&
                    CORNERS.map(([c, a]) => (
                      <button
                        key={c}
                        onClick={() => patch({ corner: c })}
                        aria-label={`Kamera köşesi ${a}`}
                        className={`${btn} ${draft.corner === c ? on : ""}`}
                      >
                        {a}
                      </button>
                    ))}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex w-full flex-wrap items-center gap-2">
                    <span className="font-semibold">Format</span>
                    {ASPECTS.map((a) => (
                      <button
                        key={a.id}
                        title={`${a.label}: ${a.hint}`}
                        disabled={recording}
                        onClick={() => chooseAspect(a.id)}
                        className={`${btn} ${aspect === a.id ? on : ""} disabled:opacity-50`}
                      >
                        {a.id}
                      </button>
                    ))}
                    <label className="ml-auto flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={hd}
                        disabled={recording}
                        onChange={(e) => setHd(e.target.checked)}
                      />
                      Full HD çıkış (daha ağır)
                    </label>
                  </div>
                  <details className="w-full rounded-lg border p-2" open>
                    <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Görüntü ayarları (parlaklık, kontrast, netlik…)
                    </summary>
                    <div className="mt-2">
                      <AdjustControls
                        filter={draft.filter}
                        fx={draft.fx}
                        onChange={(n) =>
                          setDraft((d) => {
                            const { fx: _old, ...rest } = d;
                            return {
                              ...rest,
                              filter: n.filter,
                              ...(hasFx(n.fx) ? { fx: n.fx } : {}),
                            };
                          })
                        }
                      />
                    </div>
                  </details>
                  <label className="flex items-center gap-2">
                    Çerçeve
                    <input
                      type="color"
                      value={draft.frame || "#f5c04a"}
                      onChange={(e) => patch({ frame: e.target.value })}
                      className="h-7 w-9 rounded bg-background"
                    />
                    <button
                      className={btn}
                      onClick={() => patch({ frame: "" })}
                    >
                      Yok
                    </button>
                  </label>
                  {draft.layout === "split" && (
                    <label className="flex items-center gap-2">
                      Arka plan
                      <input
                        type="color"
                        value={draft.bg[0]}
                        onChange={(e) =>
                          patch({ bg: [e.target.value, draft.bg[1]] })
                        }
                        className="h-7 w-9 rounded bg-background"
                      />
                      <input
                        type="color"
                        value={draft.bg[1]}
                        onChange={(e) =>
                          patch({ bg: [draft.bg[0], e.target.value] })
                        }
                        className="h-7 w-9 rounded bg-background"
                      />
                    </label>
                  )}
                </div>
              </>
            )}

            {tab === "items" && (
              <>
                <p className="font-semibold">Tıkla veya sahneye sürükle</p>
                <div className="flex flex-wrap gap-2">
                  {ITEM_TILES.map(([k, l]) => (
                    <div
                      key={k}
                      draggable
                      onDragStart={(e) =>
                        e.dataTransfer.setData("text/plain", k)
                      }
                      onClick={() => addPreset(k)}
                      className="cursor-grab rounded bg-accent px-2 py-1 hover:brightness-110"
                    >
                      {l}
                    </div>
                  ))}
                  <label className="cursor-pointer rounded bg-accent px-2 py-1 hover:brightness-110">
                    🖼 Logo ekle
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f)
                          addItem({
                            kind: "image",
                            src: URL.createObjectURL(f),
                            x: 10,
                            y: 12,
                            w: 14,
                          });
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
                <p className="text-xs text-muted-foreground">
                  Logoyu bilgisayardan doğrudan sahneye de bırakabilirsin.
                </p>
                {sel ? (
                  <div className="space-y-2 border-t pt-2">
                    {sel.kind !== "image" && (
                      <input
                        value={sel.text ?? ""}
                        onChange={(e) =>
                          updateItem(sel.id, { text: e.target.value })
                        }
                        aria-label="Metin"
                        className="w-full rounded bg-background px-2 py-1"
                      />
                    )}
                    {sel.kind === "lower" && (
                      <input
                        value={sel.sub ?? ""}
                        onChange={(e) =>
                          updateItem(sel.id, { sub: e.target.value })
                        }
                        aria-label="Alt satır"
                        className="w-full rounded bg-background px-2 py-1"
                      />
                    )}
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2">
                        Genişlik
                        <input
                          type="range"
                          min={5}
                          max={100}
                          value={sel.w}
                          onChange={(e) =>
                            updateItem(sel.id, { w: +e.target.value })
                          }
                        />
                      </label>
                      {sel.kind !== "image" && (
                        <label className="flex items-center gap-2">
                          Yazı
                          <input
                            type="range"
                            min={14}
                            max={80}
                            value={sel.size ?? 30}
                            onChange={(e) =>
                              updateItem(sel.id, { size: +e.target.value })
                            }
                          />
                        </label>
                      )}
                      {sel.kind !== "image" && sel.kind !== "subtitle" && (
                        <label className="flex items-center gap-2">
                          Renk
                          <input
                            type="color"
                            value={(sel.color ?? "#e0483c").slice(0, 7)}
                            onChange={(e) =>
                              updateItem(sel.id, { color: e.target.value })
                            }
                            className="h-7 w-9 rounded bg-background"
                          />
                        </label>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        className={btn}
                        onClick={() => moveLayer(sel.id, 1)}
                      >
                        ↑ Öne
                      </button>
                      <button
                        className={btn}
                        onClick={() => moveLayer(sel.id, -1)}
                      >
                        ↓ Arkaya
                      </button>
                      <button className={btn} onClick={() => duplicate(sel)}>
                        ⧉ Çoğalt
                      </button>
                      <button
                        onClick={() => removeItem(sel.id)}
                        className="rounded bg-destructive px-2 py-1 text-sm text-white"
                      >
                        Sil
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="border-t pt-2 text-xs text-muted-foreground">
                    {draft.items.length
                      ? "Düzenlemek için sahnedeki bir öğeye tıkla."
                      : "Henüz öğe yok."}
                  </p>
                )}
              </>
            )}
          </div>
        </section>

        {/* ============ LIVE (right) ============ */}
        <section
          className={`rounded-xl border bg-card p-3 ${pane === "live" ? "" : "hidden xl:block"}`}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-semibold text-primary">
              <span
                className={`inline-block size-3 rounded-full ${live ? "animate-pulse bg-red-700" : "bg-muted-foreground"}`}
              />
              {live ? "CANLI YAYIN" : "CANLI — henüz yayında değil"}
              {recording && (
                <span className="rounded bg-destructive px-2 py-0.5 text-xs text-white">
                  REC {mmss}
                </span>
              )}
            </h2>
            <button
              onClick={toggleRec}
              className={`rounded-md px-4 py-2 text-sm font-bold text-white ${recording ? "animate-pulse bg-destructive" : "bg-red-700"}`}
            >
              {recording ? "■ Kaydı bitir" : "● Kayda başla"}
            </button>
          </div>

          <div className="relative">
            <canvas
              ref={progCanvas}
              width={prog.w}
              height={prog.h}
              className="mx-auto block w-full rounded-lg bg-background"
              style={{
                aspectRatio: `${stage.w} / ${stage.h}`,
                width: `min(100%, ${(70 * ratio).toFixed(2)}vh)`,
              }}
            />
            {liveTick > 0 && (
              <div
                key={liveTick}
                className="go-live-ring pointer-events-none absolute inset-0 rounded-lg"
              />
            )}
            {!live && (
              <div className="absolute inset-0 grid place-items-center rounded-lg bg-background/80 text-center text-sm text-muted-foreground">
                Solda sahneni kur, sonra{" "}
                <b className="mx-1 text-speaker-b">Yayına al →</b> ile buraya
                aktar.
              </div>
            )}
          </div>

          <div className="mt-3 space-y-3 rounded-lg bg-secondary p-3 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 font-semibold">
                Geçiş
                <select
                  value={transition}
                  onChange={(e) => setTransition(e.target.value)}
                  className="rounded bg-background px-2 py-1 font-normal"
                >
                  <option value={NO_TRANSITION}>Anında (geçişsiz)</option>
                  {transitions.map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2">
                Süre {(transMs / 1000).toFixed(1)}s
                <input
                  type="range"
                  min={300}
                  max={2000}
                  step={100}
                  value={transMs}
                  onChange={(e) => setTransMs(+e.target.value)}
                />
              </label>
            </div>
            {available.length === 0 && (
              <p className="text-xs text-muted-foreground">
                WebGL geçişleri bu tarayıcıda kullanılamıyor; geçişsiz yayına
                alınır.
              </p>
            )}

            <div className="border-t pt-2">
              <p className="mb-2 font-semibold">
                Ses efektleri{" "}
                <span className="font-normal text-muted-foreground">
                  (klavyede 1–8)
                </span>
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {SFX_PRESETS.map((p, i) => (
                  <button
                    key={p.id}
                    onClick={() => void playPreset(p.id)}
                    className="rounded bg-speaker-a px-2 py-1 font-semibold text-background hover:brightness-110"
                  >
                    {i < 8 && <kbd className="mr-1 opacity-60">{i + 1}</kbd>}
                    {p.emoji} {p.label}
                  </button>
                ))}
                {uploads.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => {
                      prepareAudio();
                      mixer.playBuffer(u.buffer);
                    }}
                    className="rounded bg-speaker-b px-2 py-1 font-semibold text-background hover:brightness-110"
                  >
                    ▶ {u.label.slice(0, 14)}
                  </button>
                ))}
                <LibraryPicker
                  kinds={["audio"]}
                  buttonClassName={btn}
                  onPick={async (m) => {
                    const blob = await (await fetch(mediaUrl(m.id))).blob();
                    try {
                      const buffer = await mixer.decode(blob);
                      setUploads((u) => [
                        ...u,
                        { id: uid(), label: m.title.slice(0, 40), buffer },
                      ]);
                    } catch {
                      /* undecodable: ignore */
                    }
                  }}
                />
                <label className={`${btn} cursor-pointer`}>
                  + Kendi sesin
                  <input
                    type="file"
                    accept="audio/*"
                    multiple
                    className="hidden"
                    onChange={async (e) => {
                      const fs = Array.from(e.target.files ?? []);
                      e.target.value = "";
                      const added = await Promise.all(
                        fs.map(async (f) => {
                          try {
                            return {
                              id: uid(),
                              label: f.name.replace(/\.[^.]+$/, ""),
                              buffer: await mixer.decode(f),
                            };
                          } catch {
                            return null;
                          }
                        }),
                      );
                      setUploads((u) => [
                        ...u,
                        ...added.filter(
                          (a): a is NonNullable<typeof a> => a !== null,
                        ),
                      ]);
                    }}
                  />
                </label>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t pt-2">
              <label className={`${btn} cursor-pointer`}>
                🎵 Arka plan müziği
                <input
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f || !bgaRef.current) return;
                    bgaRef.current.src = URL.createObjectURL(f);
                    prepareAudio();
                    void bgaRef.current.play();
                    setBgAudioName(f.name);
                  }}
                />
              </label>
              <LibraryPicker
                kinds={["audio", "video"]}
                buttonClassName={btn}
                onPick={(m) => {
                  if (!bgaRef.current) return;
                  bgaRef.current.src = mediaUrl(m.id);
                  prepareAudio();
                  void bgaRef.current.play();
                  setBgAudioName(m.title);
                }}
              />
              {bgAudioName && (
                <button
                  className={btn}
                  onClick={() =>
                    bgaRef.current?.paused
                      ? void bgaRef.current.play()
                      : bgaRef.current?.pause()
                  }
                >
                  ⏯ {bgAudioName.slice(0, 20)}
                </button>
              )}
              <label className="flex items-center gap-2">
                Müzik sesi
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={bgVol}
                  onChange={(e) => setBgVol(+e.target.value)}
                />
              </label>
            </div>
          </div>
          <div className="mt-3 space-y-2 rounded-lg bg-secondary p-3 text-sm">
            <p className="font-semibold">
              🎧 Müzik listesi{" "}
              <span className="font-normal text-muted-foreground">
                (kodla üretilir, telifsiz)
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
              {TRACKS.map((t) => (
                <button
                  key={t.id}
                  onClick={() =>
                    trackId === t.id ? stopMusic() : playTrack(t.id)
                  }
                  title={t.mood}
                  className={`${btn} ${trackId === t.id ? on : ""}`}
                >
                  {trackId === t.id ? "■" : "♪"} {t.name}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 space-y-2 rounded-lg bg-secondary p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold">🎙 Ses iyileştirme</p>
              <span
                className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
                aria-live="polite"
              >
                <span
                  className={`inline-block size-2.5 rounded-full ${voice.enabled && voice.gate ? (meter.open ? "bg-speaker-b" : "bg-speaker-a") : "bg-muted-foreground"}`}
                />
                {voice.enabled && voice.gate
                  ? meter.open
                    ? "ses algılandı"
                    : "gürültü bastırılıyor"
                  : "kapı kapalı"}
              </span>
            </div>
            <div
              className="flex flex-wrap gap-1"
              role="group"
              aria-label="Ses ayarları"
            >
              {(
                [
                  ["off", "Kapalı"],
                  ["speech", "Konuşma"],
                  ["podcast", "Podcast"],
                  ["noisy", "Gürültülü ortam"],
                  ["nvidia", "✨ NVIDIA / AI mikrofon"],
                ] as [Exclude<VoicePreset, "custom">, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  aria-pressed={voice.preset === id}
                  onClick={() => setVoice((v) => applyVoicePreset(v, id))}
                  className={`${btn} ${voice.preset === id ? on : ""}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={voice.ai}
                onChange={(e) =>
                  setVoice((v) => ({
                    ...v,
                    ai: e.target.checked,
                    enabled: e.target.checked || v.enabled,
                  }))
                }
              />
              Yapay zeka gürültü bastırma (RNNoise)
              {voice.ai && (
                <span className="text-[11px] text-muted-foreground">
                  {voiceRef.current.aiState === "ready"
                    ? "· etkin"
                    : voiceRef.current.aiState === "error"
                      ? "· yüklenemedi"
                      : "· yükleniyor"}
                </span>
              )}
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={voice.ducking.enabled}
                onChange={(e) =>
                  setVoice((v) => ({
                    ...v,
                    ducking: { ...v.ducking, enabled: e.target.checked },
                  }))
                }
              />
              Konuşurken müziği kıs (ducking)
            </label>
            <p className="text-[11px] text-muted-foreground">
              Gürültü kapısı, EQ, sıkıştırıcı ve limiter mikrofon sesine
              uygulanır; ayarlar Stüdyo ile ortaktır.
            </p>
          </div>
          <RemotePanel className="mt-3" />
          <p className="mt-2 text-sm text-muted-foreground">
            Kayıt bu ekranı, mikrofonu, müziği ve ses efektlerini birlikte alır;
            bitince video bilgisayarına iner.
          </p>
        </section>
      </div>

      {/* mobile action bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-2 border-t bg-card/95 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur xl:hidden">
        <button
          onClick={() => stepScene(-1)}
          disabled={!rundown.length}
          aria-label="Önceki sahne"
          className="min-h-12 rounded-lg bg-secondary px-3 disabled:opacity-40"
        >
          ⏮
        </button>
        <button
          onClick={() => void goLive()}
          className={`min-h-12 flex-1 rounded-lg bg-speaker-b px-3 font-bold text-background ${dirty ? "animate-pulse" : "opacity-80"}`}
        >
          Yayına al →
        </button>
        <button
          onClick={() => stepScene(1)}
          disabled={!rundown.length}
          aria-label="Sonraki sahne"
          className="min-h-12 rounded-lg bg-secondary px-3 disabled:opacity-40"
        >
          ⏭
        </button>
        <button
          onClick={toggleRec}
          aria-label={recording ? "Kaydı bitir" : "Kayda başla"}
          className={`min-h-12 rounded-lg px-4 font-bold text-white ${recording ? "animate-pulse bg-destructive" : "bg-red-700"}`}
        >
          {recording ? "■" : "●"}
        </button>
      </div>
    </div>
  );
}
