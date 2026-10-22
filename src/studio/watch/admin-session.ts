// src/studio/watch/admin-session.ts
// Administrator session in the browser. The server keeps the login in an HttpOnly cookie (page
// scripts cannot read it), so this module only asks "am I the admin?" and logs in / out.
import { useSyncExternalStore } from "react";

export interface AdminState {
  /** null = not asked yet */
  admin: boolean | null;
  /** false = the server has no admin token configured */
  enabled: boolean;
}

let state: AdminState = { admin: null, enabled: true };
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: AdminState): void {
  state = next;
  for (const l of [...listeners]) l();
}

export function getAdminState(): AdminState {
  return state;
}

export function refreshAdmin(): Promise<void> {
  inflight ??= (async () => {
    try {
      const res = await fetch("/api/session", { cache: "no-store" });
      if (res.ok) {
        const d = (await res.json()) as { admin: boolean; enabled: boolean };
        set({ admin: d.admin === true, enabled: d.enabled !== false });
      } else set({ admin: false, enabled: true });
    } catch {
      // offline / static hosting: nobody is the admin
      set({ admin: false, enabled: false });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export type LoginResult = "ok" | "bad" | "rate" | "disabled" | "network";

export async function loginAdmin(token: string): Promise<LoginResult> {
  try {
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (res.ok) {
      set({ admin: true, enabled: true });
      return "ok";
    }
    return res.status === 429
      ? "rate"
      : res.status === 503
        ? "disabled"
        : "bad";
  } catch {
    return "network";
  }
}

export async function logoutAdmin(): Promise<void> {
  try {
    await fetch("/api/session", { method: "DELETE" });
  } finally {
    set({ admin: false, enabled: state.enabled });
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const SERVER: AdminState = { admin: null, enabled: true };

/** Reactive admin state; the first subscriber triggers the check. */
export function useAdmin(): AdminState {
  const s = useSyncExternalStore(subscribe, getAdminState, () => SERVER);
  if (typeof window !== "undefined" && s.admin === null) void refreshAdmin();
  return s;
}
