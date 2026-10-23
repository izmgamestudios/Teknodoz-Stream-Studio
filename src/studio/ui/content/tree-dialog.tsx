// src/studio/ui/content/tree-dialog.tsx
// URL tree import / export for the `source` table. Import converts the tree to rows and hands
// them to the normal import flow (dry run first, drafts only). Export: text, JSON, sitemap.xml
// (public nodes only).
import { useRef, useState } from "react";

import { useT } from "../../i18n/use-t";
import type { MessageKey } from "../../i18n/messages";
import { listContent } from "../../content/content-client";
import { download } from "../../content/files";
import {
  MAX_TREE_NODES,
  TreeParseError,
  parseTree,
  rowsToTree,
  treeSitemap,
  treeToCells,
  treeToJson,
  treeToText,
} from "../../../shared/url-tree";
import type { Cells } from "../../../shared/tabular";
import { BTN, BTN_ACCENT, INPUT } from "../fields";
import { ImportDialog } from "./import-dialog";

const SAMPLE =
  "- Teknodoz | https://teknodoz.example.org | private | marka\n  - Blog | https://teknodoz.example.org/blog\n";

export function TreeDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cells, setCells] = useState<Cells[] | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  if (cells)
    return (
      <ImportDialog
        type="source"
        preloaded={cells}
        onClose={onClose}
        onDone={onDone}
      />
    );

  const next = () => {
    try {
      setCells(treeToCells(parseTree(text)));
    } catch (e) {
      if (e instanceof TreeParseError)
        setError(
          `${t(`ct.tree.err.${e.code}` as MessageKey, { n: MAX_TREE_NODES })}${e.line ? ` (${t("ct.imp.row")} ${e.line})` : ""}`,
        );
      else setError(t("ct.tree.err.bad-line"));
    }
  };

  const exportAs = async (kind: "text" | "json" | "sitemap") => {
    setBusy(true);
    const rows = [];
    for (let p = 1; p <= 50; p++) {
      const r = await listContent({
        type: "source",
        page: p,
        perPage: 100,
        sort: "created_desc",
      });
      if (!r.ok) break;
      rows.push(...r.data.items);
      if (!r.data.hasMore) break;
    }
    setBusy(false);
    // parents before children keeps the text stable between exports
    const ordered = [...rows].reverse();
    if (kind === "sitemap")
      download(
        new Blob([treeSitemap(ordered)], { type: "application/xml" }),
        "sources-sitemap.xml",
      );
    else {
      const tree = rowsToTree(ordered);
      if (kind === "json")
        download(
          new Blob([treeToJson(tree)], { type: "application/json" }),
          "sources-tree.json",
        );
      else
        download(
          new Blob([treeToText(tree)], { type: "text/plain;charset=utf-8" }),
          "sources-tree.txt",
        );
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("ct.tree.title")}
        className="max-h-full w-full max-w-2xl space-y-3 overflow-y-auto rounded-xl bg-background p-4 text-sm shadow-xl"
      >
        <h2 className="text-lg font-bold">🌳 {t("ct.tree.title")}</h2>
        <p className="text-xs text-muted-foreground">{t("ct.tree.help")}</p>
        <textarea
          className={`${INPUT} font-mono`}
          rows={10}
          aria-label={t("ct.tree.title")}
          placeholder={SAMPLE}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
        />
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button className={BTN_ACCENT} disabled={!text.trim()} onClick={next}>
            {t("ct.tree.preview")}
          </button>
          <button className={BTN} onClick={() => file.current?.click()}>
            ⬆ {t("ct.tree.file")}
          </button>
          <input
            ref={file}
            type="file"
            accept=".txt,.json,text/plain,application/json"
            className="sr-only"
            aria-label={t("ct.tree.file")}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f && f.size < 2_000_000) setText(await f.text());
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <span className="text-xs font-semibold">{t("ct.tree.export")}</span>
          <button
            className={BTN}
            disabled={busy}
            onClick={() => void exportAs("text")}
          >
            {t("ct.tree.exportText")}
          </button>
          <button
            className={BTN}
            disabled={busy}
            onClick={() => void exportAs("json")}
          >
            JSON
          </button>
          <button
            className={BTN}
            disabled={busy}
            onClick={() => void exportAs("sitemap")}
          >
            sitemap.xml
          </button>
          <button className={`${BTN} ml-auto`} onClick={onClose}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
