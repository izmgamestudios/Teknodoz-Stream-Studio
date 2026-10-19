import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import {
  publishScript,
  readSharedScript,
  subscribeScript,
} from "@/studio/sync/shared";

import { Prompter, type Line } from "@/classic/components/prompter";
import { ClassicNav } from "@/classic/components/classic-nav";
import { RemotePanel } from "@/classic/components/remote-panel";

export const Route = createFileRoute("/classic/prompter")({
  head: () => ({
    meta: [
      { title: "Klasik Prompter — Teknodoz" },
      {
        name: "description",
        content:
          "Kamerayla çekerken A/B diyaloglarını ekranda okuyabileceğin podcast prompter uygulaması.",
      },
      {
        property: "og:title",
        content: "PodPrompter — Podcast Kamera Prompter",
      },
      {
        property: "og:description",
        content:
          "Word, metin dosyası veya yapıştırma ile diyalog yükle, kameraya bakarak oku.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

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
  const lastAt = useRef(0);
  const synced = useRef("");

  // script shared with the main Studio (and other tabs): load once, then follow both ways
  useEffect(() => {
    const m = readSharedScript();
    if (m && m.text.trim()) {
      lastAt.current = m.at;
      synced.current = m.text;
      setRaw(m.text);
    }
    return subscribeScript((msg) => {
      if (msg.at <= lastAt.current || msg.text === synced.current) return;
      lastAt.current = msg.at;
      synced.current = msg.text;
      setRaw(msg.text);
    });
  }, []);
  useEffect(() => {
    if (raw === synced.current || raw === SAMPLE) return;
    const id = setTimeout(() => {
      synced.current = raw;
      lastAt.current = Date.now();
      publishScript(raw, "classic", lastAt.current);
    }, 400);
    return () => clearTimeout(id);
  }, [raw]);
  const [nameA, setNameA] = useState("A");
  const [nameB, setNameB] = useState("B");
  const [mode, setMode] = useState<"edit" | "prompt">("edit");
  const [err, setErr] = useState("");

  async function onFile(f: File) {
    setErr("");
    try {
      if (f.name.toLowerCase().endsWith(".docx")) {
        const mammoth = await import("mammoth");
        const res = await mammoth.extractRawText({
          arrayBuffer: await f.arrayBuffer(),
        });
        setRaw(res.value);
      } else {
        setRaw(await f.text());
      }
    } catch {
      setErr("Dosya okunamadı. .docx veya .txt dosyası deneyin.");
    }
  }

  const lines = parse(raw);
  const words = raw.split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(words / 150)); // ~150 words/min spoken

  if (mode === "prompt")
    return (
      <Prompter
        lines={lines}
        nameA={nameA}
        nameB={nameB}
        onExit={() => setMode("edit")}
      />
    );

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 pb-28 sm:px-5 sm:py-10 md:pb-10">
      <ClassicNav className="mb-4" />
      <header className="mb-8">
        <p className="text-sm uppercase tracking-[0.3em] text-speaker-a">
          PodPrompter
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">
          Podcast kamera prompter
        </h1>
        <p className="mt-2 text-muted-foreground">
          Diyaloğu yapıştır veya Word / metin dosyası yükle. Satırları <b>A:</b>{" "}
          ve <b>B:</b> ile başlat (başlatmazsan sırayla dağıtılır).
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-[1fr_320px]">
        <section className="rounded-xl border bg-card p-4">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <label className="cursor-pointer rounded-md bg-secondary px-3 py-2 text-sm hover:bg-accent">
              Dosya yükle (.docx / .txt)
              <input
                type="file"
                accept=".docx,.txt,.md,text/plain"
                className="hidden"
                onChange={(e) =>
                  e.target.files?.[0] && onFile(e.target.files[0])
                }
              />
            </label>
            <button
              onClick={() => setRaw("")}
              className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
            >
              Temizle
            </button>
            {err && <span className="text-sm text-destructive">{err}</span>}
          </div>
          <p className="mb-2 text-xs text-speaker-b">
            ↔ Bu metin ana Stüdyo'nun prompter metniyle otomatik senkron.
          </p>
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            className="h-[45vh] min-h-64 w-full resize-y md:h-[420px] rounded-md border bg-background p-3 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
            placeholder="A: Merhaba...&#10;B: Selam..."
          />
        </section>

        <aside className="space-y-4">
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <h2 className="font-semibold">Konuşmacılar</h2>
            <label className="block text-sm text-speaker-a">
              A kişisi (solda)
              <input
                value={nameA}
                onChange={(e) => setNameA(e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-foreground"
              />
            </label>
            <label className="block text-sm text-speaker-b">
              B kişisi (sağda)
              <input
                value={nameB}
                onChange={(e) => setNameB(e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-foreground"
              />
            </label>
          </div>
          <div className="rounded-xl border bg-card p-4 max-h-60 overflow-auto space-y-2 text-sm">
            <h2 className="font-semibold">
              Önizleme · {lines.length} replik · {words} kelime · ~{minutes} dk
            </h2>
            {lines.slice(0, 8).map((l, i) => (
              <p
                key={i}
                className={
                  l.speaker === "A"
                    ? "text-speaker-a"
                    : "text-right text-speaker-b"
                }
              >
                {l.text}
              </p>
            ))}
          </div>
          <RemotePanel />
          <Link
            to="/classic"
            className="block w-full rounded-xl border border-speaker-b py-3 text-center font-bold text-speaker-b hover:bg-accent"
          >
            🎬 Klasik stüdyoyu aç (düzenle / canlı)
          </Link>
          <button
            disabled={!lines.length}
            onClick={() => setMode("prompt")}
            className="w-full rounded-xl bg-red-700 py-4 text-lg font-bold text-white hover:opacity-90 disabled:opacity-40"
          >
            ● Kamerayı aç ve başla
          </button>
        </aside>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden">
        <button
          disabled={!lines.length}
          onClick={() => setMode("prompt")}
          className="min-h-12 w-full rounded-xl bg-red-700 text-lg font-bold text-white disabled:opacity-40"
        >
          ● Kamerayı aç ve başla
        </button>
      </div>
    </div>
  );
}
