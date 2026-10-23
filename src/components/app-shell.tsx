// src/components/app-shell.tsx
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";

import { BrandBadge, BrandLogo, useBrand } from "@/studio/ui/brand-context";
import { useT } from "@/studio/i18n/use-t";
import type { MessageKey } from "@/studio/i18n/messages";
import { roomBadge } from "@/studio/room/badge";
import { loadOverrides } from "@/studio/i18n/overrides";
import { useAudience, VIEWER_ROUTES } from "@/studio/audience";
import { useAdmin } from "@/studio/watch/admin-session";
import { AudienceGate, PrefBar } from "@/studio/ui/audience-gate";

const NAV: readonly {
  to:
    | "/"
    | "/watch"
    | "/admin"
    | "/studio"
    | "/classic"
    | "/room"
    | "/live"
    | "/podcast"
    | "/community"
    | "/guide"
    | "/download"
    | "/settings";
  label: MessageKey;
  hint: MessageKey;
  icon: string;
}[] = [
  { to: "/watch", label: "nav.watch", hint: "nav.watch.hint", icon: "📺" },
  { to: "/", label: "nav.prompter", hint: "nav.prompter.hint", icon: "📜" },
  { to: "/studio", label: "nav.studio", hint: "nav.studio.hint", icon: "🎬" },
  {
    to: "/classic",
    label: "nav.classic",
    hint: "nav.classic.hint",
    icon: "🎛️",
  },
  { to: "/room", label: "nav.room", hint: "nav.room.hint", icon: "🚪" },
  { to: "/live", label: "nav.live", hint: "nav.live.hint", icon: "📡" },
  {
    to: "/podcast",
    label: "nav.podcast",
    hint: "nav.podcast.hint",
    icon: "🎙️",
  },
  {
    to: "/community",
    label: "nav.community",
    hint: "nav.community.hint",
    icon: "🤝",
  },
  {
    to: "/guide",
    label: "nav.guide",
    hint: "nav.guide.hint",
    icon: "📖",
  },
  {
    to: "/download",
    label: "nav.download",
    hint: "nav.download.hint",
    icon: "⬇️",
  },
  {
    to: "/admin",
    label: "nav.admin",
    hint: "nav.admin.hint",
    icon: "🗄️",
  },
  {
    to: "/settings",
    label: "nav.settings",
    hint: "nav.settings.hint",
    icon: "⚙️",
  },
];

function NavLinks({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const audience = useAudience();
  // viewers see the end-user pages only; creators (and the not-yet-decided) see everything
  const { admin } = useAdmin();
  // administration is only visible to a signed-in administrator
  const nav = (
    audience === "viewer"
      ? NAV.filter((n) => VIEWER_ROUTES.includes(n.to))
      : NAV.filter((n) => n.to !== "/watch" || audience === "creator")
  ).filter((n) => n.to !== "/admin" || admin === true);
  const badge = useSyncExternalStore(
    roomBadge.subscribe,
    roomBadge.get,
    roomBadge.getServer,
  );
  return (
    <>
      {nav.map((n, i) => (
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
              {n.to === "/room" && badge.waiting > 0 && (
                <span
                  className="ml-2 rounded-full bg-primary-solid px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground"
                  aria-label={t("shell.pending", { n: badge.waiting })}
                >
                  {badge.waiting}
                </span>
              )}
              {n.to === "/room" && badge.chat > 0 && (
                <span
                  className="ml-1.5 rounded-full bg-speaker-b px-1.5 py-0.5 text-[10px] font-bold text-background"
                  aria-label={t("shell.pendingChat", { n: badge.chat })}
                >
                  💬 {badge.chat}
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
              {String(nav.length).padStart(2, "0")}
            </span>
          )}
        </Link>
      ))}
    </>
  );
}

/** Pages opened by guests / phones: no studio navigation around them. */
const BARE_PREFIXES = [
  "/join",
  "/remote",
  "/r",
  "/chat",
  "/classic/join",
  "/classic/remote",
];

/** Slogan with its last word highlighted (the translated default when no slogan is set). */
function useHeadline(): { a: string; b: string } {
  const t = useT();
  const { slogan } = useBrand();
  if (!slogan) return { a: t("shell.headline.a"), b: t("shell.headline.b") };
  const i = slogan.lastIndexOf(" ");
  return i < 0
    ? { a: "", b: slogan }
    : { a: slogan.slice(0, i), b: slogan.slice(i + 1) };
}

export function AppShell({ children }: { children: ReactNode }) {
  const t = useT();
  const brand = useBrand();
  const head = useHeadline();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const audience = useAudience();
  const navigate = useNavigate();
  // texts edited on the server (/translations) override the built-in ones
  useEffect(() => {
    void loadOverrides();
  }, []);
  // viewers land on the watch page instead of the prompter
  useEffect(() => {
    if (audience === "viewer" && pathname === "/")
      void navigate({ to: "/watch", replace: true });
  }, [audience, pathname, navigate]);
  if (
    BARE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  ) {
    return <>{children}</>;
  }
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary-solid focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        {t("a11y.skip")}
      </a>
      {/* desktop sidebar */}
      <aside
        aria-label={t("a11y.sidebar")}
        className="sticky top-0 z-30 hidden h-screen w-72 shrink-0 flex-col border-r bg-card md:flex"
      >
        <div className="space-y-2 border-b px-5 py-5">
          <div className="flex items-center gap-3">
            <BrandLogo className="text-xl" />
            {brand.productLabel && (
              <>
                <span className="h-5 w-px bg-border" />
                <span className="text-sm font-bold tracking-wide">
                  {brand.productLabel}
                </span>
              </>
            )}
          </div>
          <BrandBadge />
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-4 py-6">
          <div>
            <p className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.25em] text-speaker-b">
              <span className="size-1.5 rounded-full bg-speaker-b" />{" "}
              {t("shell.workspace")}
            </p>
            <h2 className="text-2xl font-bold leading-tight">
              {head.a} <span className="text-speaker-b">{head.b}</span>
            </h2>
            <p className="mt-2 text-xs text-muted-foreground">
              {brand.tagline || t("shell.tagline")}
            </p>
          </div>

          <nav className="space-y-1.5" aria-label={t("nav.menu")}>
            <p className="mb-2 flex justify-between text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground">
              {t("shell.modules")}
            </p>
            <NavLinks />
          </nav>
        </div>

        <div className="space-y-2 border-t px-5 py-3">
          <PrefBar withMode />
        </div>
        <div className="border-t px-5 py-4 text-[11px] leading-relaxed text-muted-foreground">
          <p>{t("shell.local")}</p>
          <p className="mt-1">© Teknodoz · IZM Game Studios</p>
        </div>
      </aside>

      {/* mobile top bar */}
      <header className="sticky top-0 z-30 border-b bg-card md:hidden">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
          <BrandLogo className="text-lg" />
          {brand.productLabel && (
            <span className="text-xs font-bold tracking-wide">
              {brand.productLabel}
            </span>
          )}
          <BrandBadge />
          <span className="ml-auto">
            <PrefBar withMode />
          </span>
        </div>
        <nav
          className="flex gap-1 overflow-x-auto px-3 pb-2"
          aria-label={t("nav.menu")}
        >
          <NavLinks compact />
        </nav>
      </header>

      <main id="main" tabIndex={-1} className="min-w-0 flex-1 outline-none">
        {children}
      </main>
      <AudienceGate />
    </div>
  );
}
