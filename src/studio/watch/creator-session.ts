// src/studio/watch/creator-session.ts
// Content-creator session in the browser (the server keeps it in an HttpOnly cookie) and the
// calls of the application flow. `canCreate` is what the shell asks: accounts are switched off
// (open studio, as before) or the visitor is a signed-in creator or the administrator.
import { useSyncExternalStore } from "react";

export interface CreatorState {
  /** false until the first answer */
  loaded: boolean;
  /** server has accounts on (needs the admin token) */
  enabled: boolean;
  admin: boolean;
  creator: { name: string; username: string } | null;
}

let state: CreatorState = {
  loaded: false,
  enabled: false,
  admin: false,
  creator: null,
};
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: CreatorState): void {
  state = next;
  for (const l of [...listeners]) l();
}

export const getCreatorState = (): CreatorState => state;

export function canCreate(s: CreatorState): boolean {
  return !s.enabled || s.admin || s.creator !== null;
}

export function refreshCreator(): Promise<void> {
  inflight ??= (async () => {
    try {
      const res = await fetch("/api/creators/me", { cache: "no-store" });
      if (res.ok) {
        const d = (await res.json()) as {
          enabled: boolean;
          admin: boolean;
          creator: CreatorState["creator"];
        };
        set({
          loaded: true,
          enabled: d.enabled === true,
          admin: d.admin === true,
          creator: d.creator ?? null,
        });
      } else {
        // 503 = accounts disabled on this server; anything else: do not lock people out
        set({ loaded: true, enabled: false, admin: false, creator: null });
      }
    } catch {
      set({ loaded: true, enabled: false, admin: false, creator: null });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export type CreatorLogin = "ok" | "bad" | "rate" | "network";

export async function loginCreator(
  username: string,
  password: string,
): Promise<CreatorLogin> {
  try {
    const res = await fetch("/api/creators/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (res.ok) {
      await refreshCreator();
      return "ok";
    }
    return res.status === 429 ? "rate" : "bad";
  } catch {
    return "network";
  }
}

export async function logoutCreator(): Promise<void> {
  try {
    await fetch("/api/creators/logout", { method: "POST" });
  } catch {
    /* offline: the cookie expires by itself */
  }
  await refreshCreator();
}

export type ApplyResult =
  | "ok"
  | "bad-name"
  | "bad-phone"
  | "bad-email"
  | "contact-required"
  | "rate"
  | "busy"
  | "network";

export async function applyCreator(data: {
  name: string;
  phone: string;
  email: string;
  website?: string;
}): Promise<ApplyResult> {
  try {
    const res = await fetch("/api/creators/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) return "ok";
    if (res.status === 429) return "rate";
    const e = ((await res.json().catch(() => ({}))) as { error?: string })
      .error;
    if (
      e === "bad-name" ||
      e === "bad-phone" ||
      e === "bad-email" ||
      e === "contact-required" ||
      e === "busy"
    )
      return e;
    return "network";
  } catch {
    return "network";
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useCreator(): CreatorState {
  const s = useSyncExternalStore(subscribe, getCreatorState, getCreatorState);
  if (typeof window !== "undefined" && !s.loaded) void refreshCreator();
  return s;
}

/* ------------------------------ admin side ------------------------------ */

export interface CreatorEntry {
  id: string;
  name: string;
  phone: string;
  email: string;
  status: "pending" | "approved" | "rejected" | "revoked";
  createdAt: string;
  decidedAt: string | null;
  username: string;
  lastLoginAt: string | null;
}

export async function listCreators(): Promise<CreatorEntry[] | null> {
  try {
    const res = await fetch("/api/creators", { cache: "no-store" });
    return res.ok
      ? ((await res.json()) as { creators: CreatorEntry[] }).creators
      : null;
  } catch {
    return null;
  }
}

export interface Credentials {
  username: string;
  password: string;
}

export async function decideCreator(
  id: string,
  action: "approve" | "reject" | "revoke" | "reset",
): Promise<{ ok: boolean; credentials?: Credentials }> {
  try {
    const res = await fetch(
      `/api/creators/${encodeURIComponent(id)}/${action}`,
      { method: "POST" },
    );
    if (!res.ok) return { ok: false };
    const d = (await res.json()) as { credentials?: Credentials };
    return d.credentials
      ? { ok: true, credentials: d.credentials }
      : { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function deleteCreator(id: string): Promise<boolean> {
  try {
    return (
      await fetch(`/api/creators/${encodeURIComponent(id)}`, {
        method: "DELETE",
      })
    ).ok;
  } catch {
    return false;
  }
}

/** Message the administrator sends to the new creator (mail / SMS / WhatsApp links). */
export function credentialMessage(
  name: string,
  c: Credentials,
  origin: string,
): string {
  return `Merhaba ${name}, Teknodoz Studio içerik üreticisi başvurunuz onaylandı.\nKullanıcı adı: ${c.username}\nŞifre: ${c.password}\nGiriş: ${origin}/creator\nİlk girişten sonra şifreyi güvenli bir yerde saklayın.`;
}

export function contactLinks(
  entry: { phone: string; email: string },
  text: string,
  subject = "Teknodoz Studio — giriş bilgileriniz",
): { label: "mail" | "sms" | "whatsapp"; href: string }[] {
  const out: { label: "mail" | "sms" | "whatsapp"; href: string }[] = [];
  if (entry.email)
    out.push({
      label: "mail",
      href: `mailto:${entry.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`,
    });
  if (entry.phone) {
    out.push({
      label: "sms",
      href: `sms:${entry.phone}?body=${encodeURIComponent(text)}`,
    });
    out.push({
      label: "whatsapp",
      href: `https://wa.me/${entry.phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`,
    });
  }
  return out;
}
