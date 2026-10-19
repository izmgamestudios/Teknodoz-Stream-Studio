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
import type { LiveSnapshot } from "../live/streamer";
import type { RoomSnapshot } from "../room/host-session";
import type { PeerInfo, ProjectState } from "../types";
import { StudioRuntime, type RuntimeSnapshot } from "./runtime";
import type { SourcesSnapshot } from "./sources";

const Ctx = createContext<StudioRuntime | null>(null);

/**
 * ONE runtime per page load, shared by every route (prompter, studio, room...). Navigating
 * between routes therefore keeps the camera, recording and P2P connections alive.
 */
let singleton: {
  runtime: StudioRuntime;
  ready: Promise<StudioRuntime>;
} | null = null;

export function acquireRuntime(): Promise<StudioRuntime> {
  if (!singleton) {
    const runtime = new StudioRuntime();
    singleton = {
      runtime,
      ready: runtime.restore().then(() => {
        runtime.resumeSavedRoom();
        return runtime;
      }),
    };
    window.addEventListener("pagehide", () => void runtime.flushAutosave());
    if (import.meta.hot) {
      import.meta.hot.dispose(() => {
        void runtime.dispose();
        singleton = null;
      });
    }
  }
  return singleton.ready;
}

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
    void acquireRuntime().then((rt) => {
      if (!cancelled) setRuntime(rt);
    });
    return () => {
      cancelled = true;
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

/** Connected peers (viewers, guests, remotes). Empty until the first invite is created. */
export function usePeers(): readonly PeerInfo[] {
  const rt = useStudio();
  return useSyncExternalStore(
    rt.subscribePeers,
    rt.getPeersSnapshot,
    rt.getPeersSnapshot,
  );
}

/** Room state (code, waiting pool, log). Does not open the room by itself. */
export function useRoom(): RoomSnapshot {
  const rt = useStudio();
  return useSyncExternalStore(
    rt.room.subscribe,
    rt.room.getSnapshot,
    rt.room.getSnapshot,
  );
}

/** RTMP(S) live broadcast state (see `/live`). */
export function useLive(): LiveSnapshot {
  const rt = useStudio();
  return useSyncExternalStore(
    rt.live.subscribe,
    rt.live.getSnapshot,
    rt.live.getSnapshot,
  );
}
