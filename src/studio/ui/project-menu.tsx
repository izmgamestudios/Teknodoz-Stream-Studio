// src/studio/ui/project-menu.tsx
// Project name + .pptdz export/import + reset.
import { useRef, useState } from "react";

import {
  exportPptdz,
  importPptdz,
  isPptdzError,
  suggestedFilename,
} from "../project";
import { downloadBlob } from "../engine/download";
import { useProject, useStudio } from "../runtime/use-studio";
import { BTN, INPUT } from "./fields";

const IMPORT_ERRORS: Record<string, string> = {
  "bad-magic": "Bu dosya bir .pptdz paketi değil.",
  "bad-version": "Paket sürümü desteklenmiyor.",
  corrupt: "Paket bozuk veya eksik.",
  "too-large": "Paket çok büyük.",
  "invalid-project": "Paketteki proje geçersiz.",
  "unsupported-asset": "Pakette desteklenmeyen bir dosya türü var.",
};

export function ProjectMenu() {
  const rt = useStudio();
  const project = useProject();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function onExport() {
    setBusy(true);
    setMsg(null);
    try {
      const { blob, missingAssets } = await exportPptdz(
        rt.project.getState(),
        rt.assets,
      );
      downloadBlob(blob, suggestedFilename(rt.project.getState()));
      setMsg({
        ok: missingAssets.length === 0,
        text:
          missingAssets.length > 0
            ? `Paket indirildi, ancak ${missingAssets.length} dosya kütüphanede bulunamadı.`
            : "Proje paketi indirildi.",
      });
    } catch (e) {
      setMsg({
        ok: false,
        text: isPptdzError(e)
          ? (IMPORT_ERRORS[e.code] ?? e.message)
          : "Dışa aktarılamadı.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function onImport(file: File) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await importPptdz(file, rt.assets, { mode: "merge" });
      rt.project.replaceProject(res.project);
      setMsg({
        ok: true,
        text: `Proje yüklendi (${res.importedAssets} dosya).${res.warnings.length ? ` ${res.warnings.length} uyarı.` : ""}`,
      });
    } catch (e) {
      setMsg({
        ok: false,
        text: isPptdzError(e)
          ? (IMPORT_ERRORS[e.code] ?? e.message)
          : "İçe aktarılamadı.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        aria-label="Proje adı"
        className={`${INPUT} max-w-52`}
        value={project.name}
        maxLength={120}
        onChange={(e) => rt.project.setProjectName(e.target.value)}
      />
      <button
        className={BTN}
        disabled={!rt.project.canUndo()}
        onClick={() => rt.project.undo()}
        title="Geri al"
      >
        ↶
      </button>
      <button
        className={BTN}
        disabled={!rt.project.canRedo()}
        onClick={() => rt.project.redo()}
        title="Yinele"
      >
        ↷
      </button>
      <button
        className={BTN}
        disabled={busy}
        onClick={() => void onExport()}
        title="Tüm sahneleri ve dosyaları .pptdz olarak indir"
      >
        ⬇ .pptdz
      </button>
      <button
        className={BTN}
        disabled={busy}
        onClick={() => fileRef.current?.click()}
        title=".pptdz projesi yükle"
      >
        ⬆ Aç
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".pptdz"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void onImport(f);
        }}
      />
      <button
        className={BTN}
        disabled={busy}
        onClick={() => {
          if (
            window.confirm(
              "Mevcut proje silinip varsayılan projeye dönülsün mü?",
            )
          )
            rt.project.resetProject();
        }}
      >
        Sıfırla
      </button>
      {msg && (
        <span
          role="status"
          className={`text-xs ${msg.ok ? "text-muted-foreground" : "text-destructive"}`}
        >
          {msg.text}
        </span>
      )}
    </div>
  );
}
