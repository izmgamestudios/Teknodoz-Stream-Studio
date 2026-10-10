import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PodPrompter — Podcast Kamera Prompter" },
      { name: "description", content: "Kamerayla çekerken A/B diyaloglarını ekranda okuyabileceğin podcast prompter uygulaması." },
      { property: "og:title", content: "PodPrompter — Podcast Kamera Prompter" },
      { property: "og:description", content: "Word, metin dosyası veya yapıştırma ile diyalog yükle, kameraya bakarak oku." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Line = { speaker: "A" | "B"; text: string };

const SAMPLE = `A: Herkese merhaba, podcastimize hoş geldiniz!
B: Merhaba! Bugün çok güzel bir konumuz var.
A: Evet, bugün oyun geliştirmeyi konuşacağız.
B: O zaman hemen başlayalım.`;

function parse(raw: string): Line[] {
  const out: Line[] = [];
  let next: "A" | "B" = "A";
  for (const l of raw.split(/\r?\n/)) {
    const t = l.trim();
    if (!t) continue;
    const m = t.match(/^([AaBb])\s*[:\-–)]\s*(.*)$/);
    if (m) {
      const s = (m[1] ?? "A").toUpperCase() as "A" | "B";
      out.push({ speaker: s, text: m[2] ?? "" });
      next = s === "A" ? "B" : "A";
    } else {
      out.push({ speaker: next, text: t });
      next = next === "A" ? "B" : "A";
    }
  }
  return out;
}

function Index() {
  const [raw, setRaw] = useState(SAMPLE);
  const [nameA, setNameA] = useState("A");
  const [nameB, setNameB] = useState("B");
  const [mode, setMode] = useState<"edit" | "prompt">("edit");
  const [err, setErr] = useState("");

  async function onFile(f: File) {
    setErr("");
    try {
      if (f.name.toLowerCase().endsWith(".docx")) {
        const mammoth = await import("mammoth");
        const res = await mammoth.extractRawText({ arrayBuffer: await f.arrayBuffer() });
        setRaw(res.value);
      } else {
        setRaw(await f.text());
      }
    } catch {
      setErr("Dosya okunamadı. .docx veya .txt dosyası deneyin.");
    }
  }

  const lines = parse(raw);

  if (mode === "prompt")
    return <Prompter lines={lines} nameA={nameA} nameB={nameB} onExit={() => setMode("edit")} />;

  return (
    <main className="mx-auto max-w-5xl px-5 py-10">
      <header className="mb-8">
        <p className="text-sm uppercase tracking-[0.3em] text-speaker-a">PodPrompter</p>
        <h1 className="mt-2 text-4xl font-bold">Podcast kamera prompter</h1>
        <p className="mt-2 text-muted-foreground">
          Diyaloğu yapıştır veya Word / metin dosyası yükle. Satırları <b>A:</b> ve <b>B:</b> ile başlat (başlatmazsan sırayla dağıtılır).
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-[1fr_320px]">
        <section className="rounded-xl border bg-card p-4">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <label className="cursor-pointer rounded-md bg-secondary px-3 py-2 text-sm hover:bg-accent">
              Dosya yükle (.docx / .txt)
              <input type="file" accept=".docx,.txt,.md,text/plain" className="hidden"
                onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            </label>
            <button onClick={() => setRaw("")} className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent">Temizle</button>
            {err && <span className="text-sm text-destructive">{err}</span>}
          </div>
          <textarea value={raw} onChange={(e) => setRaw(e.target.value)}
            className="h-[420px] w-full resize-y rounded-md border bg-background p-3 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
            placeholder="A: Merhaba...&#10;B: Selam..." />
        </section>

        <aside className="space-y-4">
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <h2 className="font-semibold">Konuşmacılar</h2>
            <label className="block text-sm text-speaker-a">A kişisi (solda)
              <input value={nameA} onChange={(e) => setNameA(e.target.value)} className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-foreground" />
            </label>
            <label className="block text-sm text-speaker-b">B kişisi (sağda)
              <input value={nameB} onChange={(e) => setNameB(e.target.value)} className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-foreground" />
            </label>
          </div>
          <div className="rounded-xl border bg-card p-4 max-h-60 overflow-auto space-y-2 text-sm">
            <h2 className="font-semibold">Önizleme · {lines.length} replik</h2>
            {lines.slice(0, 8).map((l, i) => (
              <p key={i} className={l.speaker === "A" ? "text-speaker-a" : "text-right text-speaker-b"}>{l.text}</p>
            ))}
          </div>
          <Link to="/studio" className="block w-full rounded-xl border border-speaker-b py-3 text-center font-bold text-speaker-b hover:bg-accent">
            🎬 Stüdyoyu aç (logo, müzik, efekt)
          </Link>
          <button disabled={!lines.length} onClick={() => setMode("prompt")}
            className="w-full rounded-xl bg-primary py-4 text-lg font-bold text-primary-foreground hover:opacity-90 disabled:opacity-40">
            ● Kamerayı aç ve başla
          </button>
        </aside>
      </div>
    </main>
  );
}

function Prompter({ lines, nameA, nameB, onExit }: { lines: Line[]; nameA: string; nameB: string; onExit: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const [camErr, setCamErr] = useState("");
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(40);
  const [font, setFont] = useState(36);
  const [mirror, setMirror] = useState(true);
  const [recording, setRecording] = useState(false);
  const screenRef = useRef<HTMLVideoElement>(null);
  const screenStream = useRef<MediaStream | null>(null);
  const [sharing, setSharing] = useState(false);

  async function toggleShare() {
    if (sharing) {
      screenStream.current?.getTracks().forEach((t) => t.stop());
      screenStream.current = null; setSharing(false); return;
    }
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      screenStream.current = s;
      const vt = s.getVideoTracks()[0]; if (vt) vt.onended = () => { screenStream.current = null; setSharing(false); };
      setSharing(true);
      setTimeout(() => { if (screenRef.current) screenRef.current.srcObject = s; });
    } catch { /* user cancelled */ }
  }

  useEffect(() => {
    navigator.mediaDevices
      ?.getUserMedia({ video: { width: 1280, height: 720 }, audio: true })
      .then((s) => {
        streamRef.current = s;
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch(() => setCamErr("Kameraya erişilemedi. Tarayıcı izinlerini kontrol edin."));
    return () => streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now(), acc = 0;
    const tick = (now: number) => {
      const el = scrollRef.current;
      if (el) {
        acc += ((now - last) / 1000) * speed;
        const px = Math.floor(acc);
        if (px) { el.scrollTop += px; acc -= px; }
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) setPlaying(false);
      }
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.code === "Space") { e.preventDefault(); setPlaying((p) => !p); }
      if (e.key === "ArrowUp") setSpeed((s) => Math.min(300, s + 10));
      if (e.key === "ArrowDown") setSpeed((s) => Math.max(0, s - 10));
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onExit]);

  function toggleRec() {
    if (recording) { recRef.current?.stop(); return; }
    if (!streamRef.current) return;
    const chunks: Blob[] = [];
    let recStream: MediaStream = streamRef.current;
    if (screenStream.current) {
      // compose screen + camera bubble on a canvas
      const c = document.createElement("canvas");
      c.width = 1920; c.height = 1080;
      const ctx = c.getContext("2d")!;
      const draw = () => {
        if (screenRef.current) ctx.drawImage(screenRef.current, 0, 0, 1920, 1080);
        if (videoRef.current) ctx.drawImage(videoRef.current, 1920 - 500, 1080 - 300, 460, 260);
        if (recRef.current?.state === "recording") requestAnimationFrame(draw);
      };
      recStream = new MediaStream([
        ...c.captureStream(30).getVideoTracks(),
        ...streamRef.current.getAudioTracks(),
      ]);
      setTimeout(draw, 50);
    }
    const r = new MediaRecorder(recStream);
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = () => {
      const url = URL.createObjectURL(new Blob(chunks, { type: r.mimeType }));
      const a = document.createElement("a");
      a.href = url; a.download = `podcast-${Date.now()}.webm`; a.click();
      setRecording(false);
    };
    r.start(); recRef.current = r; setRecording(true);
  }

  return (
    <div className="fixed inset-0 z-50 bg-background">
      <video ref={videoRef} autoPlay muted playsInline
        className="absolute inset-0 h-full w-full object-cover"
        style={{ transform: mirror ? "scaleX(-1)" : undefined }} />
      {sharing && (
        <>
          <video ref={screenRef} autoPlay muted playsInline className="absolute inset-0 h-full w-full bg-background object-contain" />
          <div className="absolute bottom-20 right-4 z-30 h-36 w-64 overflow-hidden rounded-xl border-2 border-speaker-a">
            <video autoPlay muted playsInline className="h-full w-full object-cover" style={{ transform: mirror ? "scaleX(-1)" : undefined }}
              ref={(el) => { if (el && streamRef.current && el.srcObject !== streamRef.current) el.srcObject = streamRef.current; }} />
          </div>
        </>
      )}
      <div className="absolute inset-0 bg-overlay" />
      {camErr && <p className="absolute left-1/2 top-4 -translate-x-1/2 rounded-md bg-destructive px-4 py-2 text-sm">{camErr}</p>}

      {/* reading guide */}
      <div className="pointer-events-none absolute inset-x-0 top-[30%] z-10 h-px bg-ring/60" />

      <div ref={scrollRef} className="absolute inset-0 overflow-y-auto px-6 md:px-16 [scrollbar-width:none]"
        style={{ paddingTop: "30vh", paddingBottom: "70vh" }}>
        <div className="mx-auto max-w-6xl space-y-8">
          {lines.map((l, i) => (
            <div key={i} className={`flex ${l.speaker === "A" ? "justify-start" : "justify-end"}`}>
              <div className={`max-w-[75%] ${l.speaker === "A" ? "text-left" : "text-right"}`}>
                <p className={`mb-1 text-sm font-bold uppercase tracking-widest ${l.speaker === "A" ? "text-speaker-a" : "text-speaker-b"}`}>
                  {l.speaker === "A" ? nameA : nameB}
                </p>
                <p className={`font-medium leading-snug ${l.speaker === "A" ? "text-speaker-a" : "text-speaker-b"}`}
                  style={{ fontSize: font, textShadow: "0 2px 8px oklch(0 0 0 / 80%)" }}>
                  {l.text}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 z-20 flex flex-wrap items-center justify-center gap-3 bg-card/90 p-3 text-sm backdrop-blur">
        <button onClick={onExit} className="rounded-md bg-secondary px-3 py-2 hover:bg-accent">← Metin</button>
        <button onClick={() => setPlaying((p) => !p)} className="min-w-28 rounded-md bg-speaker-a px-4 py-2 font-bold text-background">
          {playing ? "❚❚ Durdur" : "▶ Kaydır"}
        </button>
        <button onClick={() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }} className="rounded-md bg-secondary px-3 py-2 hover:bg-accent">Başa dön</button>
        <label className="flex items-center gap-2">Hız
          <input type="range" min={0} max={300} value={speed} onChange={(e) => setSpeed(+e.target.value)} />
        </label>
        <label className="flex items-center gap-2">Yazı
          <input type="range" min={20} max={80} value={font} onChange={(e) => setFont(+e.target.value)} />
        </label>
        <button onClick={() => setMirror((m) => !m)} className="rounded-md bg-secondary px-3 py-2 hover:bg-accent">Ayna: {mirror ? "Açık" : "Kapalı"}</button>
        <button onClick={toggleShare} className="rounded-md bg-secondary px-3 py-2 hover:bg-accent">{sharing ? "Ekranı kapat" : "🖥 Ekran paylaş"}</button>
        <button onClick={toggleRec} disabled={!!camErr}
          className={`rounded-md px-4 py-2 font-bold ${recording ? "bg-destructive animate-pulse" : "bg-primary"} text-primary-foreground disabled:opacity-40`}>
          {recording ? "■ Kaydı bitir" : "● Kaydet"}
        </button>
        <span className="hidden text-muted-foreground lg:inline">Boşluk: oynat · ↑↓: hız · Esc: çık</span>
      </div>
    </div>
  );
}
