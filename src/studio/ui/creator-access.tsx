// src/studio/ui/creator-access.tsx
// Creator sign-in and application form (used in the first-visit gate and on /creator).
import { useState } from "react";

import type { MessageKey } from "../i18n/messages";
import { useT } from "../i18n/use-t";
import {
  applyCreator,
  loginCreator,
  type ApplyResult,
  type CreatorLogin,
} from "../watch/creator-session";
import { BTN, BTN_ACCENT, INPUT } from "./fields";

const APPLY_ERR: Record<Exclude<ApplyResult, "ok">, MessageKey> = {
  "bad-name": "cr.err.name",
  "bad-phone": "cr.err.phone",
  "bad-email": "cr.err.email",
  "contact-required": "cr.err.contact",
  rate: "cr.err.rate",
  busy: "cr.err.busy",
  network: "cr.err.network",
};
const LOGIN_ERR: Record<Exclude<CreatorLogin, "ok">, MessageKey> = {
  bad: "cr.err.bad",
  rate: "cr.err.rate",
  network: "cr.err.network",
};

export function CreatorAccess({
  onSignedIn,
  onBack,
}: {
  onSignedIn: () => void;
  onBack?: () => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<"login" | "apply">("login");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<MessageKey | null>(null);
  const [sent, setSent] = useState(false);
  const [f, setF] = useState({
    username: "",
    password: "",
    name: "",
    phone: "",
    email: "",
    website: "",
  });
  const set = (patch: Partial<typeof f>) => setF((p) => ({ ...p, ...patch }));

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const r = await loginCreator(f.username.trim(), f.password);
    setBusy(false);
    if (r === "ok") onSignedIn();
    else setErr(LOGIN_ERR[r]);
  }

  async function apply(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const r = await applyCreator({
      name: f.name,
      phone: f.phone,
      email: f.email,
      website: f.website,
    });
    setBusy(false);
    if (r === "ok") setSent(true);
    else setErr(APPLY_ERR[r]);
  }

  const tabBtn = (id: "login" | "apply", label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      className={`${BTN} flex-1 ${tab === id ? "ring-2 ring-ring" : ""}`}
      onClick={() => {
        setTab(id);
        setErr(null);
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-3 rounded-xl border bg-card p-5">
      <h2 className="text-lg font-bold">🎬 {t("cr.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("cr.intro")}</p>
      <div role="tablist" className="flex gap-2">
        {tabBtn("login", t("cr.tab.login"))}
        {tabBtn("apply", t("cr.tab.apply"))}
      </div>

      {tab === "login" ? (
        <form className="space-y-3" onSubmit={(e) => void login(e)}>
          <label className="block text-xs text-muted-foreground">
            {t("cr.username")}
            <input
              className={`${INPUT} mt-1`}
              autoComplete="username"
              autoCapitalize="none"
              required
              value={f.username}
              onChange={(e) => set({ username: e.target.value })}
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            {t("cr.password")}
            <input
              className={`${INPUT} mt-1`}
              type="password"
              autoComplete="current-password"
              required
              value={f.password}
              onChange={(e) => set({ password: e.target.value })}
            />
          </label>
          <button className={`${BTN_ACCENT} w-full`} disabled={busy}>
            {t("cr.login")}
          </button>
        </form>
      ) : sent ? (
        <p
          role="status"
          className="rounded-md border border-speaker-b/40 p-3 text-sm"
        >
          {t("cr.apply.done")}
        </p>
      ) : (
        <form className="space-y-3" onSubmit={(e) => void apply(e)}>
          <label className="block text-xs text-muted-foreground">
            {t("cr.apply.name")} *
            <input
              className={`${INPUT} mt-1`}
              autoComplete="name"
              required
              minLength={2}
              maxLength={80}
              value={f.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            {t("cr.apply.phone")}
            <input
              className={`${INPUT} mt-1`}
              type="tel"
              autoComplete="tel"
              maxLength={40}
              value={f.phone}
              onChange={(e) => set({ phone: e.target.value })}
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            {t("cr.apply.email")}
            <input
              className={`${INPUT} mt-1`}
              type="email"
              autoComplete="email"
              maxLength={120}
              value={f.email}
              onChange={(e) => set({ email: e.target.value })}
            />
          </label>
          {/* honeypot: hidden from people, bots fill it */}
          <input
            tabIndex={-1}
            aria-hidden="true"
            autoComplete="off"
            className="absolute -left-[9999px] h-0 w-0 opacity-0"
            name="website"
            value={f.website}
            onChange={(e) => set({ website: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">{t("cr.apply.hint")}</p>
          <button className={`${BTN_ACCENT} w-full`} disabled={busy}>
            {busy ? t("cr.apply.sending") : t("cr.apply.send")}
          </button>
        </form>
      )}

      {err && (
        <p role="alert" className="text-sm text-destructive">
          {t(err)}
        </p>
      )}
      {onBack && (
        <button type="button" className="text-xs underline" onClick={onBack}>
          {t("cr.back")}
        </button>
      )}
    </div>
  );
}
