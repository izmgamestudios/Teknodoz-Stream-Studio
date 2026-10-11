// src/studio/ui/fields.tsx
// Small form primitives shared by the studio panels (Tailwind, app theme tokens).
import { useEffect, useState, type ReactNode } from "react";

export const BTN =
  "inline-flex items-center justify-center gap-1.5 rounded-md bg-secondary px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40";
export const BTN_PRIMARY =
  "inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";
export const BTN_ACCENT =
  "inline-flex items-center justify-center gap-1.5 rounded-md bg-speaker-b px-3 py-1.5 text-xs font-bold text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";
export const INPUT =
  "w-full rounded-md border bg-background px-2 py-1 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring";
export const PANEL = "rounded-xl border bg-card p-3";

export function PanelTitle({
  children,
  aside,
}: {
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
        {children}
      </h2>
      {aside}
    </div>
  );
}

export function Field({
  label,
  children,
  inline = false,
}: {
  label: string;
  children: ReactNode;
  inline?: boolean;
}) {
  return (
    <label
      className={
        inline
          ? "flex items-center justify-between gap-2 text-xs"
          : "block text-xs"
      }
    >
      <span className="mb-1 block text-[11px] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

/** Number input that keeps a local draft while typing and commits valid numbers only. */
export function NumInput({
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const [draft, setDraft] = useState(String(Math.round(value * 100) / 100));
  useEffect(() => setDraft(String(Math.round(value * 100) / 100)), [value]);
  return (
    <input
      type="number"
      className={INPUT}
      value={draft}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value !== "" && Number.isFinite(n)) {
          onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)));
        }
      }}
    />
  );
}

export function RangeInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
}) {
  return (
    <input
      type="range"
      aria-label={label}
      className="w-full accent-[var(--speaker-b)]"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

export function Check({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-[var(--speaker-b)]"
      />
      {children}
    </label>
  );
}

export function SelectInput<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: string }[];
}) {
  return (
    <select
      className={INPUT}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** <input type=color> only accepts #rrggbb; non-hex CSS colors show as black but stay untouched. */
export function ColorInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const hex = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000";
  return (
    <input
      type="color"
      value={hex}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 w-full cursor-pointer rounded-md border bg-background p-0.5"
    />
  );
}

export function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
