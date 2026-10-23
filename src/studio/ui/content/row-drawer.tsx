// src/studio/ui/content/row-drawer.tsx
// Single-row editor: one form generated from the schema registry (no per-type code).
import { useEffect, useMemo, useRef, useState } from "react";

import { useT } from "../../i18n/use-t";
import { saveContent, type ContentRow } from "../../content/content-client";
import {
  CLEAR,
  cellsToInput,
  rowToCells,
  templateColumns,
  type Cells,
} from "../../../shared/tabular";
import type { EntityType } from "../../../shared/schema-registry";
import { BTN, BTN_ACCENT, Check, INPUT, INPUT_AUTO } from "../fields";
import { fieldLabel, issueText, typeLabel } from "./labels";
import type { MessageKey } from "../../i18n/messages";

interface Faq {
  q: string;
  a: string;
}

const HIDDEN = new Set(["id", "faq"]);

export function RowDrawer({
  type,
  row,
  onClose,
  onSaved,
}: {
  type: EntityType;
  row: ContentRow | null;
  onClose: () => void;
  onSaved: (row: ContentRow) => void;
}) {
  const t = useT();
  const original = useMemo<Cells>(
    () => (row ? rowToCells(type, row) : {}),
    [row, type],
  );
  const columns = useMemo(
    () => templateColumns(type).filter((c) => !HIDDEN.has(c.key)),
    [type],
  );
  const [cells, setCells] = useState<Cells>(original);
  const [faq, setFaq] = useState<Faq[]>(() =>
    Array.isArray(row?.meta["faq"]) ? (row!.meta["faq"] as Faq[]) : [],
  );
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const set = (k: string, v: string) => setCells((c) => ({ ...c, [k]: v }));

  const submit = async () => {
    setBusy(true);
    setErrors([]);
    // an emptied field that had a value must be cleared, not left unchanged
    const out: Cells = {};
    for (const { key } of columns) {
      const now = cells[key] ?? "";
      out[key] = now === "" && (original[key] ?? "") !== "" ? CLEAR : now;
    }
    const cleanFaq = faq.filter((f) => f.q.trim() && f.a.trim());
    out["faq"] = cleanFaq.length
      ? JSON.stringify(cleanFaq)
      : (original["faq"] ?? "") !== ""
        ? CLEAR
        : "";
    const { input, issues } = cellsToInput(type, out);
    if (issues.length) {
      setErrors(issues.map((i) => `${i.column}: ${issueText(t, i.code)}`));
      setBusy(false);
      return;
    }
    const r = await saveContent(row?.id ?? null, type, input);
    setBusy(false);
    if (r.ok) {
      onSaved(r.data.item);
      return;
    }
    if (r.error === "slug-taken") setErrors([t("ct.err.slug")]);
    else if (r.error === "external-id-taken") setErrors([t("ct.err.ext")]);
    else if (r.error === "invalid" && r.issues?.length) setErrors(r.issues);
    else setErrors([t("ct.err.generic")]);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={row ? t("ct.drawer.edit") : t("ct.drawer.new")}
        className="h-full w-full max-w-xl overflow-y-auto bg-background p-4 shadow-xl"
      >
        <h2 className="mb-3 text-lg font-bold">
          {row ? t("ct.drawer.edit") : t("ct.drawer.new")} ·{" "}
          {typeLabel(t, type)}
        </h2>
        <form
          className="space-y-3 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {columns.map(({ key, def }, i) => {
            const label = fieldLabel(t, key);
            const value = cells[key] ?? "";
            const id = `f-${key}`;
            if (def.kind === "bool")
              return (
                <Check
                  key={key}
                  checked={value === "true"}
                  onChange={(v) => set(key, v ? "true" : "false")}
                >
                  {label}
                </Check>
              );
            return (
              <label key={key} htmlFor={id} className="block">
                <span className="text-xs font-semibold">{label}</span>
                {def.kind === "select" ? (
                  <select
                    id={id}
                    className={`${INPUT_AUTO} mt-1 block`}
                    value={value}
                    onChange={(e) => set(key, e.target.value)}
                  >
                    <option value="">—</option>
                    {(key === "visibility"
                      ? [
                          "draft",
                          "private",
                          "public",
                          ...(value === "protected" ? ["protected"] : []),
                        ]
                      : (def.options ?? [])
                    ).map((o) => (
                      <option key={o} value={o}>
                        {key === "visibility"
                          ? t(`ct.vis.${o}` as MessageKey)
                          : o}
                      </option>
                    ))}
                  </select>
                ) : def.kind === "longtext" ? (
                  <textarea
                    id={id}
                    className={`${INPUT} mt-1 font-mono`}
                    rows={key === "body_md" ? 10 : 3}
                    value={value}
                    maxLength={def.max}
                    onChange={(e) => set(key, e.target.value)}
                  />
                ) : (
                  <input
                    id={id}
                    ref={i === 0 ? first : undefined}
                    className={`${INPUT} mt-1`}
                    type={
                      def.kind === "number"
                        ? "text"
                        : def.kind === "date"
                          ? "date"
                          : "text"
                    }
                    inputMode={def.kind === "number" ? "decimal" : undefined}
                    value={def.kind === "date" ? value.slice(0, 10) : value}
                    maxLength={def.kind === "tags" ? undefined : def.max}
                    placeholder={
                      key === "slug"
                        ? t("ct.hint.slug")
                        : def.kind === "tags"
                          ? t("ct.hint.tags")
                          : undefined
                    }
                    onChange={(e) => set(key, e.target.value)}
                  />
                )}
                {key === "summary" && (
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    {t("ct.hint.summary")}
                  </span>
                )}
              </label>
            );
          })}

          <fieldset className="space-y-2 rounded-lg border p-2">
            <legend className="px-1 text-xs font-semibold">
              {fieldLabel(t, "faq")}
            </legend>
            {faq.map((f, i) => (
              <div key={i} className="space-y-1">
                <input
                  className={INPUT}
                  aria-label={t("ct.faq.q")}
                  placeholder={t("ct.faq.q")}
                  maxLength={200}
                  value={f.q}
                  onChange={(e) =>
                    setFaq(
                      faq.map((x, j) =>
                        j === i ? { ...x, q: e.target.value } : x,
                      ),
                    )
                  }
                />
                <textarea
                  className={INPUT}
                  aria-label={t("ct.faq.a")}
                  placeholder={t("ct.faq.a")}
                  rows={2}
                  maxLength={1000}
                  value={f.a}
                  onChange={(e) =>
                    setFaq(
                      faq.map((x, j) =>
                        j === i ? { ...x, a: e.target.value } : x,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  className={BTN}
                  onClick={() => setFaq(faq.filter((_, j) => j !== i))}
                >
                  {t("ct.faq.remove")}
                </button>
              </div>
            ))}
            {faq.length < 10 && (
              <button
                type="button"
                className={BTN}
                onClick={() => setFaq([...faq, { q: "", a: "" }])}
              >
                ＋ {t("ct.faq.add")}
              </button>
            )}
          </fieldset>

          {errors.length > 0 && (
            <ul role="alert" className="space-y-0.5 text-xs text-destructive">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <button className={BTN_ACCENT} type="submit" disabled={busy}>
              {t("ct.save")}
            </button>
            <button className={BTN} type="button" onClick={onClose}>
              {t("common.cancel")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
