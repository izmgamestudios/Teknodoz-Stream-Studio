// src/studio/content/content-client.ts
// Browser client for the content gateway (/api/content, /api/import/content). The admin session
// cookie authenticates every call.
import type { ContentRow } from "../../server/content-model";
import type { EntityType } from "../../shared/schema-registry";

export type { ContentRow };

export interface ListQuery {
  type: EntityType;
  q?: string;
  visibility?: string;
  locale?: string;
  sort?: "updated_desc" | "created_desc" | "title_asc";
  page?: number;
  perPage?: number;
  deleted?: "include" | "only";
  total?: boolean;
}

export interface ListResult {
  items: ContentRow[];
  page: number;
  perPage: number;
  hasMore: boolean;
  total: number | null;
}

async function call<T>(
  path: string,
  init?: RequestInit,
): Promise<
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; issues?: string[] }
> {
  try {
    const res = await fetch(path, { cache: "no-store", ...init });
    const body = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (res.ok) return { ok: true, data: body as T };
    return {
      ok: false,
      status: res.status,
      error: typeof body["error"] === "string" ? body["error"] : "failed",
      ...(Array.isArray(body["issues"])
        ? { issues: body["issues"] as string[] }
        : {}),
    };
  } catch {
    return { ok: false, status: 0, error: "network" };
  }
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export function listQueryString(q: ListQuery): string {
  const p = new URLSearchParams({ type: q.type });
  if (q.q) p.set("q", q.q);
  if (q.visibility) p.set("visibility", q.visibility);
  if (q.locale) p.set("locale", q.locale);
  if (q.sort) p.set("sort", q.sort);
  if (q.page && q.page > 1) p.set("page", String(q.page));
  p.set("perPage", String(q.perPage ?? 50));
  if (q.deleted) p.set("deleted", q.deleted);
  if (q.total) p.set("total", "1");
  return p.toString();
}

export const listContent = (q: ListQuery) =>
  call<ListResult>(`/api/content?${listQueryString(q)}`);

export const saveContent = (
  id: string | null,
  type: EntityType,
  body: Record<string, unknown>,
) =>
  id
    ? call<{ item: ContentRow }>(`/api/content/${id}`, json("PUT", body))
    : call<{ item: ContentRow }>(
        "/api/content",
        json("POST", { type, ...body }),
      );

export const deleteContent = (id: string) =>
  call<{ item: ContentRow }>(`/api/content/${id}`, { method: "DELETE" });

export const restoreContent = (id: string) =>
  call<{ item: ContentRow }>(`/api/content/${id}/restore`, { method: "POST" });

/* -------------------------------- import -------------------------------- */

export interface ImportRowDto {
  n: number;
  id?: string;
  input: Record<string, unknown>;
  clientIssues?: string[];
}
export interface PlanSummary {
  create: number;
  update: number;
  skip: number;
  error: number;
  unpublish: number;
  conflict: number;
}
export interface PlanRowDto {
  n: number;
  action: keyof PlanSummary;
  id: string;
  slug: string;
  issues: string[];
}
export interface ImportResponse {
  mode: "dry" | "commit";
  planHash: string;
  summary: PlanSummary;
  rows: PlanRowDto[];
}

export interface ImportRequest {
  type: EntityType;
  importId: string;
  onMatch: "draft" | "keep";
  mode: "dry" | "commit";
  rows: ImportRowDto[];
  planHash?: string;
  confirmUnpublish?: boolean;
}

export type ImportCall = (
  req: ImportRequest,
) => Promise<
  | { ok: true; data: ImportResponse }
  | { ok: false; status: number; error: string }
>;

export const postImport: ImportCall = (req) =>
  call<ImportResponse>("/api/import/content", json("POST", req));
