// src/studio/ui/layer-panel.tsx
// Photoshop/OBS-style layer list: top row = front. Drag rows to reorder.
import { useRef, useState } from "react";

import { getActiveScene } from "../project/store";
import { useProject, useStudio } from "../runtime/use-studio";
import {
  addLayerOfKind,
  importFiles,
  LAYER_ICON,
  LAYER_KIND_LABEL,
  type NewLayerKind,
} from "./actions";
import { BTN, PANEL, PanelTitle } from "./fields";

const ADD_KINDS: NewLayerKind[] = [
  "webcam",
  "screen",
  "web",
  "text",
  "shape",
  "prompter",
];

export function LayerPanel({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const rt = useStudio();
  const project = useProject();
  const scene = getActiveScene(project);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [notice, setNotice] = useState("");

  // rows are shown front-first; map display index -> array index
  const rows = scene.layers.map((l, i) => ({ l, i })).reverse();

  return (
    <section className={PANEL} aria-label="Katmanlar">
      <PanelTitle>Katmanlar</PanelTitle>
      <div className="mb-2 flex flex-wrap gap-1.5">
        <select
          className="rounded-md border bg-background px-2 py-1.5 text-xs"
          value=""
          aria-label="Katman ekle"
          onChange={(e) => {
            const k = e.target.value as NewLayerKind;
            if (k) onSelect(addLayerOfKind(rt, k));
          }}
        >
          <option value="">+ Katman ekle…</option>
          {ADD_KINDS.map((k) => (
            <option key={k} value={k}>
              {LAYER_ICON[k]} {LAYER_KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <button className={BTN} onClick={() => fileRef.current?.click()}>
          🖼 Görsel / video
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            const r = await importFiles(rt, files, true);
            if (r.lastLayerId) onSelect(r.lastLayerId);
            setNotice(
              r.rejected.length ? `Eklenemedi: ${r.rejected.join(", ")}` : "",
            );
          }}
        />
      </div>
      {notice && <p className="mb-2 text-xs text-destructive">{notice}</p>}

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
          Bu sahne boş. Kamera, ekran, görsel veya yazı ekleyin.
        </p>
      ) : (
        <ul className="space-y-1" onDragLeave={() => setOverIdx(null)}>
          {rows.map(({ l, i }) => (
            <li
              key={l.id}
              draggable
              onDragStart={(e) => {
                setDragFrom(i);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("application/x-tkz-layer", String(i));
              }}
              onDragOver={(e) => {
                if (dragFrom === null) return;
                e.preventDefault();
                setOverIdx(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom !== null && dragFrom !== i)
                  rt.project.reorderLayer(scene.id, dragFrom, i);
                setDragFrom(null);
                setOverIdx(null);
              }}
              onDragEnd={() => {
                setDragFrom(null);
                setOverIdx(null);
              }}
              className={`flex items-center gap-1 rounded-md border px-1.5 py-1 text-xs ${
                l.id === selectedId
                  ? "border-speaker-b/60 bg-speaker-b/10"
                  : "border-transparent bg-secondary/60"
              } ${overIdx === i && dragFrom !== i ? "ring-2 ring-ring" : ""} ${l.visible ? "" : "opacity-50"}`}
            >
              <button
                aria-label={l.visible ? "Gizle" : "Göster"}
                aria-pressed={l.visible}
                className="w-6 shrink-0 text-center hover:text-speaker-b"
                onClick={() =>
                  rt.project.setLayerVisible(scene.id, l.id, !l.visible)
                }
              >
                {l.visible ? "👁" : "—"}
              </button>
              <button
                aria-label={l.locked ? "Kilidi aç" : "Kilitle"}
                aria-pressed={l.locked}
                className="w-6 shrink-0 text-center hover:text-speaker-b"
                onClick={() =>
                  rt.project.setLayerLocked(scene.id, l.id, !l.locked)
                }
              >
                {l.locked ? "🔒" : "🔓"}
              </button>
              <button
                className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left"
                onClick={() => onSelect(l.id)}
              >
                <span aria-hidden>{LAYER_ICON[l.kind]}</span>
                <span className="truncate">{l.name}</span>
              </button>
              <span className="flex shrink-0 gap-0.5 text-muted-foreground">
                <button
                  aria-label="Öne al"
                  className="px-1 hover:text-foreground disabled:opacity-30"
                  disabled={i === scene.layers.length - 1}
                  onClick={() => rt.project.moveUp(scene.id, l.id)}
                >
                  ↑
                </button>
                <button
                  aria-label="Arkaya al"
                  className="px-1 hover:text-foreground disabled:opacity-30"
                  disabled={i === 0}
                  onClick={() => rt.project.moveDown(scene.id, l.id)}
                >
                  ↓
                </button>
                <button
                  aria-label="Çoğalt"
                  className="px-1 hover:text-foreground"
                  onClick={() => {
                    const id = rt.project.duplicateLayer(scene.id, l.id);
                    if (id) onSelect(id);
                  }}
                >
                  ⧉
                </button>
                <button
                  aria-label="Sil"
                  className="px-1 text-destructive hover:opacity-80"
                  onClick={() => {
                    rt.project.removeLayer(scene.id, l.id);
                    if (selectedId === l.id) onSelect(null);
                  }}
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
