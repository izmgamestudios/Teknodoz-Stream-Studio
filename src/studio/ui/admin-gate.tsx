// src/studio/ui/admin-gate.tsx
// Shows its children to the administrator only; everyone else gets the login form.
import { useState, type ReactNode } from "react";

import { useT } from "../i18n/use-t";
import { loginAdmin, useAdmin, type LoginResult } from "../watch/admin-session";
import { BTN_ACCENT, INPUT, PANEL, PanelTitle } from "./fields";

const ERR: Record<
  Exclude<LoginResult, "ok">,
  | "admin.login.err.bad"
  | "admin.login.err.rate"
  | "admin.login.err.disabled"
  | "admin.login.err.network"
> = {
  bad: "admin.login.err.bad",
  rate: "admin.login.err.rate",
  disabled: "admin.login.err.disabled",
  network: "admin.login.err.network",
};

export function AdminGate({ children }: { children: ReactNode }) {
  const t = useT();
  const { admin } = useAdmin();
  const [token, setToken] = useState("");
  const [err, setErr] = useState<LoginResult | null>(null);
  const [busy, setBusy] = useState(false);

  if (admin === null)
    return (
      <p className="p-6 text-sm text-muted-foreground">{t("watch.loading")}</p>
    );
  if (admin) return <>{children}</>;

  return (
    <section
      className={`${PANEL} mx-auto my-8 max-w-md`}
      aria-label={t("admin.login.title")}
    >
      <PanelTitle>🔒 {t("admin.login.title")}</PanelTitle>
      <p className="mb-3 text-xs text-muted-foreground">
        {t("admin.login.body")}
      </p>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const r = await loginAdmin(token);
          setBusy(false);
          setErr(r === "ok" ? null : r);
          if (r === "ok") setToken("");
        }}
      >
        <input
          type="password"
          autoComplete="current-password"
          className={`${INPUT} min-w-0 flex-1`}
          aria-label={t("catalog.token")}
          placeholder={t("catalog.token")}
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <button className={BTN_ACCENT} disabled={busy || token.length < 8}>
          {t("admin.login.button")}
        </button>
      </form>
      {err && err !== "ok" && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {t(ERR[err])}
        </p>
      )}
    </section>
  );
}
