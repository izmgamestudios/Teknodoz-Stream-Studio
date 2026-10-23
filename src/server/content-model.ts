// src/server/content-model.ts
// The catalog row, who may see it, and what the public gets to see. Every read path goes through
// `visibleTo` / `libraryView`, so visibility is enforced in one place (the browser is never trusted).
import { randomBytes } from "node:crypto";

import type { Block } from "../shared/blocks";
import {
  PUBLIC_TYPES,
  SCHEMA_VERSION,
  type EntityType,
  type Locale,
  type Visibility,
} from "../shared/schema-registry";

export interface ContentRow {
  /** 15 chars [a-z0-9]: doubles as the PocketBase record id */
  id: string;
  type: EntityType;
  external_id: string;
  slug: string;
  title: string;
  summary: string;
  body_blocks: Block[];
  locale: Locale;
  visibility: Visibility;
  /** access group for `protected` rows (S4) */
  access_group: string;
  tags: string[];
  source_url: string;
  og_image: string;
  seo_title: string;
  seo_description: string;
  noindex: boolean;
  /** type-specific fields (see the registry) + `faq` */
  meta: Record<string, unknown>;
  owner: string;
  schema_version: number;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export type Viewer =
  { role: "anonymous" } | { role: "admin" } | { role: "owner"; id: string };

const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
export function newContentId(): string {
  const bytes = randomBytes(15);
  return [...bytes].map((b) => ID_CHARS[b % ID_CHARS.length]).join("");
}
export const CONTENT_ID_RE = /^[a-z0-9]{15}$/;

/**
 * Raw row access (admin API, owner views).
 * - admin: everything, soft-deleted included (trash view)
 * - anyone: public rows that are not deleted
 * - owner: their own non-deleted rows in any state
 * `protected` rows are never returned raw to anonymous viewers.
 */
export function visibleTo(viewer: Viewer, row: ContentRow): boolean {
  if (viewer.role === "admin") return true;
  if (row.is_deleted) return false;
  if (row.visibility === "public") return true;
  return viewer.role === "owner" && row.owner !== "" && row.owner === viewer.id;
}

export interface LibraryItem {
  id: string;
  type: EntityType;
  slug: string;
  title: string;
  summary: string;
  body_blocks: Block[];
  locale: Locale;
  tags: string[];
  source_url: string;
  og_image: string;
  seo_title: string;
  seo_description: string;
  noindex: boolean;
  meta: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  protected: false;
}

export interface LibraryStub {
  id: string;
  type: EntityType;
  slug: string;
  title: string;
  protected: true;
}

/** What the anonymous public sees of a row: a full public item, a stub for protected rows, or null. */
export function libraryView(row: ContentRow): LibraryItem | LibraryStub | null {
  if (row.is_deleted || !PUBLIC_TYPES.includes(row.type)) return null;
  if (row.visibility === "protected")
    return {
      id: row.id,
      type: row.type,
      slug: row.slug,
      title: row.title,
      protected: true,
    };
  if (row.visibility !== "public") return null;
  return {
    id: row.id,
    type: row.type,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    body_blocks: row.body_blocks,
    locale: row.locale,
    tags: row.tags,
    source_url: row.source_url,
    og_image: row.og_image,
    seo_title: row.seo_title,
    seo_description: row.seo_description,
    noindex: row.noindex,
    meta: row.meta,
    created_at: row.created_at,
    updated_at: row.updated_at,
    protected: false,
  };
}

export function blankRow(
  type: EntityType,
  title: string,
  now: string,
  patch: Partial<ContentRow> = {},
): ContentRow {
  return {
    id: newContentId(),
    type,
    external_id: "",
    slug: "",
    title,
    summary: "",
    body_blocks: [],
    locale: "tr",
    visibility: "draft",
    access_group: "",
    tags: [],
    source_url: "",
    og_image: "",
    seo_title: "",
    seo_description: "",
    noindex: false,
    meta: {},
    owner: "",
    schema_version: SCHEMA_VERSION,
    is_deleted: false,
    created_at: now,
    updated_at: now,
    ...patch,
  };
}
