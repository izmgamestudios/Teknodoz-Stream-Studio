// src/studio/ui/health-panel.tsx
// One-line system health (fps, frame cost, audio peak) that expands into plain-language advice
// as soon as something is off. Polls the runtime; no re-render noise while everything is fine.
import { useEffect, useRef, useState } from "react";

import {
  assessHealth,
  HEALTH_LABEL,
  type HealthReport,
} from "../engine/health";
import { useStudio } from "../runtime/use-studio";
import { PANEL } from "./fields";

interface Shown {
  report: HealthReport;
  fps: number;
  frameMs: number;
  target: number;
  size: string;
}

const DOT = {
  ok: "bg-speaker-b",
  warn: "bg-speaker-a",
  bad: "bg-destructive animate-pulse",
} as const;

export function HealthPanel() {
  const rt = useStudio();
  const [shown, setShown] = useState<Shown | null>(null);
  const dropped = useRef(0);
  const peak = useRef(-100);
  const webgl = useRef<boolean | undefined>(undefined);
  const storage = useRef<number | undefined>(undefined);

  useEffect(() => {
    // one-off capability probes
    try {
      webgl.current = !!document.createElement("canvas").getContext("webgl");
    } catch {
      webgl.current = false;
    }
    void navigator.storage?.estimate?.().then((e) => {
      if (e.quota && e.usage !== undefined) storage.current = e.usage / e.quota;
    });

    // fast loop keeps the audio peak (clipping is short), slow loop publishes
    const fast = setInterval(() => {
      peak.current = Math.max(peak.current, rt.getHealthSample().masterPeakDb);
    }, 100);
    const slow = setInterval(() => {
      const s = rt.getHealthSample();
      const droppedDelta = Math.max(0, s.stats.droppedFrames - dropped.current);
      dropped.current = s.stats.droppedFrames;
      const report = assessHealth({
        fps: s.stats.fps,
        targetFps: s.targetFps,
        frameMs: s.stats.frameMs,
        droppedDelta,
        masterPeakDb: peak.current,
        micPresent: s.micPresent,
        micMuted: s.micMuted,
        recording: s.recording,
        width: s.width,
        height: s.height,
        tabHidden: document.hidden,
        ...(storage.current !== undefined
          ? { storageUsed: storage.current }
          : {}),
        ...(webgl.current !== undefined ? { webgl: webgl.current } : {}),
      });
      peak.current = -100;
      setShown((prev) => {
        const next: Shown = {
          report,
          fps: Math.round(s.stats.fps),
          frameMs: Math.round(s.stats.frameMs * 10) / 10,
          target: s.targetFps,
          size: `${s.width}×${s.height}`,
        };
        // avoid re-rendering when nothing visible changed
        return prev &&
          prev.fps === next.fps &&
          prev.frameMs === next.frameMs &&
          prev.report.level === next.report.level &&
          prev.report.issues.map((i) => i.id).join() ===
            next.report.issues.map((i) => i.id).join()
          ? prev
          : next;
      });
    }, 1000);
    return () => {
      clearInterval(fast);
      clearInterval(slow);
    };
  }, [rt]);

  if (!shown) return null;
  const { report } = shown;
  return (
    <section className={PANEL} aria-label="Sistem sağlığı">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span
          className={`inline-block size-2.5 rounded-full ${DOT[report.level]}`}
          aria-hidden
        />
        <span className="font-semibold">Sistem sağlığı</span>
        <span role="status" className="text-muted-foreground">
          {HEALTH_LABEL[report.level]}
        </span>
        <span className="ml-auto font-mono tabular-nums text-muted-foreground">
          {shown.fps}/{shown.target} fps · {shown.frameMs} ms · {shown.size}
        </span>
      </div>
      {report.issues.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs">
          {report.issues.map((i) => (
            <li
              key={i.id}
              className={`rounded-md px-2 py-1.5 ${i.level === "bad" ? "bg-destructive/15 text-foreground" : "bg-secondary text-muted-foreground"}`}
            >
              {i.level === "bad" ? "⚠ " : "• "}
              {i.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
