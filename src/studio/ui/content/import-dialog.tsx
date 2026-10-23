// src/studio/ui/content/import-dialog.tsx
// Import flow: choose file -> parsed in the browser -> dry run of every chunk -> plan shown ->
// (confirm unpublish) -> commit -> downloadable JSON report. Nothing is written before the plan.
import { useEffect, useRef, useState } from "react";

import type { Cells } from "../../../shared/tabular";

import { useT } from "../../i18n/use-t";
import {
  postImport,
  type PlanRowDto,
  type PlanSummary,
} from "../../content/content-client";
import {
  buildImportRows,
  download,
  parseImportFile,
} from "../../content/files";
import { commitRun, dryRun, type DryRun } from "../../content/import-run";
import type { EntityType } from "../../../shared/schema-registry";
import { BTN, BTN_ACCENT, Check, INPUT_AUTO } from "../fields";
import { issueText, typeLabel } from "./labels";
import type { MessageKey } from "../../i18n/messages";

type Phase =
  | { s: "pick" }
  | { s: "working"; label: string }
  | { s: "plan"; dry: DryRun }
  | { s: "done"; summary: PlanSummary; rows: PlanRowDto[] }
  | { s: "error"; key: string };

const ACTIONS = [
  "create",
  "update",
  "unpublish",
  "skip",
  "conflict",
  "error",
] as const;
const SHOW_ROWS = 200;

export function ImportDialog({
  type,
  onClose,
  onDone,
  preloaded,
}: {
  type: EntityType;
  onClose: () => void;
  onDone: () => void;
  /** cells already read elsewhere (URL tree): skips the file step */
  preloaded?: Cells[];
}) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>({ s: "pick" });
  const [onMatch, setOnMatch] = useState<"draft" | "keep">("draft");
  const [confirm, setConfirm] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const rowsRef = useRef<ReturnType<typeof buildImportRows>>([]);
  const idRef = useRef(crypto.randomUUID());

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const err = (code: string) => `ct.imp.err.${code}`;

  const plan = async (
    rows: ReturnType<typeof buildImportRows>,
    match: "draft" | "keep",
  ) => {
    setPhase({ s: "working", label: t("ct.imp.parsing") });
    const r = await dryRun(
      postImport,
      type,
      rows,
      match,
      idRef.current,
      (d, n) => setPhase({ s: "working", label: t("ct.imp.dry", { i: d, n }) }),
    );
    setPhase(r.ok ? { s: "plan", dry: r } : { s: "error", key: err(r.error) });
  };

  const started = useRef(false);
  useEffect(() => {
    if (!preloaded || started.current) return;
    started.current = true;
    rowsRef.current = buildImportRows(type, preloaded);
    void plan(rowsRef.current, "draft");
    // runs once for the preloaded cells
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = async (f: File) => {
    setPhase({ s: "working", label: t("ct.imp.parsing") });
    const parsed = await parseImportFile(f, type);
    if (!parsed.ok) return setPhase({ s: "error", key: err(parsed.error) });
    rowsRef.current = buildImportRows(type, parsed.cells);
    await plan(rowsRef.current, onMatch);
  };

  const commit = async (dry: DryRun) => {
    setPhase({ s: "working", label: t("ct.imp.committing") });
    const r = await commitRun(postImport, type, dry, onMatch, confirm, (d, n) =>
      setPhase({ s: "working", label: t("ct.imp.commitingN", { i: d, n }) }),
    );
    if (r.ok) {
      setPhase({ s: "done", summary: r.summary, rows: r.rows });
      onDone();
    } else setPhase({ s: "error", key: err(r.error) });
  };

  const report = (rows: readonly PlanRowDto[], summary: PlanSummary) =>
    download(
      new Blob(
        [
          JSON.stringify(
            { type, at: new Date().toISOString(), summary, rows },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
      `import-report-${type}-${new Date().toISOString().slice(0, 10)}.json`,
    );

  const summaryLine = (s: PlanSummary) => (
    <ul className="flex flex-wrap gap-2 text-xs">
      {ACTIONS.map((a) => (
        <li
          key={a}
          className={`rounded-md px-2 py-1 ${a === "error" || a === "conflict" ? "bg-destructive/15" : a === "unpublish" ? "bg-primary/15" : "bg-secondary"}`}
        >
          <b>{s[a]}</b> {t(`ct.imp.sum.${a}` as MessageKey)}
        </li>
      ))}
    </ul>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("ct.imp.title")}
        className="max-h-full w-full max-w-3xl space-y-3 overflow-y-auto rounded-xl bg-background p-4 text-sm shadow-xl"
      >
        <h2 className="text-lg font-bold">
          {t("ct.imp.title")} · {typeLabel(t, type)}
        </h2>

        {phase.s === "pick" && (
          <div className="space-y-3">
            <label className="flex flex-wrap items-center gap-2 text-xs">
              {t("ct.imp.onMatch")}
              <select
                className={INPUT_AUTO}
                value={onMatch}
                onChange={(e) => setOnMatch(e.target.value as "draft" | "keep")}
              >
                <option value="draft">{t("ct.imp.onMatch.draft")}</option>
                <option value="keep">{t("ct.imp.onMatch.keep")}</option>
              </select>
            </label>
            <p className="text-xs text-muted-foreground">{t("ct.imp.rules")}</p>
            <button
              className={BTN_ACCENT}
              onClick={() => file.current?.click()}
            >
              ⬆ {t("ct.imp.choose")}
            </button>
            <input
              ref={file}
              type="file"
              accept=".csv,.xlsx,.json,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              aria-label={t("ct.imp.choose")}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void pick(f);
              }}
            />
          </div>
        )}

        {phase.s === "working" && (
          <p role="status" className="text-muted-foreground">
            {phase.label}
          </p>
        )}

        {phase.s === "plan" && (
          <div className="space-y-3">
            <p className="font-semibold">{t("ct.imp.plan")}</p>
            {summaryLine(phase.dry.summary)}
            <label className="flex flex-wrap items-center gap-2 text-xs">
              {t("ct.imp.onMatch")}
              <select
                className={INPUT_AUTO}
                value={onMatch}
                onChange={(e) => {
                  const m = e.target.value as "draft" | "keep";
                  setOnMatch(m);
                  setConfirm(false);
                  void plan(rowsRef.current, m);
                }}
              >
                <option value="draft">{t("ct.imp.onMatch.draft")}</option>
                <option value="keep">{t("ct.imp.onMatch.keep")}</option>
              </select>
            </label>
            <PlanTable rows={phase.dry.rows} t={t} />
            {phase.dry.summary.unpublish > 0 && (
              <div
                role="alert"
                className="rounded-md border border-primary p-2"
              >
                <Check checked={confirm} onChange={setConfirm}>
                  {t("ct.imp.confirmUnpublish", {
                    n: phase.dry.summary.unpublish,
                  })}
                </Check>
              </div>
            )}
          </div>
        )}

        {phase.s === "done" && (
          <div className="space-y-2" role="status">
            <p className="font-semibold">✓ {t("ct.imp.done")}</p>
            {summaryLine(phase.summary)}
            <button
              className={BTN}
              onClick={() => report(phase.rows, phase.summary)}
            >
              ⬇ {t("ct.imp.report")}
            </button>
          </div>
        )}

        {phase.s === "error" && (
          <p role="alert" className="text-destructive">
            {t(
              (phase.key in ERROR_KEYS
                ? phase.key
                : "ct.imp.err.generic") as MessageKey,
            )}
          </p>
        )}

        <div className="flex flex-wrap gap-2 border-t pt-3">
          {phase.s === "plan" && (
            <button
              className={BTN_ACCENT}
              disabled={
                phase.dry.summary.create +
                  phase.dry.summary.update +
                  phase.dry.summary.unpublish ===
                  0 ||
                (phase.dry.summary.unpublish > 0 && !confirm)
              }
              onClick={() => void commit(phase.dry)}
            >
              {t("ct.imp.commit")}
            </button>
          )}
          {(phase.s === "plan" || phase.s === "error") && (
            <button className={BTN} onClick={() => setPhase({ s: "pick" })}>
              {t("ct.imp.restart")}
            </button>
          )}
          <button className={BTN} onClick={onClose}>
            {phase.s === "done" ? t("ct.imp.close") : t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

const ERROR_KEYS: Record<string, true> = Object.fromEntries(
  [
    "too-large",
    "empty",
    "bad-file",
    "wrong-type",
    "newer-version",
    "too-many-rows",
    "xlsx-forbidden",
    "rate-limited",
    "plan-changed",
    "unpublish-not-confirmed",
    "network",
    "unauthorized",
    "store-unavailable",
    "generic",
    "bad-request",
  ].map((k) => [`ct.imp.err.${k}`, true as const]),
);

function PlanTable({
  rows,
  t,
}: {
  rows: readonly PlanRowDto[];
  t: ReturnType<typeof useT>;
}) {
  const interesting = rows.filter((r) => r.action !== "skip");
  if (interesting.length === 0)
    return (
      <p className="text-xs text-muted-foreground">{t("ct.imp.nothing")}</p>
    );
  return (
    <div className="max-h-72 overflow-auto rounded-md border">
      <table className="w-full text-left text-xs">
        <caption className="sr-only">{t("ct.imp.plan")}</caption>
        <thead className="sticky top-0 bg-secondary">
          <tr>
            <th scope="col" className="px-2 py-1">
              {t("ct.imp.row")}
            </th>
            <th scope="col" className="px-2 py-1">
              {t("ct.imp.action")}
            </th>
            <th scope="col" className="px-2 py-1">
              Slug
            </th>
            <th scope="col" className="px-2 py-1">
              {t("ct.imp.issues")}
            </th>
          </tr>
        </thead>
        <tbody>
          {interesting.slice(0, SHOW_ROWS).map((r) => (
            <tr key={r.n} className="border-t align-top">
              <td className="px-2 py-1 font-mono">{r.n}</td>
              <td className="px-2 py-1">
                {t(`ct.imp.sum.${r.action}` as MessageKey)}
              </td>
              <td className="px-2 py-1 font-mono">{r.slug}</td>
              <td className="px-2 py-1 text-destructive">
                {r.issues.map((i) => issueText(t, i)).join(" · ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {interesting.length > SHOW_ROWS && (
        <p className="p-2 text-xs text-muted-foreground">
          {t("ct.imp.more", { n: interesting.length - SHOW_ROWS })}
        </p>
      )}
    </div>
  );
}
