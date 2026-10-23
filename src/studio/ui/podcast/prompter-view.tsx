// src/studio/ui/podcast/prompter-view.tsx
// Scrolling podcast text. Guests follow the moderator's state (read-only); the moderator's own
// preview is the "leader": it scrolls locally and reports its position so guests stay in step.
import { useEffect, useRef } from "react";

import { nextScroll, scrollRatio, shouldResync } from "../../podcast/prompter";
import type { PodcastPrompter } from "../../types";

export function PrompterView({
  state,
  empty,
  onPos,
  onDone,
  className = "",
}: {
  state: PodcastPrompter;
  /** shown when there is no text */
  empty?: string;
  /** leader mode: called ~4x/s while playing with the 0..1 position */
  onPos?: (ratio: number) => void;
  onDone?: () => void;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const live = useRef(state);
  live.current = state;
  const cb = useRef({ onPos, onDone });
  cb.current = { onPos, onDone };
  const leader = Boolean(onPos);

  // remote / manual position
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    if (leader && state.playing) return;
    if (shouldResync(scrollRatio(el.scrollTop, max), state.pos, state.playing))
      el.scrollTop = state.pos * max;
  }, [state.pos, state.playing, state.text, state.size, leader]);

  // playback
  useEffect(() => {
    if (!state.playing) return;
    let raf = 0;
    let last = performance.now();
    let sent = 0;
    const tick = (now: number) => {
      const el = box.current;
      if (el) {
        const max = el.scrollHeight - el.clientHeight;
        const r = nextScroll(
          el.scrollTop,
          max,
          live.current.speed,
          now - last,
          true,
        );
        el.scrollTop = r.top;
        if (leader && now - sent > 250) {
          sent = now;
          cb.current.onPos?.(scrollRatio(r.top, max));
        }
        if (leader && r.done) {
          cb.current.onDone?.();
          return;
        }
      }
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state.playing, leader]);

  return (
    <div
      ref={box}
      data-testid="prompter-view"
      className={`overflow-hidden rounded-lg bg-black p-4 text-center font-semibold leading-snug text-white ${className}`}
      style={{ fontSize: state.size }}
    >
      {state.text ? (
        <div className="whitespace-pre-wrap py-[30%]">{state.text}</div>
      ) : (
        <p className="py-8 text-base font-normal opacity-60">{empty}</p>
      )}
    </div>
  );
}
