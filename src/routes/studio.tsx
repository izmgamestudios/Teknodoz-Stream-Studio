import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/studio")({
  head: () => ({
    meta: [
      { title: "Stüdyo — PodPrompter" },
      { name: "description", content: "Taslak ve canlı bölümlü podcast stüdyosu: logo, yazı, altyazı, müzik ve efektlerle kayıt." },
      { property: "og:title", content: "Stüdyo — PodPrompter" },
      { property: "og:description", content: "Sürükle-bırak logo, banner, altyazı, arka plan video/müzik ve ses efektleriyle kayıt." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Studio,
});

type Item = {
  id: string;
  kind: "image" | "text" | "subtitle";
  x: number; y: number; w: number; // percent of stage
  src?: string; text?: string;
};
type Base = "camera" | "screen" | "video";
type Scene = { base: Base; pip: boolean; filter: string; items: Item[] };

const FILTERS: Record<string, string> = {
  Yok: "none", "Siyah-Beyaz": "grayscale(1)", Sepya: "sepia(0.8)",
  Kontrast: "contrast(1.4) saturate(1.3)", Sıcak: "sepia(0.3) saturate(1.5) hue-rotate(-10deg)",
  Soğuk: "saturate(1.2) hue-rotate(20deg) brightness(1.05)", Bulanık: "blur(4px)",
};
const W = 1280, H = 720;
const uid = () => Math.random().toString(36).slice(2, 9);

function Studio() {
  const camRef = useRef<HTMLVideoElement>(null);
  const scrRef = useRef<HTMLVideoElement>(null);
  const bgvRef = useRef<HTMLVideoElement>(null);
  const bgaRef = useRef<HTMLAudioElement>(null);
  const progCanvas = useRef<HTMLCanvasElement>(null);
  const camStream = useRef<MediaStream | null>(null);
  const scrStream = useRef<MediaStream | null>(null);
  const imgCache = useRef<Record<string, HTMLImageElement>>({});
  const audioCtx = useRef<AudioContext | null>(null);
  const mixDest = useRef<MediaStreamAudioDestinationNode | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);

  const [draft, setDraft] = useState<Scene>({ base: "camera", pip: true, filter: "none", items: [] });
  const [program, setProgram] = useState<Scene>(draft);
  const programRef = useRef(program);
  programRef.current = program;
  const [selected, setSelected] = useState<string | null>(null);
  const [hasScreen, setHasScreen] = useState(false);
  const [hasBgVideo, setHasBgVideo] = useState(false);
  const [bgAudioName, setBgAudioName] = useState("");
  const [bgVol, setBgVol] = useState(0.3);
  const [sfx, setSfx] = useState<{ name: string; url: string }[]>([]);
  const [recording, setRecording] = useState(false);
  const [camErr, setCamErr] = useState("");

  // camera
  useEffect(() => {
    navigator.mediaDevices?.getUserMedia({ video: { width: 1280, height: 720 }, audio: true })
      .then((s) => { camStream.current = s; if (camRef.current) camRef.current.srcObject = s; })
      .catch(() => setCamErr("Kameraya erişilemedi. İzinleri kontrol edin."));
    return () => {
      camStream.current?.getTracks().forEach((t) => t.stop());
      scrStream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // audio mixer (lazy, needs user gesture)
  function mixer() {
    if (!audioCtx.current) {
      const ctx = new AudioContext();
      audioCtx.current = ctx;
      mixDest.current = ctx.createMediaStreamDestination();
      if (camStream.current?.getAudioTracks().length)
        ctx.createMediaStreamSource(camStream.current).connect(mixDest.current);
      for (const el of [bgaRef.current, bgvRef.current]) {
        if (!el) continue;
        const src = ctx.createMediaElementSource(el);
        src.connect(mixDest.current); src.connect(ctx.destination);
      }
    }
    audioCtx.current.resume();
    return { ctx: audioCtx.current, dest: mixDest.current! };
  }

  // program canvas render loop
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const c = progCanvas.current;
      const ctx = c?.getContext("2d");
      if (c && ctx) {
        const sc = programRef.current;
        ctx.fillStyle = "#111"; ctx.fillRect(0, 0, W, H);
        const baseEl = sc.base === "screen" ? scrRef.current : sc.base === "video" ? bgvRef.current : camRef.current;
        ctx.filter = sc.filter;
        if (baseEl && baseEl.readyState >= 2) drawCover(ctx, baseEl, 0, 0, W, H, sc.base === "camera");
        ctx.filter = "none";
        const cv = camRef.current;
        if (sc.pip && sc.base !== "camera" && cv && cv.readyState >= 2) {
          ctx.save(); ctx.strokeStyle = "#f5c04a"; ctx.lineWidth = 6;
          drawCover(ctx, cv, W - 340, H - 210, 310, 180, true);
          ctx.strokeRect(W - 340, H - 210, 310, 180); ctx.restore();
        }
        for (const it of sc.items) drawItem(ctx, it, imgCache.current);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  async function shareScreen() {
    if (hasScreen) { scrStream.current?.getTracks().forEach((t) => t.stop()); setHasScreen(false); return; }
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      scrStream.current = s;
      if (scrRef.current) scrRef.current.srcObject = s;
      const vt = s.getVideoTracks()[0]; if (vt) vt.onended = () => setHasScreen(false);
      if (s.getAudioTracks().length) { const { ctx, dest } = mixer(); ctx.createMediaStreamSource(s).connect(dest); }
      setHasScreen(true);
      setDraft((d) => ({ ...d, base: "screen" }));
    } catch { /* cancelled */ }
  }

  function addItem(it: Omit<Item, "id">) {
    const n = { ...it, id: uid() };
    if (n.src && !imgCache.current[n.src]) { const im = new Image(); im.src = n.src; imgCache.current[n.src] = im; }
    setDraft((d) => ({ ...d, items: [...d.items, n] }));
    setSelected(n.id);
  }
  function updateItem(id: string, patch: Partial<Item>) {
    setDraft((d) => ({ ...d, items: d.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
  }

  function onStageDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100, y = ((e.clientY - r.top) / r.height) * 100;
    const f = e.dataTransfer.files?.[0];
    if (f?.type.startsWith("image/")) return addItem({ kind: "image", src: URL.createObjectURL(f), x, y, w: 20 });
    const t = e.dataTransfer.getData("text/plain");
    if (t === "__text") addItem({ kind: "text", text: "Yeni yazı", x, y, w: 30 });
    if (t === "__banner") addItem({ kind: "text", text: "🔴 CANLI · Podcast", x, y, w: 40 });
    if (t === "__sub") addItem({ kind: "subtitle", text: "Altyazı metni", x: 50, y: 88, w: 80 });
  }

  function startDrag(e: React.PointerEvent, it: Item) {
    e.stopPropagation(); setSelected(it.id);
    const stage = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
    const move = (ev: PointerEvent) => updateItem(it.id, {
      x: Math.min(100, Math.max(0, ((ev.clientX - stage.left) / stage.width) * 100)),
      y: Math.min(100, Math.max(0, ((ev.clientY - stage.top) / stage.height) * 100)),
    });
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }

  function playSfx(url: string) {
    const a = new Audio(url);
    const { ctx, dest } = mixer();
    const src = ctx.createMediaElementSource(a);
    src.connect(dest); src.connect(ctx.destination);
    a.play();
  }

  function toggleRec() {
    if (recording) { recRef.current?.stop(); return; }
    const { dest } = mixer();
    const stream = new MediaStream([...progCanvas.current!.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const chunks: Blob[] = [];
    const r = new MediaRecorder(stream);
    r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    r.onstop = () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob(chunks, { type: r.mimeType }));
      a.download = `studio-${Date.now()}.webm`; a.click(); setRecording(false);
    };
    r.start(); recRef.current = r; setRecording(true);
  }

  useEffect(() => { if (bgaRef.current) bgaRef.current.volume = bgVol; if (bgvRef.current) bgvRef.current.volume = bgVol; }, [bgVol]);

  const sel = draft.items.find((i) => i.id === selected);
  const baseSrc = draft.base;

  return (
    <div className="min-h-screen p-4">
      {/* hidden media sources */}
      <video ref={camRef} autoPlay muted playsInline className="hidden" />
      <video ref={scrRef} autoPlay muted playsInline className="hidden" />
      <video ref={bgvRef} loop playsInline crossOrigin="anonymous" className="hidden" />
      <audio ref={bgaRef} loop />

      <header className="mb-4 flex flex-wrap items-center gap-3">
        <Link to="/" className="rounded-md bg-secondary px-3 py-2 text-sm hover:bg-accent">← Prompter</Link>
        <h1 className="text-2xl font-bold">Stüdyo</h1>
        {camErr && <span className="text-sm text-destructive">{camErr}</span>}
      </header>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* DRAFT */}
        <section className="rounded-xl border bg-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold text-speaker-b">TASLAK</h2>
            <button onClick={() => setProgram(structuredClone(draft))}
              className="rounded-md bg-speaker-b px-4 py-2 text-sm font-bold text-background">Yayına al →</button>
          </div>
          <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-background"
            onDragOver={(e) => e.preventDefault()} onDrop={onStageDrop} onPointerDown={() => setSelected(null)}>
            <LivePreview base={baseSrc} cam={camRef} scr={scrRef} bgv={bgvRef} filter={draft.filter} />
            {draft.pip && baseSrc !== "camera" && (
              <div className="absolute bottom-[4%] right-[2%] h-[25%] w-[24%] border-2 border-speaker-a">
                <LivePreview base="camera" cam={camRef} scr={scrRef} bgv={bgvRef} filter="none" />
              </div>
            )}
            {draft.items.map((it) => (
              <div key={it.id} onPointerDown={(e) => startDrag(e, it)}
                className={`absolute -translate-x-1/2 -translate-y-1/2 cursor-move select-none ${selected === it.id ? "outline-2 outline-dashed outline-ring" : ""}`}
                style={{ left: `${it.x}%`, top: `${it.y}%`, width: `${it.w}%` }}>
                {it.kind === "image" ? <img src={it.src} draggable={false} className="w-full" alt="" />
                  : <div className={`text-center font-bold ${it.kind === "subtitle" ? "bg-overlay px-2 py-1 text-foreground" : "bg-primary px-2 py-1 text-primary-foreground"}`}
                      style={{ fontSize: "clamp(10px, 1.8vw, 26px)" }}>{it.text}</div>}
              </div>
            ))}
          </div>

          {/* toolbox */}
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="space-y-2 rounded-lg bg-secondary p-3 text-sm">
              <p className="font-semibold">Kaynak</p>
              <div className="flex flex-wrap gap-2">
                {(["camera", "screen", "video"] as Base[]).map((b) => (
                  <button key={b} onClick={() => setDraft((d) => ({ ...d, base: b }))}
                    className={`rounded px-2 py-1 ${draft.base === b ? "bg-speaker-a text-background" : "bg-accent"}`}>
                    {b === "camera" ? "Kamera" : b === "screen" ? "Ekran" : "Video"}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={shareScreen} className="rounded bg-accent px-2 py-1">{hasScreen ? "Ekranı kapat" : "🖥 Ekran paylaş"}</button>
                <label className="cursor-pointer rounded bg-accent px-2 py-1">🎞 Arka plan video
                  <input type="file" accept="video/*" className="hidden" onChange={(e) => {
                    const f = e.target.files?.[0]; if (!f || !bgvRef.current) return;
                    bgvRef.current.src = URL.createObjectURL(f); mixer(); bgvRef.current.play();
                    setHasBgVideo(true); setDraft((d) => ({ ...d, base: "video" }));
                  }} />
                </label>
                {hasBgVideo && <button className="rounded bg-accent px-2 py-1" onClick={() => bgvRef.current?.paused ? bgvRef.current.play() : bgvRef.current?.pause()}>⏯ Video</button>}
              </div>
              <label className="flex items-center gap-2"><input type="checkbox" checked={draft.pip} onChange={(e) => setDraft((d) => ({ ...d, pip: e.target.checked }))} /> Köşede kamera</label>
              <label className="block">Efekt
                <select value={draft.filter} onChange={(e) => setDraft((d) => ({ ...d, filter: e.target.value }))}
                  className="mt-1 w-full rounded bg-background px-2 py-1">
                  {Object.entries(FILTERS).map(([k, v]) => <option key={k} value={v}>{k}</option>)}
                </select>
              </label>
            </div>

            <div className="space-y-2 rounded-lg bg-secondary p-3 text-sm">
              <p className="font-semibold">Sürükle → taslağa bırak</p>
              <div className="flex flex-wrap gap-2">
                {([["__text", "T Yazı"], ["__banner", "▭ Banner"], ["__sub", "💬 Altyazı"]] as const).map(([k, l]) => (
                  <div key={k} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", k)}
                    className="cursor-grab rounded bg-accent px-2 py-1">{l}</div>
                ))}
                <label className="cursor-pointer rounded bg-accent px-2 py-1">🖼 Logo ekle
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                    const f = e.target.files?.[0]; if (f) addItem({ kind: "image", src: URL.createObjectURL(f), x: 12, y: 12, w: 15 });
                  }} />
                </label>
              </div>
              <p className="text-xs text-muted-foreground">Logo resmini bilgisayardan doğrudan taslağa da sürükleyebilirsin.</p>
              {sel && (
                <div className="space-y-2 border-t pt-2">
                  {sel.kind !== "image" && (
                    <input value={sel.text} onChange={(e) => updateItem(sel.id, { text: e.target.value })}
                      className="w-full rounded bg-background px-2 py-1" />
                  )}
                  <label className="flex items-center gap-2">Boyut
                    <input type="range" min={5} max={100} value={sel.w} onChange={(e) => updateItem(sel.id, { w: +e.target.value })} />
                  </label>
                  <button onClick={() => { setDraft((d) => ({ ...d, items: d.items.filter((i) => i.id !== sel.id) })); setSelected(null); }}
                    className="rounded bg-destructive px-2 py-1 text-primary-foreground">Sil</button>
                </div>
              )}
            </div>

            <div className="space-y-2 rounded-lg bg-secondary p-3 text-sm md:col-span-2">
              <p className="font-semibold">Ses</p>
              <div className="flex flex-wrap items-center gap-2">
                <label className="cursor-pointer rounded bg-accent px-2 py-1">🎵 Arka plan müziği
                  <input type="file" accept="audio/*" className="hidden" onChange={(e) => {
                    const f = e.target.files?.[0]; if (!f || !bgaRef.current) return;
                    bgaRef.current.src = URL.createObjectURL(f); mixer(); bgaRef.current.play(); setBgAudioName(f.name);
                  }} />
                </label>
                {bgAudioName && <button className="rounded bg-accent px-2 py-1" onClick={() => bgaRef.current?.paused ? bgaRef.current.play() : bgaRef.current?.pause()}>⏯ {bgAudioName.slice(0, 20)}</button>}
                <label className="flex items-center gap-2">Müzik sesi
                  <input type="range" min={0} max={1} step={0.05} value={bgVol} onChange={(e) => setBgVol(+e.target.value)} />
                </label>
                <label className="cursor-pointer rounded bg-accent px-2 py-1">+ Ses efekti
                  <input type="file" accept="audio/*" multiple className="hidden" onChange={(e) => {
                    const fs = Array.from(e.target.files ?? []);
                    setSfx((s) => [...s, ...fs.map((f) => ({ name: f.name.replace(/\.[^.]+$/, ""), url: URL.createObjectURL(f) }))]);
                  }} />
                </label>
                {sfx.map((s) => (
                  <button key={s.url} onClick={() => playSfx(s.url)} className="rounded bg-speaker-a px-2 py-1 font-semibold text-background">▶ {s.name.slice(0, 14)}</button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* PROGRAM */}
        <section className="rounded-xl border bg-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold text-primary">● CANLI / KAYIT</h2>
            <button onClick={toggleRec}
              className={`rounded-md px-4 py-2 text-sm font-bold text-primary-foreground ${recording ? "animate-pulse bg-destructive" : "bg-primary"}`}>
              {recording ? "■ Kaydı bitir" : "● Kayda başla"}
            </button>
          </div>
          <canvas ref={progCanvas} width={W} height={H} className="aspect-video w-full rounded-lg bg-background" />
          <p className="mt-2 text-sm text-muted-foreground">
            Taslakta düzenle, hazır olunca "Yayına al" ile buraya aktar. Kayıt bu ekranı, mikrofonu, müziği ve efekt seslerini birlikte alır; bitince video bilgisayarına iner.
          </p>
        </section>
      </div>
    </div>
  );
}

function LivePreview({ base, cam, scr, bgv, filter }: {
  base: Base; cam: React.RefObject<HTMLVideoElement | null>; scr: React.RefObject<HTMLVideoElement | null>;
  bgv: React.RefObject<HTMLVideoElement | null>; filter: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const c = ref.current, ctx = c?.getContext("2d");
      const el = base === "screen" ? scr.current : base === "video" ? bgv.current : cam.current;
      if (c && ctx) {
        ctx.fillStyle = "#111"; ctx.fillRect(0, 0, c.width, c.height);
        ctx.filter = filter;
        if (el && el.readyState >= 2) drawCover(ctx, el, 0, 0, c.width, c.height, base === "camera");
        ctx.filter = "none";
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [base, filter, cam, scr, bgv]);
  return <canvas ref={ref} width={640} height={360} className="pointer-events-none absolute inset-0 h-full w-full" />;
}

function drawCover(ctx: CanvasRenderingContext2D, el: HTMLVideoElement, x: number, y: number, w: number, h: number, mirror: boolean) {
  const vw = el.videoWidth || w, vh = el.videoHeight || h;
  const s = Math.max(w / vw, h / vh);
  const sw = w / s, sh = h / s;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  if (mirror) { ctx.translate(x + w, y); ctx.scale(-1, 1); ctx.drawImage(el, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, w, h); }
  else ctx.drawImage(el, (vw - sw) / 2, (vh - sh) / 2, sw, sh, x, y, w, h);
  ctx.restore();
}

function drawItem(ctx: CanvasRenderingContext2D, it: Item, cache: Record<string, HTMLImageElement>) {
  const cx = (it.x / 100) * W, cy = (it.y / 100) * H, w = (it.w / 100) * W;
  if (it.kind === "image" && it.src) {
    const im = cache[it.src];
    if (im?.complete && im.naturalWidth) {
      const h = (w * im.naturalHeight) / im.naturalWidth;
      ctx.drawImage(im, cx - w / 2, cy - h / 2, w, h);
    }
    return;
  }
  const fs = 30;
  ctx.font = `700 ${fs}px "Space Grotesk", sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const h = fs * 1.6;
  ctx.fillStyle = it.kind === "subtitle" ? "rgba(15,15,20,0.7)" : "#e0483c";
  ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
  ctx.fillStyle = "#fff";
  ctx.fillText(it.text ?? "", cx, cy, w - 16);
}
