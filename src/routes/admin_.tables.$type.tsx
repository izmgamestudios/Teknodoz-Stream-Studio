// src/routes/admin_.tables.$type.tsx
// Generic admin table for one catalog type: /admin/tables/story, /video, /podcast, ...
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { titleFromMatches } from "@/studio/branding/head";
import { useT } from "@/studio/i18n/use-t";
import { ENTITY_TYPES, PLANE, type EntityType } from "@/shared/schema-registry";
import { AdminGate } from "@/studio/ui/admin-gate";
import { CATALOG_TYPES, typeLabel } from "@/studio/ui/content/labels";
import {
  ContentTable,
  type TableSearch,
} from "@/studio/ui/content/table-engine";
import { BTN } from "@/studio/ui/fields";

const SORTS = ["updated_desc", "created_desc", "title_asc"] as const;
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v ? v.slice(0, 100) : undefined;

export const Route = createFileRoute("/admin_/tables/$type")({
  head: ({ matches }) => ({
    meta: [
      { title: titleFromMatches(matches, "Tables") },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): TableSearch => {
    const sort = SORTS.find((x) => x === s["sort"]);
    const page = Number(s["page"]);
    return {
      q: str(s["q"]),
      visibility: str(s["visibility"]),
      locale: str(s["locale"]),
      sort,
      page: Number.isInteger(page) && page > 1 ? page : undefined,
      trash: s["trash"] === true || s["trash"] === "true" ? true : undefined,
    };
  },
  component: () => (
    <AdminGate>
      <TablePage />
    </AdminGate>
  ),
});

function TablePage() {
  const t = useT();
  const { type } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const onSearch = useCallback(
    (patch: TableSearch) => void navigate({ search: patch, replace: true }),
    [navigate],
  );
  const valid =
    (ENTITY_TYPES as readonly string[]).includes(type) &&
    PLANE[type as EntityType] === "catalog";

  return (
    <div className="min-h-screen p-3 md:p-6">
      <header className="mx-auto mb-4 max-w-6xl">
        <Link to="/admin" className="text-xs underline">
          ← {t("ct.back")}
        </Link>
        <h1 className="mt-1 text-3xl font-bold">
          {valid ? typeLabel(t, type as EntityType) : t("ct.title")}
        </h1>
        <nav className="mt-2 flex flex-wrap gap-1.5" aria-label={t("ct.title")}>
          {CATALOG_TYPES.map((x) => (
            <Link
              key={x}
              to="/admin/tables/$type"
              params={{ type: x }}
              className={`${BTN} ${x === type ? "!bg-primary-solid !text-primary-foreground" : ""}`}
            >
              {typeLabel(t, x)}
            </Link>
          ))}
        </nav>
      </header>
      <div className="mx-auto max-w-6xl">
        {valid ? (
          <ContentTable
            key={type}
            type={type as EntityType}
            search={search}
            onSearch={onSearch}
          />
        ) : (
          <p role="alert">{t("ct.err.type")}</p>
        )}
      </div>
    </div>
  );
}
