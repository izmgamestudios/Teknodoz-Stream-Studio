// src/studio/ui/prompter-view.tsx
// The streamer-only prompter display (HUD). It is plain DOM, so it can never end up in the
// recorded canvas; burn-in is a separate, explicit opt-in handled by the compositor.
import { useEffect, useMemo, useRef, useState } from "react";

import {
  attachRaf,
  getBurnInView,
  lineIndexForWord,
  type BurnInView,
} from "../prompter";
import { useProject, useStudio } from "../runtime/use-studio";

/** Scrolling HUD. Fills its parent's height; the parent decides the size. */
export function PrompterView({ className = "" }: { className?: string }) {
  const rt = useStudio();
  const project = useProject();
  const { script, settings } = project.prompter;
  const model = useMemo(() => rt.getScriptModel(), [rt, script]);
  const boxRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [activeLine, setActiveLine] = useState(0);

  // keep the engine's scroll extent in sync with the rendered text
  useEffect(() => {
    const box = boxRef.current;
    const inner = innerRef.current;
    if (!box || !inner) return;
    const measure = () => {
      // CSS percentage padding is relative to the WIDTH, so derive it from the height instead:
      // the text starts at the reading guide (28 %) and can scroll fully past the top.
      box.style.paddingTop = `${Math.round(box.clientHeight * 0.28)}px`;
      box.style.paddingBottom = `${Math.round(box.clientHeight * 0.7)}px`;
      rt.prompter.setMaxPx(Math.max(0, box.scrollHeight - box.clientHeight));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [rt, script, settings.fontSize, settings.lineHeight]);

  // engine position -> scrollTop, and the active line highlight
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    return attachRaf(rt.prompter, (px) => {
      if (Math.abs(box.scrollTop - px) > 0.5) box.scrollTop = px;
      const line = Math.max(0, lineIndexForWord(model, rt.currentWordIndex()));
      setActiveLine((cur) => (cur === line ? cur : line));
    });
  }, [rt, model]);

  const opacity = 0.45 + 0.55 * settings.contrast;

  return (
    <div
      className={`relative overflow-hidden rounded-lg bg-black/70 ${className}`}
    >
      {/* reading guide */}
      <div className="pointer-events-none absolute inset-x-0 top-[28%] z-10 h-px bg-ring/60" />
      <div
        ref={boxRef}
        className="h-full overflow-y-auto px-6 [scrollbar-width:none]"
        onScroll={(e) => {
          // manual scrolling (wheel / touch / scrollbar) while paused moves the engine too
          if (!rt.prompter.getSnapshot().playing)
            rt.prompter.seek(e.currentTarget.scrollTop);
        }}
      >
        <div
          ref={innerRef}
          style={{
            transform: settings.mirror ? "scaleX(-1)" : undefined,
            fontSize: settings.fontSize,
            lineHeight: settings.lineHeight,
          }}
        >
          {model.lines.length === 0 && (
            <p className="text-center text-sm text-white/50">
              Metin yok. Soldaki alana yazın, yapıştırın veya dosya yükleyin.
            </p>
          )}
          {model.lines.map((l) => (
            <p
              key={l.index}
              className={`mb-[0.6em] font-medium transition-opacity ${
                l.speaker === "B"
                  ? "text-right text-speaker-b"
                  : "text-speaker-a"
              }`}
              style={{
                opacity: l.index === activeLine ? 1 : opacity * 0.7,
                textShadow: "0 2px 8px rgb(0 0 0 / 0.8)",
              }}
            >
              {l.text}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

const EMPTY_VIEW: BurnInView = {
  lines: [],
  activeLine: 0,
  progress: 0,
  lineProgress: 0,
};

/** Compact semi-transparent 1–2 line "notch" pinned under the camera (top-center of the window). */
export function NotchView() {
  const rt = useStudio();
  const project = useProject();
  const model = useMemo(
    () => rt.getScriptModel(),
    [rt, project.prompter.script],
  );
  const [view, setView] = useState<BurnInView>(EMPTY_VIEW);
  const lastUpdate = useRef(0);
  const lastWord = useRef(-1);

  useEffect(() => {
    lastWord.current = -1;
    return attachRaf(rt.prompter, () => {
      const now = performance.now();
      const word = rt.currentWordIndex();
      if (word === lastWord.current || now - lastUpdate.current < 100) return;
      lastWord.current = word;
      lastUpdate.current = now;
      setView(getBurnInView(model, word, "notch"));
    });
  }, [rt, model]);

  if (view.lines.length === 0) return null;
  const s = project.prompter.settings;
  return (
    <div
      className="pointer-events-none fixed left-1/2 top-2 z-40 w-[min(760px,92vw)] -translate-x-1/2 rounded-2xl px-4 py-2 text-center backdrop-blur-sm"
      style={{
        background: `rgb(0 0 0 / ${0.4 + 0.35 * s.contrast})`,
        transform: s.mirror ? "translateX(-50%) scaleX(-1)" : undefined,
      }}
      aria-live="off"
    >
      {view.lines.map((line, i) => (
        <p
          key={i}
          className={
            i === view.activeLine ? "font-semibold text-white" : "text-white/60"
          }
          style={{
            fontSize: Math.max(16, Math.min(s.fontSize * 0.6, 30)),
            lineHeight: 1.3,
          }}
        >
          {line}
        </p>
      ))}
    </div>
  );
}
