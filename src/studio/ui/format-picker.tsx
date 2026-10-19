// src/studio/ui/format-picker.tsx
// Output format chips: 16:9 / 9:16 / 4:5 / 1:1 / 4:3. Switching re-lays the scenes out for the
// new stage (cameras and logos keep their aspect), and can be undone with Ctrl+Z.
import { FORMATS, formatOf } from "../format";
import {
  useProject,
  useRuntimeSnapshot,
  useStudio,
} from "../runtime/use-studio";
import { PANEL } from "./fields";

export function FormatPicker({ compact = false }: { compact?: boolean }) {
  const rt = useStudio();
  const out = useProject().settings.output;
  const recording = useRuntimeSnapshot().recorder?.status === "recording";
  const cur = formatOf(out.width, out.height);

  return (
    <div
      className={compact ? "" : PANEL}
      role="group"
      aria-label="Çıktı formatı"
    >
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="mr-1 font-semibold text-muted-foreground">Format</span>
        {FORMATS.map((f) => (
          <button
            key={f.id}
            title={`${f.label} · ${f.width}×${f.height} · ${f.hint}`}
            aria-pressed={cur?.id === f.id}
            disabled={recording}
            className={`rounded px-2 py-1 ${cur?.id === f.id ? "bg-speaker-b text-background" : "bg-secondary hover:bg-accent"} disabled:opacity-50`}
            onClick={() => rt.setOutputFormat(f.width, f.height)}
          >
            <span aria-hidden className="mr-1 inline-block align-middle">
              {f.orientation === "portrait"
                ? "▯"
                : f.orientation === "square"
                  ? "◻"
                  : "▭"}
            </span>
            {f.short}
          </button>
        ))}
        {!cur && (
          <span className="text-muted-foreground">
            özel {out.width}×{out.height}
          </span>
        )}
      </div>
      {!compact && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {cur
            ? `${cur.label} · ${cur.width}×${cur.height} · ${cur.hint}.`
            : "Ayarlar'dan özel boyut girildi."}{" "}
          {recording
            ? "Kayıt sürerken format değişmez."
            : "Sahneler yeni formata otomatik uyarlanır (geri alınabilir)."}
        </p>
      )}
    </div>
  );
}
