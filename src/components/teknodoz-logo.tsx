// src/components/teknodoz-logo.tsx
import { cn } from "@/lib/utils";

/** The "O" glyph of the wordmark: an open ring with a small figure inside. */
function LogoGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 40" aria-hidden="true" className={cn("inline-block h-[1.15em] w-auto", className)} fill="none">
      <defs>
        <linearGradient id="tkz-glyph" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--speaker-b)" />
          <stop offset="1" stopColor="oklch(0.65 0.25 320)" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="17" r="12.5" stroke="url(#tkz-glyph)" strokeWidth="2.2" />
      <path d="M16 36 L9 27 H23 Z" fill="url(#tkz-glyph)" />
      <circle cx="16" cy="14" r="3" fill="oklch(0.65 0.25 320)" />
    </svg>
  );
}

export function TeknodozLogo({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Teknodoz"
      className={cn("inline-flex items-center text-2xl font-light uppercase leading-none tracking-[0.12em] text-speaker-b", className)}
    >
      <span aria-hidden="true">Tekn</span>
      <LogoGlyph className="mx-[0.08em]" />
      <span aria-hidden="true" className="text-[oklch(0.7_0.2_320)]">
        doz
      </span>
    </span>
  );
}
