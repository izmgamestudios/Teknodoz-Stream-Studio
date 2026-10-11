// src/studio/ui/media-library.tsx
// IndexedDB-backed library: images/videos → layers, audio → music / sound effects.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  assetStoreBackend,
  estimateUsage,
  requestPersistence,
  type StorageUsage,
} from "../storage";
import { useAudioState, useStudio } from "../runtime/use-studio";
import type { AssetMeta } from "../types";
import { addAssetLayer, classifyFile, importFiles } from "./actions";
import { BTN, PANEL, PanelTitle } from "./fields";

function fmtSize(n: number): string {
  if (n > 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n > 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

const ICON = { image: "🖼", video: "🎞", audio: "🎵" } as const;

export function MediaLibrary({ onSelect }: { onSelect: (id: string) => void }) {
  const rt = useStudio();
  const audio = useAudioState();
  const fileRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<AssetMeta[]>([]);
  const [usage, setUsage] = useState<StorageUsage | undefined>();
  const [msg, setMsg] = useState("");
  const backend = useSyncExternalStore(
    () => () => undefined,
    () => assetStoreBackend(),
    () => "indexeddb" as const,
  );

  const refresh = useCallback(async () => {
    setItems(await rt.assets.list());
    setUsage(await estimateUsage());
  }, [rt]);

  useEffect(() => {
    void refresh();
    void requestPersistence();
  }, [refresh]);

  const playing = new Set(
    audio.channels.filter((c) => c.kind === "music").map((c) => c.id),
  );

  return (
    <section
      className={PANEL}
      aria-label="Medya kütüphanesi"
      onDragOver={(e) => e.preventDefault()}
      onDrop={async (e) => {
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files).filter((f) =>
          classifyFile(f),
        );
        if (files.length) {
          await importFiles(rt, files, false);
          await refresh();
        }
      }}
    >
      <PanelTitle
        aside={
          <button className={BTN} onClick={() => fileRef.current?.click()}>
            + Dosya
          </button>
        }
      >
        Medya kütüphanesi
      </PanelTitle>
      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*,audio/*"
        multiple
        hidden
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          const r = await importFiles(rt, files, false);
          setMsg(
            r.rejected.length ? `Eklenemedi: ${r.rejected.join(", ")}` : "",
          );
          await refresh();
        }}
      />
      {backend === "memory" && (
        <p role="alert" className="mb-2 text-xs text-destructive">
          Tarayıcı depolaması kullanılamıyor (gizli pencere?). Dosyalar sayfa
          yenilenince silinir.
        </p>
      )}
      {msg && <p className="mb-2 text-xs text-destructive">{msg}</p>}
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
          Logo, arka plan videosu, müzik ve ses efektlerini buraya sürükleyin.
          Dosyalar yalnızca bu tarayıcıda (IndexedDB) saklanır.
        </p>
      ) : (
        <ul className="max-h-56 space-y-1 overflow-y-auto">
          {items.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-1 rounded-md bg-secondary/60 px-1.5 py-1 text-xs"
            >
              <span aria-hidden>{ICON[a.type]}</span>
              <span className="min-w-0 flex-1 truncate" title={a.name}>
                {a.name}
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {fmtSize(a.size)}
              </span>
              {a.type === "audio" ? (
                <>
                  <button
                    className={`rounded px-1.5 py-0.5 ${playing.has(`music:${a.id}`) ? "bg-speaker-a text-background" : "bg-secondary hover:bg-accent"}`}
                    title="Arka plan müziği (döngü)"
                    onClick={() =>
                      void rt.toggleMusic(a.id, a.name.replace(/\.[^.]+$/, ""))
                    }
                  >
                    ♪
                  </button>
                  <button
                    className="rounded bg-secondary px-1.5 py-0.5 hover:bg-accent"
                    title="Ses efekti olarak çal"
                    onClick={() => void rt.playEffect(a.id)}
                  >
                    ▶
                  </button>
                </>
              ) : (
                <button
                  className="rounded bg-secondary px-1.5 py-0.5 hover:bg-accent"
                  title="Sahneye ekle"
                  onClick={() =>
                    onSelect(
                      addAssetLayer(
                        rt,
                        a.id,
                        a.type as "image" | "video",
                        a.name,
                      ),
                    )
                  }
                >
                  ＋
                </button>
              )}
              <button
                aria-label={`${a.name} dosyasını sil`}
                className="px-1 text-destructive hover:opacity-80"
                onClick={async () => {
                  if (
                    !window.confirm(
                      `“${a.name}” kütüphaneden silinsin mi? Bu dosyayı kullanan katmanlar boş kalır.`,
                    )
                  )
                    return;
                  if (a.type === "audio" && playing.has(`music:${a.id}`))
                    await rt.toggleMusic(a.id);
                  await rt.assets.delete(a.id);
                  await refresh();
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {usage && usage.quota > 0 && (
        <p className="mt-2 text-[10px] text-muted-foreground">
          Depolama: {fmtSize(usage.usage)} / {fmtSize(usage.quota)}
        </p>
      )}
    </section>
  );
}
