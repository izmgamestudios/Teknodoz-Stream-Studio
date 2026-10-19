import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { drawScene, itemBoxPct } from "@/lib/studio/render";
import { buildSfxBuffer, SFX_PRESETS } from "@/lib/studio/sfx";
import { ITEM_PRESETS, TEMPLATES } from "@/lib/studio/templates";
import {
  createTransitionEngine,
  NO_TRANSITION,
  TRANSITION_LIST,
  type TransitionEngine,
} from "@/lib/studio/transitions";
import {
  type Base,
  type Corner,
  emptyScene,
  FILTERS,
  H,
  type Item,
  type Layout,
  type Scene,
  type Sources,
  uid,
  W,
} from "@/lib/studio/types";
import { useAudioMixer } from "@/lib/studio/use-audio-mixer";

export const Route = createFileRoute("/studio")({
  head: () => ({
    meta: [
      { title: "Stüdyo — PodPrompter" },
      {
        name: "description",
        content:
          "Solda düzenle, sağda canlı yayını izle: şablonlar, geçiş efektleri, ses efektleri ve kayıt.",
      },
      { property: "og:title", content: "Stüdyo — PodPrompter" },
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

const DRAFT_W = 960;
const DRAFT_H = 540;
const TPL_KEY = "studio.templates.v1";
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
];
const ITEM_TILES: [string, string][] = [
  ["text", "T Yazı"],
  ["banner", "▭ Banner"],
  ["sub", "💬 Altyazı"],
  ["lower", "▤ Alt bant"],
  ["badge", "● Rozet"],
  ["ticker", "➡ Kayan yazı"],
];

type SavedTemplate = { id: string; name: string; scene: Scene };
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
  const [transition, setTransition] = useState("fade");
  const [transMs, setTransMs] = useState(900);
  const [available, setAvailable] = useState<string[]>([]);
  const [sfxOnLive, setSfxOnLive] = useState(true);
  const [confettiOnLive, setConfettiOnLive] = useState(false);
  const [liveTick, setLiveTick] = useState(0);
  const [live, setLive] = useState(false);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(program),
    [draft, program],
  );
  const sel = draft.items.find((i) => i.id === selected);

  // saved templates + WebGL transition engine (client only)
  useEffect(() => {
    setSaved(loadSaved());
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
    mixer.connectStream(camStream.current);
    mixer.connectElement(bgaRef.current);
    mixer.connectElement(bgvRef.current);
  }, [mixer]);

  // one render loop: draft preview + live program (with WebGL transition)
  useEffect(() => {
    const fromC = document.createElement("canvas");
    const toC = document.createElement("canvas");
    fromC.width = toC.width = W;
    fromC.height = toC.height = H;
    let raf = 0;
    const loop = () => {
      const t = performance.now() / 1000;
      const src: Sources = {
        cam: camRef.current,
        scr: scrRef.current,
        bgv: bgvRef.current,
        images: images.current,
      };

      const dctx = draftCanvas.current?.getContext("2d");
      if (dctx) drawScene(dctx, draftRef.current, src, t, DRAFT_W, DRAFT_H);

      const pctx = progCanvas.current?.getContext("2d");
      if (pctx) {
        const tr = transRef.current;
        const eng = engineRef.current;
        const p = tr ? (performance.now() - tr.start) / tr.dur : 1;
        if (tr && p < 1 && eng) {
          const f = fromC.getContext("2d")!,
            g = toC.getContext("2d")!;
          drawScene(f, tr.from, src, t, W, H);
          drawScene(g, tr.to, src, t, W, H);
          if (eng.render(tr.name, fromC, toC, ease(p)))
            pctx.drawImage(eng.canvas, 0, 0, W, H);
          else {
            pctx.globalAlpha = 1;
            pctx.drawImage(fromC, 0, 0);
            pctx.globalAlpha = ease(p);
            pctx.drawImage(toC, 0, 0);
            pctx.globalAlpha = 1;
          }
        } else {
          transRef.current = null;
          drawScene(pctx, programRef.current, src, t, W, H);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // recording timer
  useEffect(() => {
    if (!recording) return;
    setRecSecs(0);
    const id = setInterval(() => setRecSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

  useEffect(() => {
    if (bgaRef.current) bgaRef.current.volume = bgVol;
    if (bgvRef.current) bgvRef.current.volume = bgVol;
  }, [bgVol]);

  // ---------- scene editing ----------
  const patch = (p: Partial<Scene>) => setDraft((d) => ({ ...d, ...p }));

  function applyTemplate(scene: Scene) {
    setDraft((d) => ({
      ...scene,
      items: [...d.items.filter((i) => i.kind === "image"), ...scene.items],
    }));
    setSelected(null);
  }

  function saveTemplate() {
    const name = window.prompt("Şablon adı?");
    if (!name?.trim()) return;
    const scene: Scene = {
      ...structuredClone(draft),
      items: draft.items
        .filter((i) => i.kind !== "image")
        .map((i) => ({ ...i, id: uid() })),
    };
    const next = [...saved, { id: uid(), name: name.trim(), scene }];
    setSaved(next);
    persistSaved(next);
  }
  function deleteSaved(id: string) {
    const next = saved.filter((s) => s.id !== id);
    setSaved(next);
    persistSaved(next);
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
      buf = await buildSfxBuffer(mixer.ensure().ctx, preset);
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
      if (n >= 1 && n <= SFX_PRESETS.length)
        void playPresetRef.current(SFX_PRESETS[n - 1]!.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  // ---------- go live / record ----------
  async function goLive() {
    const next = structuredClone(draft);
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
      if (sfxOnLive) void playPreset("whoosh");
    } else {
      transRef.current = null;
      if (sfxOnLive && hadProgram) void playPreset("pop");
    }
    programRef.current = next;
    setProgram(next);
    setLive(true);
    setLiveTick((n) => n + 1);
    if (confettiOnLive) {
      const { default: confetti } = await import("canvas-confetti");
      void confetti({ particleCount: 90, spread: 75, origin: { y: 0.65 } });
    }
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
  const transitions = TRANSITION_LIST.filter(([id]) => available.includes(id));
  const btn = "rounded bg-accent px-2 py-1 text-sm hover:brightness-110";
  const on = "bg-speaker-a text-background";

  return (
    <div className="min-h-screen p-4">
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
      <audio ref={bgaRef} loop />

      <header className="mb-4 flex flex-wrap items-center gap-3">
        <Link
          to="/"
          className="rounded-md bg-secondary px-3 py-2 text-sm hover:bg-accent"
        >
          ← Prompter
        </Link>
        <h1 className="text-2xl font-bold">Stüdyo</h1>
        {camErr && <span className="text-sm text-destructive">{camErr}</span>}
      </header>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* ============ EDIT (left) ============ */}
        <section className="rounded-xl border bg-card p-3">
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
            className="relative aspect-video w-full overflow-hidden rounded-lg bg-background"
            onDragOver={(e) => e.preventDefault()}
            onDrop={onStageDrop}
            onPointerDown={() => setSelected(null)}
          >
            <canvas
              ref={draftCanvas}
              width={DRAFT_W}
              height={DRAFT_H}
              className="pointer-events-none absolute inset-0 h-full w-full"
            />
            {draft.items.map((it) => {
              const b = itemBoxPct(it, images.current);
              return (
                <div
                  key={it.id}
                  onPointerDown={(e) => startDrag(e, it)}
                  className={`absolute cursor-move select-none ${selected === it.id ? "outline-2 outline-dashed outline-ring" : "hover:outline hover:outline-1 hover:outline-ring/50"}`}
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
                      onClick={() => applyTemplate(t.build())}
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
                <div className="flex flex-wrap items-center gap-2 border-t pt-2">
                  <button onClick={saveTemplate} className={btn}>
                    💾 Şablon olarak kaydet
                  </button>
                  {saved.map((s) => (
                    <span
                      key={s.id}
                      className="inline-flex overflow-hidden rounded bg-accent"
                    >
                      <button
                        onClick={() => applyTemplate(structuredClone(s.scene))}
                        className="px-2 py-1 hover:brightness-125"
                      >
                        ★ {s.name}
                      </button>
                      <button
                        onClick={() => deleteSaved(s.id)}
                        aria-label={`${s.name} şablonunu sil`}
                        className="px-1.5 hover:bg-destructive"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Şablon seçince eklediğin logolar korunur. Kayıtlı şablonlar bu
                  tarayıcıda saklanır.
                </p>
              </>
            )}

            {tab === "source" && (
              <>
                <div className="flex flex-wrap gap-2">
                  {SOURCES.map(([b, l]) => (
                    <button
                      key={b}
                      onClick={() => patch({ base: b })}
                      className={`${btn} ${draft.base === b ? on : ""}`}
                    >
                      {l}
                    </button>
                  ))}
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
                  <label className="flex items-center gap-2">
                    Görüntü efekti
                    <select
                      value={draft.filter}
                      onChange={(e) => patch({ filter: e.target.value })}
                      className="rounded bg-background px-2 py-1"
                    >
                      {Object.entries(FILTERS).map(([k, v]) => (
                        <option key={k} value={v}>
                          {k}
                        </option>
                      ))}
                    </select>
                  </label>
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
                        className="rounded bg-destructive px-2 py-1 text-sm text-primary-foreground"
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
        <section className="rounded-xl border bg-card p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-semibold text-primary">
              <span
                className={`inline-block size-3 rounded-full ${live ? "animate-pulse bg-primary" : "bg-muted-foreground"}`}
              />
              {live ? "CANLI YAYIN" : "CANLI — henüz yayında değil"}
              {recording && (
                <span className="rounded bg-destructive px-2 py-0.5 text-xs text-primary-foreground">
                  REC {mmss}
                </span>
              )}
            </h2>
            <button
              onClick={toggleRec}
              className={`rounded-md px-4 py-2 text-sm font-bold text-primary-foreground ${recording ? "animate-pulse bg-destructive" : "bg-primary"}`}
            >
              {recording ? "■ Kaydı bitir" : "● Kayda başla"}
            </button>
          </div>

          <div className="relative">
            <canvas
              ref={progCanvas}
              width={W}
              height={H}
              className="aspect-video w-full rounded-lg bg-background"
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
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={sfxOnLive}
                  onChange={(e) => setSfxOnLive(e.target.checked)}
                />{" "}
                Geçiş sesi
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={confettiOnLive}
                  onChange={(e) => setConfettiOnLive(e.target.checked)}
                />{" "}
                🎉 Konfeti
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
                  (klavyede 1–{SFX_PRESETS.length})
                </span>
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {SFX_PRESETS.map((p, i) => (
                  <button
                    key={p.id}
                    onClick={() => void playPreset(p.id)}
                    className="rounded bg-speaker-a px-2 py-1 font-semibold text-background hover:brightness-110"
                  >
                    <kbd className="mr-1 opacity-60">{i + 1}</kbd>
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
          <p className="mt-2 text-sm text-muted-foreground">
            Kayıt bu ekranı, mikrofonu, müziği ve ses efektlerini birlikte alır;
            bitince video bilgisayarına iner. Konfeti yalnızca ekranda görünür,
            kayda girmez.
          </p>
        </section>
      </div>
    </div>
  );
}
