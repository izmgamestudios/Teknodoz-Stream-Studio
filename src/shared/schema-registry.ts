// src/shared/schema-registry.ts
// Single source of truth for every content type: fields, kinds, secrecy and zod validation.
// Templates, import / export, the table engine and the public API are all generated from this,
// so a field added here shows up everywhere and a field marked `secret` can never leak.
import { z } from "zod";

export const SCHEMA_VERSION = 1;

export const ENTITY_TYPES = [
  "prompter_script",
  "studio_scene",
  "classic_template",
  "room",
  "live_event",
  "community_post",
  "guide",
  "story",
  "video",
  "podcast",
  "source",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const LOCALES = ["tr", "en", "de", "es"] as const;
export type Locale = (typeof LOCALES)[number];

/** Import can only produce these (spec §7.2); `public` / `protected` come from bulk actions. */
export const IMPORT_VISIBILITIES = ["draft", "private"] as const;
export const VISIBILITIES = [
  "draft",
  "private",
  "public",
  "protected",
] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export type FieldKind =
  | "text"
  | "longtext"
  | "select"
  | "tags"
  | "url"
  | "number"
  | "date"
  | "bool"
  | "json";

export interface FieldDef {
  key: string;
  kind: FieldKind;
  required?: boolean;
  /** never in templates, exports, imports or the public API */
  secret?: boolean;
  options?: readonly string[];
  max?: number;
  /** stored in the `meta` JSON column instead of a real column */
  meta?: boolean;
}

/** Local = browser only (optional publish creates a draft); catalog = server. */
export const PLANE: Record<EntityType, "local" | "catalog"> = {
  prompter_script: "local",
  studio_scene: "local",
  classic_template: "local",
  room: "catalog",
  live_event: "catalog",
  community_post: "catalog",
  guide: "catalog",
  story: "catalog",
  video: "catalog",
  podcast: "catalog",
  source: "catalog",
};

export const ROUTE: Record<EntityType, string> = {
  prompter_script: "/",
  studio_scene: "/studio",
  classic_template: "/classic",
  room: "/room",
  live_event: "/live",
  community_post: "/community",
  guide: "/guide",
  story: "/library/stories",
  video: "/library/videos",
  podcast: "/library/podcasts",
  source: "/docs",
};

/** Types that get a public, indexable page at /library/:type/:slug. */
export const PUBLIC_TYPES: readonly EntityType[] = [
  "story",
  "video",
  "podcast",
];

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const f = (
  key: string,
  kind: FieldKind,
  o: Partial<Omit<FieldDef, "key" | "kind">> = {},
): FieldDef => ({ key, kind, ...o });

/** Columns shared by every catalog type (the SEO / AEO / GEO fields are here). */
export const BASE_FIELDS: readonly FieldDef[] = [
  f("id", "text", { max: 40 }),
  f("external_id", "text", { max: 80 }),
  f("slug", "text", { max: 120 }),
  f("title", "text", { required: true, max: 200 }),
  /** answer-first summary: meta description, speakable text, LLM snippet */
  f("summary", "longtext", { max: 500 }),
  f("body_md", "longtext", { max: 100_000 }),
  f("locale", "select", { options: LOCALES }),
  f("visibility", "select", { options: IMPORT_VISIBILITIES }),
  f("tags", "tags", { max: 20 }),
  f("source_url", "url"),
  f("seo_title", "text", { max: 70 }),
  f("seo_description", "text", { max: 170 }),
  f("og_image", "url"),
  f("noindex", "bool"),
  /** [{ q, a }] rendered visibly and as FAQPage JSON-LD */
  f("faq", "json", { meta: true }),
];

const media = (extra: FieldDef[] = []): FieldDef[] => [
  f("media_url", "url", { meta: true }),
  f("poster_url", "url", { meta: true }),
  f("duration_sec", "number", { meta: true }),
  f("category", "text", { max: 60, meta: true }),
  f("transcript_url", "url", { meta: true }),
  ...extra,
];

export const TYPE_FIELDS: Record<EntityType, readonly FieldDef[]> = {
  prompter_script: [],
  studio_scene: [f("aspect", "text", { max: 20, meta: true })],
  classic_template: [],
  room: [
    f("layout", "text", { max: 40, meta: true }),
    f("max_guests", "number", { meta: true }),
    f("join_code", "text", { secret: true }),
    f("guest_email", "text", { secret: true }),
    f("guest_phone", "text", { secret: true }),
  ],
  live_event: [
    f("starts_at", "date", { meta: true }),
    f("platform", "select", {
      options: ["youtube", "twitch", "facebook", "custom"],
      meta: true,
    }),
    f("watch_url", "url", { meta: true }),
    f("stream_key", "text", { secret: true }),
    f("rtmp_url", "text", { secret: true }),
  ],
  community_post: [f("author", "text", { max: 80, meta: true })],
  guide: [f("section", "text", { max: 60, meta: true })],
  story: media([f("story_until", "date", { meta: true })]),
  video: media(),
  podcast: media([
    f("season", "number", { meta: true }),
    f("episode", "number", { meta: true }),
    f("explicit", "bool", { meta: true }),
    f("series", "text", { max: 120, meta: true }),
  ]),
  source: [
    f("kind", "select", {
      options: ["article", "book", "video", "podcast", "website", "other"],
      meta: true,
    }),
    f("authors", "tags", { meta: true }),
    f("publisher", "text", { max: 120, meta: true }),
    f("published_on", "date", { meta: true }),
    f("accessed_on", "date", { meta: true }),
    f("doi", "text", { max: 120, meta: true }),
    f("citation_style", "select", {
      options: ["apa7", "mla9", "chicago"],
      meta: true,
    }),
    f("notes", "longtext", { max: 2000, meta: true }),
  ],
};

export function fieldsFor(type: EntityType): FieldDef[] {
  return [...BASE_FIELDS, ...TYPE_FIELDS[type]];
}

/** Fields that may appear in templates, exports, imports and the public API. */
export function exposedFields(type: EntityType): FieldDef[] {
  return fieldsFor(type).filter((x) => !x.secret);
}

export function secretFields(type: EntityType): string[] {
  return fieldsFor(type)
    .filter((x) => x.secret)
    .map((x) => x.key);
}

/* ------------------------------ validation ------------------------------ */

const httpUrl = z
  .string()
  .max(2000)
  .refine((v) => {
    try {
      const u = new URL(v);
      return (
        (u.protocol === "http:" || u.protocol === "https:") &&
        !u.username &&
        !u.password
      );
    } catch {
      return false;
    }
  }, "http(s) url without credentials");

const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "date");

/** Media fields may also point into this site's own library (`/media/<id>`). */
const MEDIA_URL_KEYS = new Set([
  "media_url",
  "poster_url",
  "transcript_url",
  "og_image",
]);
const mediaPath = z
  .string()
  .max(500)
  .regex(/^\/media\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/)
  .refine((v) => !v.split("/").includes(".."), "path");

function zodField(d: FieldDef): z.ZodTypeAny {
  let t: z.ZodTypeAny;
  switch (d.kind) {
    case "text":
      t = z
        .string()
        .trim()
        .max(d.max ?? 500);
      break;
    case "longtext":
      t = z.string().max(d.max ?? 10_000);
      break;
    case "select":
      t = z.enum(d.options as [string, ...string[]]);
      break;
    case "tags":
      t = z.array(z.string().trim().min(1).max(40)).max(d.max ?? 20);
      break;
    case "url":
      t = MEDIA_URL_KEYS.has(d.key) ? z.union([httpUrl, mediaPath]) : httpUrl;
      break;
    case "number":
      t = z.number().finite();
      break;
    case "date":
      t = isoDate;
      break;
    case "bool":
      t = z.boolean();
      break;
    case "json":
      t = z.unknown();
      break;
  }
  if (d.key === "slug") t = (t as z.ZodString).regex(SLUG_RE);
  if (d.key === "faq")
    t = z
      .array(
        z.object({
          q: z.string().min(1).max(200),
          a: z.string().min(1).max(1000),
        }),
      )
      .max(10);
  if (d.key === "duration_sec") t = (t as z.ZodNumber).min(0).max(86_400);
  return d.required ? t : t.optional().nullable();
}

/**
 * Strict object for one type built from its non-secret fields: unknown keys (including secret
 * ones) are rejected, so a stream key in an import file is an error, not silently stored.
 * `visibility` accepts all four values here; the import pipeline narrows it to draft / private.
 */
export function zodFor(type: EntityType) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const d of exposedFields(type)) shape[d.key] = zodField(d);
  shape["visibility"] = z.enum(VISIBILITIES).optional().nullable();
  return z.object(shape).strict();
}

/** Same, with `visibility` limited to what an import may set. */
export function zodForImport(type: EntityType) {
  return zodFor(type).extend({
    visibility: z.enum(IMPORT_VISIBILITIES).optional().nullable(),
  });
}

/* -------------------------------- helpers -------------------------------- */

const TR_MAP: Record<string, string> = {
  ı: "i",
  İ: "i",
  ğ: "g",
  Ğ: "g",
  ü: "u",
  Ü: "u",
  ş: "s",
  Ş: "s",
  ö: "o",
  Ö: "o",
  ç: "c",
  Ç: "c",
  ä: "a",
  Ä: "a",
  ß: "ss",
  ñ: "n",
  Ñ: "n",
};

/** Lowercase ASCII slug; Turkish / German / Spanish letters are transliterated. */
export function slugify(text: string, max = 80): string {
  const mapped = [...text].map((c) => TR_MAP[c] ?? c).join("");
  const slug = mapped
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return slug || "item";
}

/** Fields a bulk "set field" may change: scalar, non-secret, not identity / body / visibility. */
const BULK_BLOCKED = new Set([
  "id",
  "slug",
  "external_id",
  "title",
  "body_md",
  "visibility",
  "faq",
  "summary",
]);
export function bulkSettableFields(type: EntityType): FieldDef[] {
  return exposedFields(type).filter(
    (f) =>
      !BULK_BLOCKED.has(f.key) && f.kind !== "json" && f.kind !== "longtext",
  );
}
