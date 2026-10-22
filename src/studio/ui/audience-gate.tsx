// src/studio/ui/audience-gate.tsx
// First-visit question ("viewer or creator?") plus the small preference bar (mode, language,
// theme) used in the shell. The gate is an overlay, so server-rendered pages stay crawlable.
import { useEffect, useRef } from "react";

import { setAudience, useAudience, type Audience } from "../audience";
import { LANGS, type Lang } from "../i18n/messages";
import { useLang, useT } from "../i18n/use-t";
import { getSettingsSnapshot, saveSettings } from "../storage";
import { useTheme, type ThemeChoice } from "../theme";
import { logoutAdmin, useAdmin } from "../watch/admin-session";
import { Link } from "@tanstack/react-router";

export function AudienceGate() {
  const t = useT();
  const audience = useAudience();
  const first = useRef<HTMLButtonElement>(null);
  const open = audience === null;
  useEffect(() => {
    if (open) first.current?.focus();
  }, [open]);
  if (!open) return null;
  const card =
    "flex flex-1 flex-col gap-1 rounded-xl border bg-card p-5 text-left transition-colors hover:border-speaker-b hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-background p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="gate-title"
        className="w-full max-w-2xl space-y-4"
      >
        <div className="flex justify-end">
          <PrefBar />
        </div>
        <h2 id="gate-title" className="text-center text-2xl font-bold">
          {t("gate.title")}
        </h2>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            ref={first}
            className={card}
            onClick={() => setAudience("viewer")}
          >
            <span className="text-3xl" aria-hidden="true">
              📺
            </span>
            <span className="text-lg font-bold">{t("gate.viewer")}</span>
            <span className="text-sm text-muted-foreground">
              {t("gate.viewer.body")}
            </span>
          </button>
          <button className={card} onClick={() => setAudience("creator")}>
            <span className="text-3xl" aria-hidden="true">
              🎬
            </span>
            <span className="text-lg font-bold">{t("gate.creator")}</span>
            <span className="text-sm text-muted-foreground">
              {t("gate.creator.body")}
            </span>
          </button>
        </div>
        <p className="text-center text-xs text-muted-foreground">
          {t("gate.hint")}
        </p>
      </div>
    </div>
  );
}

const SEL = "rounded-md border bg-background px-2 py-1 text-xs text-foreground";

/** Language + theme (+ optional mode switch). Safe to render in any layout. */
export function PrefBar({ withMode = false }: { withMode?: boolean }) {
  const t = useT();
  const lang = useLang();
  const [theme, setTheme] = useTheme();
  const audience = useAudience();
  const { admin } = useAdmin();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        className={SEL}
        aria-label={t("settings.lang")}
        value={lang}
        onChange={(e) =>
          saveSettings({
            ...getSettingsSnapshot(),
            lang: e.target.value as Lang,
          })
        }
      >
        {LANGS.map((l) => (
          <option key={l.id} value={l.id}>
            {l.label}
          </option>
        ))}
      </select>
      <select
        className={SEL}
        aria-label={t("settings.theme")}
        value={theme}
        onChange={(e) => setTheme(e.target.value as ThemeChoice)}
      >
        <option value="system">{t("settings.theme.system")}</option>
        <option value="light">☀ {t("settings.theme.light")}</option>
        <option value="dark">🌙 {t("settings.theme.dark")}</option>
      </select>
      {withMode &&
        (admin ? (
          <button
            className={`${SEL} hover:bg-accent`}
            onClick={() => void logoutAdmin()}
            title={t("admin.logout.signed")}
          >
            🔓 {t("admin.logout")}
          </button>
        ) : (
          <Link to="/admin" className={`${SEL} hover:bg-accent`}>
            🔒 {t("admin.login.link")}
          </Link>
        ))}
      {withMode && audience && (
        <button
          className={`${SEL} hover:bg-accent`}
          onClick={() =>
            setAudience(
              (audience === "viewer" ? "creator" : "viewer") as Audience,
            )
          }
        >
          {audience === "viewer" ? t("mode.toCreator") : t("mode.toViewer")}
        </button>
      )}
    </div>
  );
}
