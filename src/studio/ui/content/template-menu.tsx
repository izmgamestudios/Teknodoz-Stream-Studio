// src/studio/ui/content/template-menu.tsx
// Blank-template download (CSV, CSV with `;` for Turkish Excel, XLSX, JSON). Generated in the
// browser from the schema registry: no server call.
import { useState } from "react";

import { useT } from "../../i18n/use-t";
import { buildTemplate, download, type FileFormat } from "../../content/files";
import type { EntityType } from "../../../shared/schema-registry";
import { BTN } from "../fields";
import type { MessageKey } from "../../i18n/messages";

export const FORMATS: readonly [FileFormat, MessageKey][] = [
  ["csv", "ct.fmt.csv"],
  ["csv-semicolon", "ct.fmt.csvSemi"],
  ["xlsx", "ct.fmt.xlsx"],
  ["json", "ct.fmt.json"],
];

export function readmeLines(t: ReturnType<typeof useT>): string[] {
  return (
    [
      "ct.readme.1",
      "ct.readme.2",
      "ct.readme.3",
      "ct.readme.4",
      "ct.readme.5",
      "ct.readme.6",
    ] as const
  ).map((k) => t(k));
}

export function FormatMenu({
  label,
  onPick,
  disabled,
}: {
  label: string;
  onPick: (f: FileFormat) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const t = useT();
  return (
    <span className="relative inline-block">
      <button
        type="button"
        className={BTN}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
      >
        {label} ▾
      </button>
      {open && (
        <ul
          role="menu"
          className="absolute left-0 z-20 mt-1 min-w-48 rounded-md border bg-card p-1 text-xs shadow-lg"
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        >
          {FORMATS.map(([f, key]) => (
            <li key={f} role="none">
              <button
                role="menuitem"
                type="button"
                className="block w-full rounded px-2 py-1.5 text-left hover:bg-accent"
                onClick={() => {
                  setOpen(false);
                  onPick(f);
                }}
              >
                {t(key)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

export function TemplateMenu({ type }: { type: EntityType }) {
  const t = useT();
  return (
    <FormatMenu
      label={`⬇ ${t("ct.template")}`}
      onPick={(f) => {
        const file = buildTemplate(type, f, readmeLines(t));
        download(file.blob, file.filename);
      }}
    />
  );
}
