// src/studio/ui/my-templates.tsx
// "Benim şablonlarım": save the active scene, reuse it later in any format.
import { useEffect, useState } from "react";

import { FORMATS } from "../format";
import { useStudio } from "../runtime/use-studio";
import type { MyTemplate } from "../templates/mine";
import type { TemplateMode } from "../templates/types";
import { BTN } from "./fields";

export function MyTemplates({
  mode,
  onApplied,
}: {
  mode: TemplateMode;
  onApplied: () => void;
}) {
  const rt = useStudio();
  const [list, setList] = useState<MyTemplate[]>([]);
  const [msg, setMsg] = useState("");
  const refresh = () => setList(rt.getMyTemplates());
  useEffect(refresh, [rt]);

  const formatOfStage = (t: MyTemplate) =>
    FORMATS.find((f) => {
      const ratio = f.width / f.height;
      return Math.abs(ratio - t.stage.w / t.stage.h) < 0.02;
    })?.short ?? `${t.stage.w}×${t.stage.h}`;

  const save = () => {
    const name = window.prompt("Şablon adı?", "Benim sahnem");
    if (!name?.trim()) return;
    setMsg(
      rt.saveActiveSceneAsTemplate(name)
        ? "Kaydedildi."
        : "Kaydedilemedi (ad boş ya da tarayıcı depolaması dolu).",
    );
    refresh();
  };

  return (
    <div>
      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground">
        ★ Benim şablonlarım
      </p>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={BTN}
          onClick={save}
          title="Aktif sahnenin düzenini bu tarayıcıda sakla"
        >
          + Aktif sahneyi şablon olarak kaydet
        </button>
        {msg && (
          <span role="status" className="text-xs text-muted-foreground">
            {msg}
          </span>
        )}
      </div>
      {list.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Henüz kayıtlı şablon yok. Bir sahne kur, sonra buradan kaydet; başka
          projede ve başka formatta da kullanabilirsin.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-2 rounded-lg border p-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {t.name}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {formatOfStage(t)} · {t.scene.layers.length} katman
                </span>
              </span>
              <button
                type="button"
                className={BTN}
                onClick={() => {
                  if (rt.applyMyTemplate(t.id, mode)) onApplied();
                  else setMsg("Uygulanamadı (sahne/katman sınırı?).");
                }}
              >
                Uygula
              </button>
              <button
                type="button"
                aria-label={`${t.name} şablonunu sil`}
                className={`${BTN} hover:bg-destructive`}
                onClick={() => {
                  if (window.confirm(`“${t.name}” şablonu silinsin mi?`)) {
                    rt.deleteMyTemplate(t.id);
                    refresh();
                  }
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
