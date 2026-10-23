// src/studio/ui/content/labels.ts
// Human labels for registry fields, types and import issue codes (all through i18n).
import type { MessageKey } from "../../i18n/messages";
import {
  ENTITY_TYPES,
  PLANE,
  type EntityType,
} from "../../../shared/schema-registry";

export type T = (
  key: MessageKey,
  params?: Record<string, string | number>,
) => string;

export const CATALOG_TYPES: readonly EntityType[] = ENTITY_TYPES.filter(
  (t) => PLANE[t] === "catalog",
);

const LABELLED_FIELDS = new Set([
  "id",
  "external_id",
  "slug",
  "title",
  "summary",
  "body_md",
  "locale",
  "visibility",
  "tags",
  "source_url",
  "seo_title",
  "seo_description",
  "og_image",
  "noindex",
  "faq",
]);

const humanize = (key: string): string => {
  const s = key.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export const fieldLabel = (t: T, key: string): string =>
  LABELLED_FIELDS.has(key) ? t(`ct.field.${key}` as MessageKey) : humanize(key);

export const typeLabel = (t: T, type: EntityType): string =>
  t(`ct.type.${type}` as MessageKey);

const ISSUE_CODES = new Set([
  "import-cannot-publish",
  "duplicate-in-file",
  "id-not-found",
  "id-wrong-type",
  "keys-point-to-different-rows",
  "bad-number",
  "bad-bool",
  "bad-json",
  "bad-date",
  "secret-column",
]);

/** `column:code` (cell problems) or a bare code; anything else (schema messages) is shown as is. */
export function issueText(t: T, issue: string): string {
  const [head, tail] =
    issue.includes(":") && /^[a-z_]+:[a-z-]+$/.test(issue)
      ? (issue.split(":") as [string, string])
      : ["", issue];
  if (ISSUE_CODES.has(tail)) {
    const text = t(`ct.issue.${tail}` as MessageKey);
    return head ? `${head}: ${text}` : text;
  }
  return issue;
}
