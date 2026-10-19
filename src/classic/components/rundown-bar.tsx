// src/components/rundown-bar.tsx
export type RundownEntry = { id: string; name: string };

type Props = {
  items: RundownEntry[];
  live: number;
  editing: number;
  onEdit(i: number): void;
  onLive(i: number): void;
  onAdd(): void;
  onUpdate(): void;
  onRename(i: number): void;
  onMove(i: number, dir: -1 | 1): void;
  onDelete(i: number): void;
  onNext(): void;
  onPrev(): void;
  onExport?: () => void;
  note?: string;
};

/** Ordered scene list: tap a scene to edit it, ▶ to send it live, N / P for next / previous. */
export function RundownBar({ items, live, editing, onEdit, onLive, onAdd, onUpdate, onRename, onMove, onDelete, onNext, onPrev, onExport, note }: Props) {
  const b = "rounded bg-accent px-2 py-1 text-sm hover:brightness-110 disabled:opacity-40";
  return (
    <section className="mb-4 rounded-xl border bg-card p-3" aria-label="Sahne listesi">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-semibold">🎞 Sahne listesi <span className="text-xs font-normal text-muted-foreground">(N: sıradaki · P: önceki)</span></h2>
        <button onClick={onPrev} disabled={!items.length} className={b}>⏮ Önceki</button>
        <button onClick={onNext} disabled={!items.length} className={`${b} bg-speaker-b font-semibold text-background`}>⏭ Sıradaki</button>
        <button onClick={onAdd} className={b}>+ Taslağı ekle</button>
        {onExport && (
          <button onClick={onExport} disabled={!items.length} className={b} title="Sahneleri ana Stüdyo'ya aktarır (açıksa anında, kapalıysa bir sonraki açılışta)">⇄ Ana Stüdyo'ya gönder</button>
        )}
        <button onClick={onUpdate} disabled={editing < 0} className={b} title="Seçili sahneyi taslakla güncelle">↻ Sahneyi güncelle</button>
      </div>
      {note && <p className="mb-2 text-xs text-speaker-b" role="status">{note}</p>}
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Henüz sahne yok. Taslağı kurup “+ Taslağı ekle” de.</p>
      ) : (
        <ol className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
          {items.map((it, i) => (
            <li key={it.id} className={`flex shrink-0 flex-col gap-1 rounded-lg border p-2 ${live === i ? "border-primary bg-primary/10" : editing === i ? "border-speaker-b bg-speaker-b/10" : "bg-secondary"}`}>
              <button onClick={() => onEdit(i)} onDoubleClick={() => onRename(i)} className="max-w-40 truncate text-left text-sm font-semibold" title="Düzenlemek için tıkla, adı değiştirmek için çift tıkla">
                {live === i && <span className="mr-1 text-primary">●</span>}{i + 1}. {it.name}
              </button>
              <span className="flex items-center gap-1">
                <button onClick={() => onLive(i)} aria-label={`${it.name} sahnesini yayına al`} className="rounded bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">▶ Yayına</button>
                <button onClick={() => onMove(i, -1)} disabled={i === 0} aria-label="Sola taşı" className={`${b} px-1.5 py-0.5 text-xs`}>←</button>
                <button onClick={() => onMove(i, 1)} disabled={i === items.length - 1} aria-label="Sağa taşı" className={`${b} px-1.5 py-0.5 text-xs`}>→</button>
                <button onClick={() => onDelete(i)} aria-label={`${it.name} sahnesini sil`} className="rounded bg-accent px-1.5 py-0.5 text-xs hover:bg-destructive">×</button>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
