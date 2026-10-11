// src/components/app-shell.tsx
import { Link, useRouterState } from "@tanstack/react-router";
import { useSyncExternalStore, type ReactNode } from "react";

import { TeknodozLogo } from "@/components/teknodoz-logo";
import { useT } from "@/studio/i18n/use-t";
import type { MessageKey } from "@/studio/i18n/messages";
import { roomBadge } from "@/studio/room/badge";

const NAV: readonly {
  to: "/" | "/studio" | "/room" | "/settings";
  label: MessageKey;
  hint: MessageKey;
  icon: string;
}[] = [
  { to: "/", label: "nav.prompter", hint: "nav.prompter.hint", icon: "📜" },
  { to: "/studio", label: "nav.studio", hint: "nav.studio.hint", icon: "🎬" },
  { to: "/room", label: "nav.room", hint: "nav.room.hint", icon: "🚪" },
  {
    to: "/settings",
    label: "nav.settings",
    hint: "nav.settings.hint",
    icon: "⚙️",
  },
];

function NavLinks({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const waiting = useSyncExternalStore(
    roomBadge.subscribe,
    roomBadge.get,
    roomBadge.getServer,
  );
  return (
    <>
      {NAV.map((n, i) => (
        <Link
          key={n.to}
          to={n.to}
          activeOptions={{ exact: true }}
          className={
            compact
              ? "flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent"
              : "group flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          }
          activeProps={{
            className: compact
              ? "bg-secondary text-foreground"
              : "!border-speaker-b/40 bg-speaker-b/10 !text-foreground",
          }}
        >
          <span aria-hidden="true">{n.icon}</span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-semibold">
              {t(n.label)}
              {n.to === "/room" && waiting > 0 && (
                <span
                  className="ml-2 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground"
                  aria-label={t("shell.pending", { n: waiting })}
                >
                  {waiting}
                </span>
              )}
            </span>
            {!compact && (
              <span className="truncate text-xs text-muted-foreground">
                {t(n.hint)}
              </span>
            )}
          </span>
          {!compact && (
            <span className="text-[10px] tracking-widest text-muted-foreground">
              {String(i + 1).padStart(2, "0")} /{" "}
              {String(NAV.length).padStart(2, "0")}
            </span>
          )}
        </Link>
      ))}
    </>
  );
}

/** Pages opened by guests / phones: no studio navigation around them. */
const BARE_PREFIXES = ["/join", "/remote", "/r", "/chat"];

export function AppShell({ children }: { children: ReactNode }) {
  const t = useT();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (
    BARE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  ) {
    return <>{children}</>;
  }
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* desktop sidebar */}
      <aside className="sticky top-0 z-30 hidden h-screen w-72 shrink-0 flex-col border-r bg-card md:flex">
        <div className="flex items-center gap-3 border-b px-5 py-5">
          <TeknodozLogo className="text-xl" />
          <span className="h-5 w-px bg-border" />
          <span className="text-sm font-bold tracking-wide">STUDIO</span>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-4 py-6">
          <div>
            <p className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.25em] text-speaker-b">
              <span className="size-1.5 rounded-full bg-speaker-b" />{" "}
              {t("shell.workspace")}
            </p>
            <h2 className="text-2xl font-bold leading-tight">
              {t("shell.headline.a")}{" "}
              <span className="text-speaker-b">{t("shell.headline.b")}</span>
            </h2>
            <p className="mt-2 text-xs text-muted-foreground">
              {t("shell.tagline")}
            </p>
          </div>

          <nav className="space-y-1.5" aria-label={t("nav.menu")}>
            <p className="mb-2 flex justify-between text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground">
              {t("shell.modules")}
            </p>
            <NavLinks />
          </nav>
        </div>

        <div className="border-t px-5 py-4 text-[11px] leading-relaxed text-muted-foreground">
          <p>{t("shell.local")}</p>
          <p className="mt-1">© Teknodoz · IZM Game Studios</p>
        </div>
      </aside>

      {/* mobile top bar */}
      <header className="sticky top-0 z-30 border-b bg-card md:hidden">
        <div className="flex items-center gap-3 px-4 py-3">
          <TeknodozLogo className="text-lg" />
          <span className="text-xs font-bold tracking-wide">STUDIO</span>
        </div>
        <nav
          className="flex gap-1 overflow-x-auto px-3 pb-2"
          aria-label={t("nav.menu")}
        >
          <NavLinks compact />
        </nav>
      </header>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
