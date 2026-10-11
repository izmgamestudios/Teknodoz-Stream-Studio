// src/studio/runtime/use-studio.tsx
// React bindings for the StudioRuntime. SSR-safe: the runtime only exists on the client, so
// consumers render a placeholder until `useStudio()` returns a runtime.
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type { AudioBusState } from "../engine/audio-bus";
import type { PrompterSnapshot } from "../prompter";
import type { ProjectState } from "../types";
import { StudioRuntime, type RuntimeSnapshot } from "./runtime";
import type { SourcesSnapshot } from "./sources";

const Ctx = createContext<StudioRuntime | null>(null);

export function StudioProvider({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const [runtime, setRuntime] = useState<StudioRuntime | null>(null);

  useEffect(() => {
    let cancelled = false;
    const rt = new StudioRuntime();
    void rt.restore().finally(() => {
      if (!cancelled) setRuntime(rt);
    });
    return () => {
      cancelled = true;
      setRuntime((cur) => (cur === rt ? null : cur));
      void rt.dispose();
    };
  }, []);

  if (!runtime) return <>{fallback}</>;
  return <Ctx.Provider value={runtime}>{children}</Ctx.Provider>;
}

/** The runtime. Only call below <StudioProvider> (it renders children only when ready). */
export function useStudio(): StudioRuntime {
  const rt = useContext(Ctx);
  if (!rt) throw new Error("useStudio must be used inside <StudioProvider>");
  return rt;
}

export function useProject(): ProjectState {
  const rt = useStudio();
  return useSyncExternalStore(
    rt.project.subscribe,
    rt.project.getState,
    rt.project.getState,
  );
}

export function useRuntimeSnapshot(): RuntimeSnapshot {
  const rt = useStudio();
  return useSyncExternalStore(rt.subscribe, rt.getSnapshot, rt.getSnapshot);
}

export function useSources(): SourcesSnapshot {
  const rt = useStudio();
  return useSyncExternalStore(
    rt.sources.subscribe,
    rt.sources.getSnapshot,
    rt.sources.getSnapshot,
  );
}

export function useAudioState(): AudioBusState {
  const rt = useStudio();
  return useSyncExternalStore(
    rt.audio.subscribe,
    rt.audio.getState,
    rt.audio.getState,
  );
}

/** Coarse prompter state (no per-frame position updates). */
export function usePrompterState(): PrompterSnapshot {
  const rt = useStudio();
  return useSyncExternalStore(
    rt.prompter.subscribeCoarse,
    rt.prompter.getSnapshot,
    rt.prompter.getServerSnapshot,
  );
}
