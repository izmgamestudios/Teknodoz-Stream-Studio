// src/server/content-bulk.ts
// Bulk actions and the unlock endpoint of protected content.
//   POST /api/content/bulk            admin  { action, type, ids[], params }   (max 500 ids, one unit)
//   POST /api/content/:id/unlock      public { password } -> body of a protected item
// Passwords are hashed once (scrypt), never logged, echoed or put in a URL.
import { z } from "zod";
import { clientIp } from "./client-ip";

import {
  ENTITY_TYPES,
  bulkSettableFields,
  type EntityType,
} from "../shared/schema-registry";
import { isAdminRequest } from "./auth";
import { StoreUnavailableError } from "./catalog";
import type { AuditSink } from "./content";
import { CONTENT_ID_RE, type ContentRow } from "./content-model";
import {
  newGroup,
  setGroupPassword,
  tryUnlock,
  validPassword,
  type GroupStore,
} from "./content-groups";
import type { ContentStore } from "./content-store";
import { applyInput } from "./content-write";

export const BULK_PATH = "/api/content/bulk";
export const MAX_BULK_IDS = 500;
const MAX_BODY_BYTES = 200_000;
const UNLOCK_PER_MINUTE = 10;

export const settableFields = (type: EntityType): string[] =>
  bulkSettableFields(type).map((f) => f.key);

const bodySchema = z.object({
  action: z.enum([
    "set-visibility",
    "protect",
    "change-password",
    "remove-protection",
    "tags-add",
    "tags-remove",
    "set-field",
    "soft-delete",
    "restore",
  ]),
  type: z.enum(ENTITY_TYPES as unknown as [string, ...string[]]),
  ids: z.array(z.string().regex(CONTENT_ID_RE)).min(1).max(MAX_BULK_IDS),
  params: z.record(z.unknown()).default({}),
});

const json = (
  b: unknown,
  status = 200,
  h: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(b), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...h,
    },
  });

export interface BulkResult {
  updated: number;
  skipped: number;
  errors: { id: string; error: string }[];
}

export function createBulkApi(opts: {
  token: string | null;
  store: ContentStore;
  groups: GroupStore;
  audit: AuditSink;
  now?: () => Date;
}) {
  const now = opts.now ?? (() => new Date());
  const unlockHits = new Map<string, number[]>();

  const limited = (key: string): boolean => {
    const t = now().getTime();
    const hits = (unlockHits.get(key) ?? []).filter((x) => t - x < 60_000);
    hits.push(t);
    unlockHits.set(key, hits);
    if (unlockHits.size > 5000)
      for (const [k, v] of unlockHits)
        if (v.every((x) => t - x >= 60_000)) unlockHits.delete(k);
    return hits.length > UNLOCK_PER_MINUTE;
  };

  async function bulk(req: Request): Promise<Response> {
    if (!isAdminRequest(req, opts.token, now().getTime()))
      return json({ error: "unauthorized" }, 401);
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return json({ error: "too-large" }, 413);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return json({ error: "bad-request" }, 400);
    }
    const p = bodySchema.safeParse(raw);
    if (!p.success) return json({ error: "bad-request" }, 400);
    const { action, params } = p.data;
    const type = p.data.type as EntityType;
    const ids = [...new Set(p.data.ids)];
    const stamp = now().toISOString();

    const found: ContentRow[] = [];
    const result: BulkResult = { updated: 0, skipped: 0, errors: [] };
    for (const id of ids) {
      const row = await opts.store.get(id);
      if (!row || row.type !== type)
        result.errors.push({ id, error: "not-found" });
      else found.push(row);
    }

    // action-level validation (before anything is written)
    let next: (r: ContentRow) => ContentRow | string | null; // row | error code | null = unchanged
    let createdGroup: ReturnType<typeof newGroup> | null = null;
    let updatedGroup: ReturnType<typeof setGroupPassword> | null = null;

    switch (action) {
      case "set-visibility": {
        const v = params["visibility"];
        if (v !== "draft" && v !== "private" && v !== "public")
          return json({ error: "bad-params" }, 400);
        if (v === "public" && params["confirmPublic"] !== true)
          return json(
            { error: "public-not-confirmed", count: found.length },
            409,
          );
        next = (r) =>
          r.visibility === v ? null : { ...r, visibility: v, access_group: "" };
        break;
      }
      case "protect": {
        if (!validPassword(params["password"]))
          return json({ error: "weak-password" }, 400);
        const name =
          typeof params["name"] === "string" && params["name"].trim()
            ? params["name"].trim()
            : `Group ${stamp.slice(0, 16)}`;
        createdGroup = newGroup(name, params["password"], stamp);
        const gid = createdGroup.id;
        next = (r) => ({ ...r, visibility: "protected", access_group: gid });
        break;
      }
      case "change-password": {
        if (!validPassword(params["password"]))
          return json({ error: "weak-password" }, 400);
        const groups = [
          ...new Set(found.map((r) => r.access_group).filter(Boolean)),
        ];
        const wanted =
          typeof params["groupId"] === "string"
            ? params["groupId"]
            : groups.length === 1
              ? groups[0]!
              : "";
        if (!wanted || !groups.includes(wanted))
          return json({ error: "group-ambiguous", groups }, 409);
        const g = (await opts.groups.list()).find((x) => x.id === wanted);
        if (!g) return json({ error: "group-not-found" }, 404);
        updatedGroup = setGroupPassword(g, params["password"], stamp);
        next = () => null; // rows follow the group; nothing to write on them
        break;
      }
      case "remove-protection":
        next = (r) =>
          r.visibility === "protected"
            ? { ...r, visibility: "draft", access_group: "" }
            : null;
        break;
      case "tags-add":
      case "tags-remove": {
        const tags = Array.isArray(params["tags"])
          ? params["tags"]
              .filter(
                (t): t is string => typeof t === "string" && t.trim() !== "",
              )
              .map((t) => t.trim().slice(0, 40))
          : [];
        if (tags.length === 0 || tags.length > 20)
          return json({ error: "bad-params" }, 400);
        next = (r) => {
          const merged =
            action === "tags-add"
              ? [...new Set([...r.tags, ...tags])].slice(0, 20)
              : r.tags.filter((t) => !tags.includes(t));
          return merged.length === r.tags.length &&
            merged.every((t, i) => t === r.tags[i])
            ? null
            : { ...r, tags: merged };
        };
        break;
      }
      case "set-field": {
        const field = params["field"];
        if (typeof field !== "string" || !settableFields(type).includes(field))
          return json({ error: "field-not-allowed" }, 400);
        const value = params["value"];
        // validate once through the registry schema (shape of a one-field patch)
        const probe = applyInput(
          type,
          found[0] ?? null,
          { ...(found[0] ? {} : { title: "x" }), [field]: value },
          stamp,
        );
        if (!probe.ok)
          return json({ error: "invalid", issues: probe.issues ?? [] }, 400);
        next = (r) => {
          const w = applyInput(type, r, { [field]: value }, stamp);
          if (!w.ok) return "invalid";
          return JSON.stringify({ ...w.row, updated_at: "" }) ===
            JSON.stringify({ ...r, updated_at: "" })
            ? null
            : w.row;
        };
        break;
      }
      case "soft-delete":
        next = (r) => (r.is_deleted ? null : { ...r, is_deleted: true });
        break;
      case "restore":
        next = (r) => (r.is_deleted ? { ...r, is_deleted: false } : null);
        break;
    }

    const writes: { row: ContentRow; isNew: boolean }[] = [];
    const before: Record<string, unknown> = {};
    for (const r of found) {
      const out = next(r);
      if (out === null) result.skipped++;
      else if (typeof out === "string")
        result.errors.push({ id: r.id, error: out });
      else {
        before[r.id] = {
          visibility: r.visibility,
          access_group: r.access_group,
          is_deleted: r.is_deleted,
        };
        writes.push({ row: { ...out, updated_at: stamp }, isNew: false });
      }
    }
    if (createdGroup && writes.length) await opts.groups.upsert(createdGroup);
    if (updatedGroup) {
      await opts.groups.upsert(updatedGroup);
      result.updated += found.length;
    }
    await opts.store.putMany(writes);
    result.updated += writes.length;

    await opts.audit.append({
      at: stamp,
      actor: "admin",
      action: `bulk:${action}`,
      target_collection: "content_items",
      target_ids: updatedGroup
        ? found.map((r) => r.id)
        : writes.map((w) => w.row.id),
      before,
      // never the password or its hash: only what changed
      after: {
        action,
        count: result.updated,
        ...(createdGroup ? { group: createdGroup.id } : {}),
        ...(params["visibility"] ? { visibility: params["visibility"] } : {}),
      },
      source: "bulk",
    });
    return json(result);
  }

  async function unlock(req: Request, id: string): Promise<Response> {
    if (limited(`${clientIp(req)}`))
      return json({ error: "rate-limited" }, 429, { "retry-after": "60" });
    const text = await req.text();
    if (text.length > 2000) return json({ error: "too-large" }, 413);
    let password: unknown;
    try {
      password = (JSON.parse(text) as { password?: unknown }).password;
    } catch {
      return json({ error: "bad-request" }, 400);
    }
    if (
      typeof password !== "string" ||
      password.length === 0 ||
      password.length > 200
    )
      return json({ error: "bad-request" }, 400);

    const row = await opts.store.get(id);
    if (
      !row ||
      row.is_deleted ||
      row.visibility !== "protected" ||
      !row.access_group
    )
      return json({ error: "not-found" }, 404);
    const group = (await opts.groups.list()).find(
      (g) => g.id === row.access_group,
    );
    if (!group) return json({ error: "not-found" }, 404);

    const r = tryUnlock(group, password, now().getTime());
    if (!r.ok && r.reason === "locked")
      return json({ error: "locked", retryAfterSec: r.retryAfterSec }, 429, {
        "retry-after": String(r.retryAfterSec),
      });
    await opts.groups.upsert(r.group);
    if (!r.ok) return json({ error: "wrong-password" }, 403);
    return json({
      item: {
        id: row.id,
        type: row.type,
        slug: row.slug,
        title: row.title,
        summary: row.summary,
        body_blocks: row.body_blocks,
        meta: row.meta,
        tags: row.tags,
        locale: row.locale,
        updated_at: row.updated_at,
        protected: false,
      },
    });
  }

  async function handle(req: Request): Promise<Response | null> {
    const path = new URL(req.url).pathname.replace(/\/+$/, "");
    const m = /^\/api\/content\/([a-z0-9]{15})\/unlock$/.exec(path);
    if (path !== BULK_PATH && !m) return null;
    if (req.method !== "POST")
      return json({ error: "method-not-allowed" }, 405);
    try {
      return m ? await unlock(req, m[1]!) : await bulk(req);
    } catch (e) {
      if (e instanceof StoreUnavailableError)
        return json({ error: "store-unavailable" }, 503);
      console.error("[bulk]", e);
      return json({ error: "internal" }, 500);
    }
  }
  return { handle };
}
