// src/studio/ui/content/table-engine.tsx
// One generic admin table for every catalog type, driven by the schema registry. Server-side
// paging / filtering / sorting (filters live in the URL), row selection with shift-range, a row
// drawer, blank templates, import and export. No per-type code.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useT } from "../../i18n/use-t";
import type { MessageKey } from "../../i18n/messages";
import {
  deleteContent,
  listContent,
  restoreContent,
  type ContentRow,
  type ListResult,
} from "../../content/content-client";
import { buildExport, download, type FileFormat } from "../../content/files";
import { LOCALES, type EntityType } from "../../../shared/schema-registry";
import { BTN, BTN_ACCENT, Check, INPUT_AUTO, PANEL } from "../fields";
import { ImportDialog } from "./import-dialog";
import { typeLabel } from "./labels";
import { RowDrawer } from "./row-drawer";
import { FormatMenu, TemplateMenu, readmeLines } from "./template-menu";

export interface TableSearch {
  q?: string | undefined;
  visibility?: string | undefined;
  locale?: string | undefined;
  sort?: "updated_desc" | "created_desc" | "title_asc" | undefined;
  page?: number | undefined;
  trash?: boolean | undefined;
}

const PER_PAGE = 50;
const MAX_SELECT = 500;
const VIS = ["draft", "private", "public", "protected"] as const;

export function ContentTable({
  type,
  search,
  onSearch,
}: {
  type: EntityType;
  search: TableSearch;
  onSearch: (patch: TableSearch) => void;
}) {
  const t = useT();
  const [data, setData] = useState<ListResult | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [drawer, setDrawer] = useState<{ row: ContentRow | null } | null>(null);
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [text, setText] = useState(search.q ?? "");
  const [reload, setReload] = useState(0);
  const last = useRef<number | null>(null);
  const page = search.page ?? 1;

  // search box -> URL after a short pause
  useEffect(() => {
    if (text === (search.q ?? "")) return;
    const id = window.setTimeout(
      () => onSearch({ ...search, q: text || undefined, page: 1 }),
      350,
    );
    return () => window.clearTimeout(id);
  }, [text, search, onSearch]);

  useEffect(() => {
    let live = true;
    setState("loading");
    void listContent({
      type,
      ...(search.q ? { q: search.q } : {}),
      ...(search.visibility ? { visibility: search.visibility } : {}),
      ...(search.locale ? { locale: search.locale } : {}),
      sort: search.sort ?? "updated_desc",
      page,
      perPage: PER_PAGE,
      ...(search.trash ? { deleted: "include" as const } : {}),
      total: page === 1,
    }).then((r) => {
      if (!live) return;
      if (r.ok) {
        setData((prev) => ({
          ...r.data,
          total: r.data.total ?? prev?.total ?? null,
        }));
        setState("ok");
      } else setState("error");
    });
    return () => {
      live = false;
    };
  }, [
    type,
    search.q,
    search.visibility,
    search.locale,
    search.sort,
    search.trash,
    page,
    reload,
  ]);

  useEffect(
    () => setSelected(new Set()),
    [type, search.q, search.visibility, search.locale, search.trash, page],
  );

  const items = data?.items ?? [];
  const allOnPage = items.length > 0 && items.every((r) => selected.has(r.id));

  const toggle = useCallback(
    (index: number, checked: boolean, shift: boolean) => {
      setSelected((cur) => {
        const next = new Set(cur);
        const [from, to] =
          shift && last.current !== null
            ? [Math.min(last.current, index), Math.max(last.current, index)]
            : [index, index];
        for (let i = from; i <= to; i++) {
          const id = items[i]?.id;
          if (!id) continue;
          if (checked && next.size < MAX_SELECT) next.add(id);
          else if (!checked) next.delete(id);
        }
        return next;
      });
      last.current = index;
    },
    [items],
  );

  const exportRows = (rows: readonly ContentRow[], f: FileFormat) => {
    const file = buildExport(
      type,
      rows,
      f,
      readmeLines(t),
      new Date().toISOString().slice(0, 10),
    );
    download(file.blob, file.filename);
  };

  /** Everything matching the current filters (all pages, at most 5,000 rows). */
  const exportAll = async (f: FileFormat) => {
    const rows: ContentRow[] = [];
    for (let p = 1; p <= 50; p++) {
      const r = await listContent({
        type,
        ...(search.q ? { q: search.q } : {}),
        ...(search.visibility ? { visibility: search.visibility } : {}),
        ...(search.locale ? { locale: search.locale } : {}),
        sort: search.sort ?? "updated_desc",
        page: p,
        perPage: 100,
      });
      if (!r.ok) break;
      rows.push(...r.data.items);
      if (!r.data.hasMore) break;
    }
    exportRows(rows, f);
  };

  const when = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [],
  );

  return (
    <div className="space-y-3">
      <section className={`${PANEL} flex flex-wrap items-center gap-2`}>
        <button className={BTN_ACCENT} onClick={() => setDrawer({ row: null })}>
          ＋ {t("ct.new")}
        </button>
        <TemplateMenu type={type} />
        <button className={BTN} onClick={() => setImporting(true)}>
          ⬆ {t("ct.import")}
        </button>
        <FormatMenu
          label={`⬇ ${t("ct.export")}`}
          onPick={(f) => void exportAll(f)}
        />
        {selected.size > 0 && (
          <>
            <span className="text-xs text-muted-foreground" aria-live="polite">
              {t("ct.selected", { n: selected.size })}
            </span>
            <FormatMenu
              label={t("ct.exportSel")}
              onPick={(f) =>
                exportRows(
                  items.filter((r) => selected.has(r.id)),
                  f,
                )
              }
            />
            <button className={BTN} onClick={() => setSelected(new Set())}>
              {t("ct.clearSel")}
            </button>
          </>
        )}
      </section>

      <section
        className={`${PANEL} flex flex-wrap items-center gap-2`}
        aria-label={t("ct.filters")}
      >
        <input
          type="search"
          className={`${INPUT_AUTO} min-w-0 flex-1 basis-56`}
          placeholder={t("ct.search")}
          aria-label={t("ct.search")}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <select
          className={INPUT_AUTO}
          aria-label={t("ct.f.visibility")}
          value={search.visibility ?? ""}
          onChange={(e) =>
            onSearch({
              ...search,
              visibility: e.target.value || undefined,
              page: 1,
            })
          }
        >
          <option value="">
            {t("ct.f.visibility")}: {t("ct.f.all")}
          </option>
          {VIS.map((v) => (
            <option key={v} value={v}>
              {t(`ct.vis.${v}` as MessageKey)}
            </option>
          ))}
        </select>
        <select
          className={INPUT_AUTO}
          aria-label={t("ct.f.locale")}
          value={search.locale ?? ""}
          onChange={(e) =>
            onSearch({
              ...search,
              locale: e.target.value || undefined,
              page: 1,
            })
          }
        >
          <option value="">
            {t("ct.f.locale")}: {t("ct.f.all")}
          </option>
          {LOCALES.map((l) => (
            <option key={l} value={l}>
              {l.toUpperCase()}
            </option>
          ))}
        </select>
        <select
          className={INPUT_AUTO}
          aria-label={t("ct.sort")}
          value={search.sort ?? "updated_desc"}
          onChange={(e) =>
            onSearch({
              ...search,
              sort: e.target.value as TableSearch["sort"],
              page: 1,
            })
          }
        >
          <option value="updated_desc">{t("ct.sort.updated")}</option>
          <option value="created_desc">{t("ct.sort.created")}</option>
          <option value="title_asc">{t("ct.sort.title")}</option>
        </select>
        <Check
          checked={search.trash === true}
          onChange={(v) =>
            onSearch({ ...search, trash: v || undefined, page: 1 })
          }
        >
          {t("ct.trash")}
        </Check>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {data?.total != null ? t("ct.count", { n: data.total }) : ""}
        </span>
      </section>

      <section className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <caption className="sr-only">{typeLabel(t, type)}</caption>
          <thead className="bg-secondary text-xs">
            <tr>
              <th scope="col" className="w-8 px-2 py-2">
                <input
                  type="checkbox"
                  aria-label={t("ct.selectPage")}
                  checked={allOnPage}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? new Set(items.slice(0, MAX_SELECT).map((r) => r.id))
                        : new Set(),
                    )
                  }
                />
              </th>
              <th scope="col" className="px-2 py-2">
                {t("ct.col.title")}
              </th>
              <th scope="col" className="px-2 py-2">
                {t("ct.col.visibility")}
              </th>
              <th scope="col" className="px-2 py-2">
                {t("ct.col.locale")}
              </th>
              <th scope="col" className="px-2 py-2">
                {t("ct.col.tags")}
              </th>
              <th scope="col" className="px-2 py-2">
                {t("ct.col.updated")}
              </th>
              <th scope="col" className="px-2 py-2">
                {t("ct.col.actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {state === "loading" && items.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-6 text-center text-muted-foreground"
                  role="status"
                >
                  {t("ct.loading")}
                </td>
              </tr>
            )}
            {state === "error" && (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-6 text-center text-destructive"
                  role="alert"
                >
                  {t("ct.error")}
                </td>
              </tr>
            )}
            {state === "ok" && items.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-6 text-center text-muted-foreground"
                >
                  {t("ct.empty")}
                </td>
              </tr>
            )}
            {items.map((r, i) => (
              <tr
                key={r.id}
                className={`border-t ${r.is_deleted ? "opacity-60" : ""}`}
              >
                <td className="px-2 py-2">
                  <input
                    type="checkbox"
                    aria-label={t("ct.selectRow", { title: r.title })}
                    checked={selected.has(r.id)}
                    onChange={() => undefined}
                    onClick={(e) => toggle(i, !selected.has(r.id), e.shiftKey)}
                  />
                </td>
                <td className="px-2 py-2">
                  <button
                    className="text-left font-semibold underline-offset-2 hover:underline"
                    onClick={() => setDrawer({ row: r })}
                  >
                    {r.title}
                  </button>
                  <span className="block font-mono text-[11px] text-muted-foreground">
                    {r.slug}
                  </span>
                </td>
                <td className="px-2 py-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${r.visibility === "public" ? "bg-primary/20" : "bg-secondary"}`}
                  >
                    {t(`ct.vis.${r.visibility}` as MessageKey)}
                  </span>
                  {r.is_deleted && (
                    <span className="ml-1 text-[11px] text-destructive">🗑</span>
                  )}
                </td>
                <td className="px-2 py-2 uppercase">{r.locale}</td>
                <td className="px-2 py-2 text-xs text-muted-foreground">
                  {r.tags.join(", ")}
                </td>
                <td className="px-2 py-2 text-xs text-muted-foreground">
                  {when.format(new Date(r.updated_at))}
                </td>
                <td className="whitespace-nowrap px-2 py-2">
                  <button className={BTN} onClick={() => setDrawer({ row: r })}>
                    {t("ct.edit")}
                  </button>{" "}
                  {r.is_deleted ? (
                    <button
                      className={BTN}
                      onClick={async () => (
                        await restoreContent(r.id),
                        setReload((n) => n + 1)
                      )}
                    >
                      {t("ct.restore")}
                    </button>
                  ) : (
                    <button
                      className={BTN}
                      onClick={async () => (
                        await deleteContent(r.id),
                        setReload((n) => n + 1)
                      )}
                    >
                      {t("ct.delete")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <nav className="flex items-center gap-2" aria-label={t("ct.paging")}>
        <button
          className={BTN}
          disabled={page <= 1}
          onClick={() => onSearch({ ...search, page: page - 1 })}
        >
          ← {t("ct.prev")}
        </button>
        <span className="text-xs text-muted-foreground">
          {t("ct.page", { n: page })}
        </span>
        <button
          className={BTN}
          disabled={!data?.hasMore}
          onClick={() => onSearch({ ...search, page: page + 1 })}
        >
          {t("ct.next")} →
        </button>
      </nav>

      {drawer && (
        <RowDrawer
          key={drawer.row?.id ?? "new"}
          type={type}
          row={drawer.row}
          onClose={() => setDrawer(null)}
          onSaved={() => {
            setDrawer(null);
            setReload((n) => n + 1);
          }}
        />
      )}
      {importing && (
        <ImportDialog
          type={type}
          onClose={() => setImporting(false)}
          onDone={() => setReload((n) => n + 1)}
        />
      )}
    </div>
  );
}
