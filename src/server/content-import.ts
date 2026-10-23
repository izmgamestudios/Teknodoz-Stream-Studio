// src/server/content-import.ts
// POST /api/import/content (admin). One request = one chunk of up to 500 rows.
//   { type, importId, onMatch: "draft" | "keep", rows: ImportRow[], mode: "dry" | "commit",
//     planHash?, confirmUnpublish? }
// dry    -> the plan (per-row outcome + summary + planHash); nothing is written
// commit -> re-plans; needs the dry run's planHash (409 plan-changed otherwise) and, when live
//           items would be unpublished, confirmUnpublish; writes the chunk in one unit
// Import never sets `public` / `protected`; at most 10 distinct imports per admin per hour.
import { z } from "zod";

import { ENTITY_TYPES, type EntityType } from "../shared/schema-registry";
import { isAdminRequest } from "./auth";
import { StoreUnavailableError, type RecordStore } from "./catalog";
import type { AuditSink, Redirect } from "./content";
import type { ContentStore } from "./content-store";
import { planHash, planImport, summarize, type PlanRow } from "./content-plan";

export const IMPORT_PATH = "/api/import/content";
export const MAX_ROWS_PER_CHUNK = 500;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
export const IMPORTS_PER_HOUR = 10;

const bodySchema = z.object({
  type: z.enum(ENTITY_TYPES as unknown as [string, ...string[]]),
  importId: z.string().regex(/^[a-zA-Z0-9-]{8,60}$/),
  onMatch: z.enum(["draft", "keep"]).default("draft"),
  mode: z.enum(["dry", "commit"]),
  planHash: z.string().max(64).optional(),
  confirmUnpublish: z.boolean().optional(),
  rows: z
    .array(
      z.object({
        n: z.number().int().min(1),
        id: z.string().max(40).optional(),
        input: z.record(z.unknown()),
        clientIssues: z.array(z.string().max(80)).max(20).optional(),
      }),
    )
    .min(1)
    .max(MAX_ROWS_PER_CHUNK),
});

const json = (b: unknown, status = 200): Response =>
  new Response(JSON.stringify(b), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const report = (plan: readonly PlanRow[]) =>
  plan.map((p) => ({
    n: p.n,
    action: p.action,
    id: p.id,
    slug: p.slug,
    issues: p.issues,
  }));

export function createImportApi(opts: {
  token: string | null;
  store: ContentStore;
  redirects: RecordStore<Redirect>;
  audit: AuditSink;
  now?: () => Date;
}) {
  const now = opts.now ?? (() => new Date());
  const imports = new Map<string, number>();

  /** A new importId counts once; known ids (the other chunks of the same file) are free. */
  function allow(importId: string): boolean {
    const t = now().getTime();
    for (const [id, at] of imports) if (t - at > 3_600_000) imports.delete(id);
    if (imports.has(importId)) return true;
    if (imports.size >= IMPORTS_PER_HOUR) return false;
    imports.set(importId, t);
    return true;
  }

  async function handle(req: Request): Promise<Response | null> {
    if (new URL(req.url).pathname.replace(/\/+$/, "") !== IMPORT_PATH)
      return null;
    if (req.method !== "POST")
      return json({ error: "method-not-allowed" }, 405);
    if (!isAdminRequest(req, opts.token, now().getTime()))
      return json({ error: "unauthorized" }, 401);
    try {
      const text = await req.text();
      if (text.length > MAX_BODY_BYTES)
        return json({ error: "too-large" }, 413);
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        return json({ error: "bad-request" }, 400);
      }
      const parsed = bodySchema.safeParse(raw);
      if (!parsed.success) return json({ error: "bad-request" }, 400);
      const b = parsed.data;
      if (!allow(b.importId)) return json({ error: "rate-limited" }, 429);
      const type = b.type as EntityType;
      const stamp = now().toISOString();

      const plan = await planImport(opts.store, type, b.rows, b.onMatch, stamp);
      const hash = planHash(type, b.onMatch, plan);
      const summary = summarize(plan);
      if (b.mode === "dry")
        return json({
          mode: "dry",
          planHash: hash,
          summary,
          rows: report(plan),
        });

      if (b.planHash !== hash)
        return json({ error: "plan-changed", planHash: hash, summary }, 409);
      if (summary.unpublish > 0 && b.confirmUnpublish !== true)
        return json({ error: "unpublish-not-confirmed", summary }, 409);

      const writes = plan.filter(
        (p) =>
          p.row &&
          (p.action === "create" ||
            p.action === "update" ||
            p.action === "unpublish"),
      );
      await opts.store.putMany(
        writes.map((p) => ({ row: p.row!, isNew: p.isNew === true })),
      );
      for (const p of writes)
        if (
          p.previous &&
          p.previous.slug &&
          p.previous.slug !== p.row!.slug &&
          p.previous.visibility === "public"
        )
          await opts.redirects.upsert({
            id: `${type}:${p.previous.slug}`,
            type,
            from: p.previous.slug,
            to: p.row!.slug,
          });
      await opts.audit.append({
        at: stamp,
        actor: "admin",
        action: "import",
        target_collection: "content_items",
        target_ids: writes.map((p) => p.id),
        before: {
          unpublished: plan
            .filter((p) => p.action === "unpublish")
            .map((p) => p.id),
        },
        after: summary,
        source: "import",
      });
      return json({
        mode: "commit",
        planHash: hash,
        summary,
        rows: report(plan),
      });
    } catch (e) {
      if (e instanceof StoreUnavailableError)
        return json({ error: "store-unavailable" }, 503);
      console.error("[import]", e);
      return json({ error: "internal" }, 500);
    }
  }
  return { handle };
}
