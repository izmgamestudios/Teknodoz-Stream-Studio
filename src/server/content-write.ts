// src/server/content-write.ts
// Turns validated API input into a ContentRow (pure): column vs meta placement, slug, summary
// fallbacks, timestamps. Secret fields cannot get here: zodFor() rejects them.
import { blocksSchema, type Block } from "../shared/blocks";
import { mdToBlocks } from "../shared/markdown";
import {
  SCHEMA_VERSION,
  exposedFields,
  slugify,
  zodFor,
  type EntityType,
} from "../shared/schema-registry";
import { blankRow, type ContentRow } from "./content-model";

export type WriteResult =
  | { ok: true; row: ContentRow }
  | { ok: false; error: "invalid" | "bad-blocks"; issues?: string[] };

const COLUMN_KEYS = new Set([
  "external_id",
  "slug",
  "title",
  "summary",
  "locale",
  "visibility",
  "tags",
  "source_url",
  "og_image",
  "seo_title",
  "seo_description",
  "noindex",
]);

/** Patch semantics: provided keys replace, missing keys stay. `null` clears an optional field. */
export function applyInput(
  type: EntityType,
  existing: ContentRow | null,
  input: unknown,
  now: string,
  owner = "",
): WriteResult {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return { ok: false, error: "invalid" };
  const { body_blocks: rawBlocks, ...rest } = input as Record<string, unknown>;
  // `title` is required by the schema, but a patch may omit it
  const schema = zodFor(type).partial();
  const parsed = schema.safeParse(rest);
  if (!parsed.success)
    return {
      ok: false,
      error: "invalid",
      issues: parsed.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
    };
  const data = parsed.data as Record<string, unknown>;

  let blocks: Block[] | null = null;
  if (rawBlocks !== undefined) {
    const b = blocksSchema.safeParse(rawBlocks);
    if (!b.success) return { ok: false, error: "bad-blocks" };
    blocks = b.data;
  } else if (typeof data["body_md"] === "string") {
    blocks = mdToBlocks(data["body_md"]);
  }

  const title = (data["title"] as string | undefined) ?? existing?.title;
  if (!title)
    return { ok: false, error: "invalid", issues: ["title: required"] };

  const row: ContentRow = existing
    ? structuredClone(existing)
    : blankRow(type, title, now, { owner });
  row.title = title;
  row.meta = { ...row.meta };

  const metaKeys = new Set(
    exposedFields(type)
      .filter((f) => f.meta)
      .map((f) => f.key),
  );
  for (const [k, v] of Object.entries(data)) {
    if (k === "body_md" || k === "title" || k === "id") continue;
    if (COLUMN_KEYS.has(k)) {
      const target = row as unknown as Record<string, unknown>;
      if (v === null || v === undefined) {
        target[k] =
          k === "noindex"
            ? false
            : k === "tags"
              ? []
              : k === "locale"
                ? "tr"
                : k === "visibility"
                  ? "draft"
                  : "";
      } else target[k] = v;
    } else if (metaKeys.has(k)) {
      if (v === null || v === undefined) delete row.meta[k];
      else row.meta[k] = v;
    }
  }
  if (blocks) row.body_blocks = blocks;
  if (!row.slug) row.slug = slugify(row.title);
  if (!row.summary && row.body_blocks.length) {
    const first = row.body_blocks.find((b) => b.type === "paragraph");
    if (first && first.type === "paragraph")
      row.summary = first.text.slice(0, 300);
  }
  row.schema_version = SCHEMA_VERSION;
  row.updated_at = now;
  return { ok: true, row };
}
