// src/server/seo/citation.ts
// APA 7 references for the public /docs page (the default and only fully supported style;
// `mla9` / `chicago` rows fall back to APA 7 until those styles are added).
import type { ContentRow } from "../content-model";

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** "Bayer, H." from "Hüseyin Bayer"; organisations (no space) stay as is. */
function apaAuthor(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name.trim();
  const last = parts[parts.length - 1]!;
  const initials = parts
    .slice(0, -1)
    .map((p) => `${p.charAt(0).toLocaleUpperCase("tr")}.`)
    .join(" ");
  return `${last}, ${initials}`;
}

function authorList(authors: string[]): string {
  const a = authors.map(apaAuthor);
  if (a.length === 0) return "";
  if (a.length === 1) return a[0]!;
  if (a.length === 2) return `${a[0]}, & ${a[1]}`;
  const shown = a.slice(0, 20);
  return `${shown.slice(0, -1).join(", ")}, & ${shown[shown.length - 1]}`;
}

export interface Citation {
  /** plain text parts, rendered by the page (title may be italic) */
  authors: string;
  year: string;
  title: string;
  italicTitle: boolean;
  publisher: string;
  url: string;
  doi: string;
}

export function citationOf(row: ContentRow): Citation {
  const m = row.meta;
  const kind = str(m["kind"]) || "other";
  const authors = Array.isArray(m["authors"])
    ? (m["authors"] as unknown[]).filter(
        (x): x is string => typeof x === "string",
      )
    : [];
  const published = str(m["published_on"]);
  const year = /^\d{4}/.test(published) ? published.slice(0, 4) : "n.d.";
  const doi = str(m["doi"]).replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
  return {
    authors: authorList(authors) || str(m["publisher"]),
    year,
    title: row.title,
    italicTitle:
      kind === "book" ||
      kind === "video" ||
      kind === "podcast" ||
      kind === "website",
    publisher: authors.length ? str(m["publisher"]) : "",
    url: doi ? `https://doi.org/${doi}` : row.source_url,
    doi,
  };
}

/** Plain-text reference (Markdown twin, llms files). */
export function citationText(c: Citation): string {
  return [
    `${c.authors ? `${c.authors} ` : ""}(${c.year}).`,
    `${c.title}.`,
    c.publisher ? `${c.publisher}.` : "",
    c.url,
  ]
    .filter(Boolean)
    .join(" ");
}
