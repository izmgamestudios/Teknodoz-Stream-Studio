// src/studio/ui/scene-panel.tsx
import { useState } from "react";

import { GL_TRANSITIONS } from "../engine/gl-transitions";
import { getActiveScene } from "../project/store";
import {
  useProject,
  useRuntimeSnapshot,
  useStudio,
} from "../runtime/use-studio";
import type { TransitionType } from "../types";
import { TemplateDialog } from "./template-dialog";
import {
  BTN,
  Field,
  INPUT,
  NumInput,
  PANEL,
  PanelTitle,
  SelectInput,
} from "./fields";

const TRANSITIONS = [
  { value: "cut", label: "Kesme (anında)" },
  { value: "fade", label: "Yumuşak geçiş (fade)" },
  { value: "slide", label: "Kaydırma (slide)" },
  ...GL_TRANSITIONS.map(([id, label]) => ({
    value: `gl:${id}` as const,
    label: `✦ ${label} (WebGL)`,
  })),
] as const satisfies readonly { value: TransitionType; label: string }[];

export function ScenePanel() {
  const rt = useStudio();
  const project = useProject();
  const active = getActiveScene(project);
  const snap = useRuntimeSnapshot();
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <section className={PANEL} aria-label="Sahneler">
      <PanelTitle
        aside={
          <span className="flex gap-1.5">
            <TemplateDialog />
            <button
              className={BTN}
              onClick={() => rt.project.addScene()}
              title="Yeni sahne"
            >
              + Sahne
            </button>
          </span>
        }
      >
        Sahneler
      </PanelTitle>
      <ul className="space-y-1">
        {project.scenes.map((s, i) => (
          <li key={s.id}>
            <div
              className={`group flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-sm ${
                s.id === active.id
                  ? "border-speaker-b/60 bg-speaker-b/10"
                  : "border-transparent bg-secondary/60 hover:bg-accent"
              }`}
            >
              {editing === s.id ? (
                <input
                  autoFocus
                  defaultValue={s.name}
                  className={INPUT}
                  onBlur={(e) => {
                    rt.project.renameScene(
                      s.id,
                      e.target.value.trim() || s.name,
                    );
                    setEditing(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === "Escape")
                      e.currentTarget.blur();
                  }}
                />
              ) : (
                <button
                  className="min-w-0 flex-1 truncate text-left"
                  onClick={() => rt.switchScene(s.id)}
                  onDoubleClick={() => setEditing(s.id)}
                  title="Tıkla: yayına al · Çift tıkla: yeniden adlandır"
                >
                  {s.name}
                </button>
              )}
              {s.hotkey && (
                <kbd className="rounded border px-1 text-[10px] text-muted-foreground">
                  {s.hotkey}
                </kbd>
              )}
              <span className="hidden gap-0.5 group-hover:flex group-focus-within:flex">
                <button
                  aria-label="Yukarı taşı"
                  className="px-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  disabled={i === 0}
                  onClick={() => rt.project.reorderScene(i, i - 1)}
                >
                  ↑
                </button>
                <button
                  aria-label="Aşağı taşı"
                  className="px-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  disabled={i === project.scenes.length - 1}
                  onClick={() => rt.project.reorderScene(i, i + 1)}
                >
                  ↓
                </button>
                <button
                  aria-label="Çoğalt"
                  className="px-1 text-muted-foreground hover:text-foreground"
                  onClick={() => rt.project.duplicateScene(s.id)}
                >
                  ⧉
                </button>
                <button
                  aria-label="Sil"
                  className="px-1 text-destructive hover:opacity-80 disabled:opacity-30"
                  disabled={project.scenes.length <= 1}
                  onClick={() => {
                    if (window.confirm(`“${s.name}” sahnesi silinsin mi?`))
                      rt.project.removeScene(s.id);
                  }}
                >
                  ✕
                </button>
              </span>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-3">
        <Field label="Kısayol tuşu">
          <input
            className={INPUT}
            maxLength={8}
            placeholder="1-9"
            value={active.hotkey ?? ""}
            onChange={(e) =>
              rt.project.setSceneHotkey(
                active.id,
                e.target.value.trim() || undefined,
              )
            }
          />
        </Field>
        <Field label="Geçiş süresi (ms)">
          <NumInput
            value={active.transition.ms}
            min={0}
            max={5000}
            step={50}
            onChange={(ms) =>
              rt.project.setSceneTransition(active.id, {
                ...active.transition,
                ms,
              })
            }
          />
        </Field>
        <Field label="Otomatik geç (sn, 0 = elle)">
          <NumInput
            value={active.autoAdvanceSec ?? 0}
            min={0}
            max={3600}
            step={5}
            onChange={(sec) => rt.project.setSceneAutoAdvance(active.id, sec)}
          />
        </Field>
        <div className="flex items-end">
          <button
            className={`${BTN} w-full justify-center ${snap.autoRun ? "bg-speaker-b text-background" : ""}`}
            aria-pressed={snap.autoRun}
            onClick={() => rt.setAutoRun(!snap.autoRun)}
            title="Süresi olan sahneler sırayla kendiliğinden geçer"
          >
            {snap.autoRun
              ? snap.autoLeft > 0
                ? `■ Otomatik sıra · ${snap.autoLeft} sn`
                : "■ Otomatik sıra açık"
              : "▶ Otomatik sıra"}
          </button>
        </div>
        <div className="col-span-2">
          <Field label="Geçiş türü">
            <SelectInput
              value={active.transition.type}
              options={TRANSITIONS}
              onChange={(type) =>
                rt.project.setSceneTransition(active.id, {
                  ...active.transition,
                  type,
                })
              }
            />
          </Field>
        </div>
      </div>
    </section>
  );
}
