// src/classic/components/classic-nav.tsx
// Quick links from the Classic studio to every module of the main app.
import { Link } from "@tanstack/react-router";

const LINKS = [
  { to: "/studio", label: "🎬 Ana Stüdyo" },
  { to: "/room", label: "🚪 Oda" },
  { to: "/live", label: "📡 Canlı yayın" },
  { to: "/community", label: "🤝 Topluluk" },
  { to: "/guide", label: "📖 Kılavuz" },
  { to: "/download", label: "⬇️ İndir" },
  { to: "/settings", label: "⚙️ Ayarlar" },
] as const;

export function ClassicNav({ className = "" }: { className?: string }) {
  return (
    <nav aria-label="Modüller" className={`flex gap-1.5 overflow-x-auto pb-1 text-xs [scrollbar-width:thin] ${className}`}>
      {LINKS.map((l) => (
        <Link key={l.to} to={l.to} className="shrink-0 whitespace-nowrap rounded-md bg-secondary px-2.5 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
