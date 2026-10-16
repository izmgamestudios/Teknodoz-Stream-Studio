// src/components/app-shell.tsx
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { TeknodozLogo } from "@/components/teknodoz-logo";
import { TeknodozProjects } from "@/components/TeknodozProjects";

const NAV = [
  { to: "/", label: "Prompter", hint: "Metin, kamera, kayıt", icon: "📜" },
  { to: "/studio", label: "Stüdyo", hint: "Logo, müzik, efekt", icon: "🎬" },
] as const;

function NavLinks({ compact = false }: { compact?: boolean }) {
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
            <span className="font-semibold">{n.label}</span>
            {!compact && <span className="truncate text-xs text-muted-foreground">{n.hint}</span>}
          </span>
          {!compact && (
            <span className="text-[10px] tracking-widest text-muted-foreground">
              {String(i + 1).padStart(2, "0")} / {String(NAV.length).padStart(2, "0")}
            </span>
          )}
        </Link>
      ))}
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
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
              <span className="size-1.5 rounded-full bg-speaker-b" /> Yayıncı çalışma alanı
            </p>
            <h2 className="text-2xl font-bold leading-tight">
              Yayını <span className="text-speaker-b">sahnede kur.</span>
            </h2>
            <p className="mt-2 text-xs text-muted-foreground">
              Prompter, kayıt ve stüdyo tek yerde. Her şey tarayıcında kalır.
            </p>
          </div>

          <nav className="space-y-1.5" aria-label="Ana menü">
            <p className="mb-2 flex justify-between text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground">
              Modüller
            </p>
            <NavLinks />
          </nav>

          <TeknodozProjects current="teknodoz-stream-studio" />
        </div>

        <div className="border-t px-5 py-4 text-[11px] leading-relaxed text-muted-foreground">
          <p>100% client-side · gizlilik odaklı</p>
          <p className="mt-1">© Teknodoz · IZM Game Studios</p>
        </div>
      </aside>

      {/* mobile top bar */}
      <header className="sticky top-0 z-30 border-b bg-card md:hidden">
        <div className="flex items-center gap-3 px-4 py-3">
          <TeknodozLogo className="text-lg" />
          <span className="text-xs font-bold tracking-wide">STUDIO</span>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2" aria-label="Ana menü">
          <NavLinks compact />
        </nav>
      </header>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
