// src/server/content-plan.ts
// Import planning (pure given a ContentStore): match every row to an existing item, decide
// create / update / skip / unpublish / conflict / error, and build the rows that a commit would
// write. Nothing here writes; the dry run returns the plan, the commit re-plans and compares.
import { createHash } from "node:crypto";

import { slugify, type EntityType } from "../shared/schema-registry";
import type { ContentRow } from "./content-model";
import type { ContentStore } from "./content-store";
import { applyInput } from "./content-write";

export type PlanAction =
  "create" | "update" | "skip" | "error" | "unpublish" | "conflict";
export type OnMatch = "draft" | "keep";

/** One source row as sent by the browser (already converted from cells). */
export interface ImportRow {
  /** 1-based row number in the source file, for the report */
  n: number;
  id?: string | undefined;
  input: Record<string, unknown>;
  /** problems found while converting cells in the browser */
  clientIssues?: string[] | undefined;
}

export interface PlanRow {
  n: number;
  action: PlanAction;
  id: string;
  slug: string;
  issues: string[];
  /** the row a commit writes (absent for skip / error / conflict) */
  row?: ContentRow;
  isNew?: boolean;
  /** previous slug of an updated item (for redirects) */
  previous?: ContentRow;
}

const IMPORT_VIS = new Set(["draft", "private"]);

const sameContent = (a: ContentRow, b: ContentRow): boolean =>
  JSON.stringify({ ...a, updated_at: "" }) ===
  JSON.stringify({ ...b, updated_at: "" });

export async function planImport(
  store: ContentStore,
  type: EntityType,
  rows: readonly ImportRow[],
  onMatch: OnMatch,
  now: string,
): Promise<PlanRow[]> {
  const out: PlanRow[] = [];
  const seen = new Map<string, number>();
  const takenSlugs = new Set<string>();

  const dup = (key: string, n: number): boolean => {
    if (seen.has(key)) return true;
    seen.set(key, n);
    return false;
  };

  for (const r of rows) {
    const base = { n: r.n, id: r.id ?? "", slug: "", issues: [] as string[] };
    const fail = (action: PlanAction, ...issues: string[]) => {
      out.push({ ...base, action, issues });
    };
    if (r.clientIssues?.length) {
      fail("error", ...r.clientIssues);
      continue;
    }
    const input = { ...r.input };
    const vis = input["visibility"];
    if (vis !== undefined && vis !== null && !IMPORT_VIS.has(String(vis))) {
      fail("error", "import-cannot-publish");
      continue;
    }

    const ext =
      typeof input["external_id"] === "string" ? input["external_id"] : "";
    const slugIn = typeof input["slug"] === "string" ? input["slug"] : "";
    const keys = [
      r.id ? `id:${r.id}` : "",
      ext ? `ext:${ext}` : "",
      slugIn ? `slug:${slugIn}` : "",
    ].filter(Boolean);
    if (keys.some((k) => dup(k, r.n))) {
      fail("error", "duplicate-in-file");
      continue;
    }

    const byId = r.id ? await store.get(r.id) : null;
    if (r.id && !byId) {
      fail("error", "id-not-found");
      continue;
    }
    if (byId && byId.type !== type) {
      fail("error", "id-wrong-type");
      continue;
    }
    const byExt = ext ? await store.findByExternalId(type, ext) : null;
    const bySlug = slugIn ? await store.findBySlug(type, slugIn) : null;
    const hits = [
      ...new Set(
        [byId, byExt, bySlug]
          .filter((x): x is ContentRow => x !== null)
          .map((x) => x.id),
      ),
    ];
    if (hits.length > 1) {
      fail("conflict", "keys-point-to-different-rows");
      continue;
    }
    const existing = byId ?? byExt ?? bySlug;

    if (!existing) {
      const w = applyInput(type, null, input, now, "admin");
      if (!w.ok) {
        fail("error", ...(w.issues ?? [w.error]));
        continue;
      }
      let slug = w.row.slug;
      const b = slugify(slug, 110);
      for (
        let i = 2;
        takenSlugs.has(slug) || (await store.findBySlug(type, slug));
        i++
      )
        slug = `${b}-${i}`;
      takenSlugs.add(slug);
      w.row.slug = slug;
      if (typeof input["visibility"] !== "string") w.row.visibility = "draft";
      out.push({
        n: r.n,
        action: "create",
        id: w.row.id,
        slug,
        issues: [],
        row: w.row,
        isNew: true,
      });
      continue;
    }

    const patch = { ...input };
    if (onMatch === "keep") delete patch["visibility"];
    else
      patch["visibility"] =
        patch["visibility"] === "private" ? "private" : "draft";
    const w = applyInput(type, existing, patch, now, "admin");
    if (!w.ok) {
      fail("error", ...(w.issues ?? [w.error]));
      continue;
    }
    takenSlugs.add(w.row.slug);
    const live =
      existing.visibility === "public" || existing.visibility === "protected";
    const unpublish = onMatch === "draft" && live && !existing.is_deleted;
    const action: PlanAction = sameContent(existing, {
      ...w.row,
      updated_at: existing.updated_at,
    })
      ? "skip"
      : unpublish
        ? "unpublish"
        : "update";
    out.push({
      n: r.n,
      action,
      id: existing.id,
      slug: w.row.slug,
      issues: [],
      ...(action === "skip"
        ? {}
        : { row: w.row, isNew: false, previous: existing }),
    });
  }
  return out;
}

export function summarize(
  plan: readonly PlanRow[],
): Record<PlanAction, number> {
  const s: Record<PlanAction, number> = {
    create: 0,
    update: 0,
    skip: 0,
    error: 0,
    unpublish: 0,
    conflict: 0,
  };
  for (const p of plan) s[p.action]++;
  return s;
}

/** Fingerprint of what a commit would do (new ids are random, so they are left out); the commit must present the dry run's hash. */
export function planHash(
  type: EntityType,
  onMatch: OnMatch,
  plan: readonly PlanRow[],
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        type,
        onMatch,
        plan.map((p) => [
          p.n,
          p.action,
          p.action === "create" ? "" : p.id,
          p.slug,
        ]),
      ]),
    )
    .digest("hex")
    .slice(0, 32);
}
