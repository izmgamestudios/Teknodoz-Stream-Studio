// src/studio/ui/workspace-backup.tsx
// Settings panel: download / restore the local workspace (script, scene + classic templates).
import { useRef, useState } from "react";

import { useT } from "../i18n/use-t";
import {
  applyWorkspace,
  collectWorkspace,
  parseWorkspace,
} from "../workspace/workspace";
import { BTN, Check, PANEL, PanelTitle } from "./fields";

export function WorkspaceBackup() {
  const t = useT();
  const file = useRef<HTMLInputElement>(null);
  const [replace, setReplace] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const download = () => {
    try {
      const data = collectWorkspace(window.localStorage);
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `teknodoz-workspace-${data.exportedAt.slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      setMsg({
        ok: true,
        text: t("ws.exported", { n: String(data.items.length) }),
      });
    } catch {
      setMsg({ ok: false, text: t("ws.err.storage") });
    }
  };

  const restore = async (f: File) => {
    const parsed = parseWorkspace(await f.text());
    if (!parsed.ok)
      return setMsg({
        ok: false,
        text: t(`ws.err.${parsed.error}` as "ws.err.invalid"),
      });
    try {
      const r = applyWorkspace(
        window.localStorage,
        parsed.file,
        replace ? "replace" : "merge",
      );
      setMsg({
        ok: true,
        text: t("ws.imported", { n: String(r.imported), s: String(r.skipped) }),
      });
    } catch {
      setMsg({ ok: false, text: t("ws.err.storage") });
    }
  };

  return (
    <section className={PANEL} aria-label={t("ws.title")}>
      <PanelTitle>{t("ws.title")}</PanelTitle>
      <p className="mb-2 text-xs text-muted-foreground">{t("ws.body")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button className={BTN} onClick={download}>
          ⬇ {t("ws.export")}
        </button>
        <button className={BTN} onClick={() => file.current?.click()}>
          ⬆ {t("ws.import")}
        </button>
        <Check checked={replace} onChange={setReplace}>
          {t("ws.replace")}
        </Check>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          aria-label={t("ws.import")}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void restore(f);
          }}
        />
      </div>
      {msg && (
        <p
          role={msg.ok ? "status" : "alert"}
          className={`mt-2 text-xs ${msg.ok ? "text-muted-foreground" : "text-destructive"}`}
        >
          {msg.text}
        </p>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">{t("ws.note")}</p>
    </section>
  );
}
