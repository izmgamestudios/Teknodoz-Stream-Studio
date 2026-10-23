// src/server/seo/validate.ts
// Structured-data and on-page checks for a rendered public page (pure: HTML + headers in, a
// list of issues out). Used by the test suite on every page type and by scripts/check-public.ts
// against a live site, so a regression in titles, canonical links or JSON-LD fails loudly.
export interface Issue {
  level: "error" | "warn";
  code: string;
  message: string;
}

type Json = Record<string, unknown>;

const text = (s: string): string =>
  s
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i").exec(tag);
  return m ? (m[1] ?? "") : null;
}

export function jsonLdBlocks(html: string): { blocks: Json[]; broken: number } {
  const blocks: Json[] = [];
  let broken = 0;
  for (const m of html.matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const v = JSON.parse(m[1] ?? "") as unknown;
      if (v && typeof v === "object") blocks.push(v as Json);
      else broken++;
    } catch {
      broken++;
    }
  }
  return { blocks, broken };
}

function nodesOf(blocks: Json[]): Json[] {
  const out: Json[] = [];
  for (const b of blocks) {
    const g = b["@graph"];
    if (Array.isArray(g)) out.push(...(g as Json[]));
    else out.push(b);
  }
  return out;
}

const REQUIRED: Record<string, string[]> = {
  VideoObject: ["name", "description", "thumbnailUrl", "uploadDate"],
  AudioObject: ["name"],
  PodcastEpisode: ["name"],
  PodcastSeries: ["name"],
  Article: ["headline"],
  Organization: ["name"],
  WebSite: ["name", "url"],
  FAQPage: ["mainEntity"],
  BreadcrumbList: ["itemListElement"],
};

export function validatePage(
  html: string,
  headers: Headers | Record<string, string>,
  opts: { origin?: string; indexable?: boolean } = {},
): Issue[] {
  const issues: Issue[] = [];
  const add = (level: Issue["level"], code: string, message: string) =>
    issues.push({ level, code, message });
  const h = (k: string): string | null =>
    headers instanceof Headers ? headers.get(k) : (headers[k] ?? null);
  const indexable = opts.indexable ?? true;

  if (!/^<!doctype html>/i.test(html.trimStart()))
    add("error", "doctype", "missing <!doctype html>");
  const lang = /<html[^>]*\slang="([a-z]{2}[^"]*)"/i.exec(html);
  if (!lang) add("error", "lang", "<html> has no lang attribute");
  if (!/<meta[^>]*name="viewport"/i.test(html))
    add("error", "viewport", "missing viewport meta");
  if (!/<meta[^>]*charset/i.test(html))
    add("warn", "charset", "missing charset meta");

  const title = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
  if (!title) add("error", "title", "missing <title>");
  else if (title.length > 70)
    add("warn", "title-length", `title is ${title.length} chars (>70)`);

  const desc = (html.match(/<meta[^>]*name="description"[^>]*>/i) ?? [""])[0];
  const descText = attr(desc, "content") ?? "";
  if (indexable && !descText)
    add("error", "description", "missing meta description");
  else if (descText.length > 320)
    add(
      "warn",
      "description-length",
      `description is ${descText.length} chars`,
    );

  const h1s = html.match(/<h1[\s>]/gi)?.length ?? 0;
  if (h1s !== 1) add("error", "h1", `expected one <h1>, found ${h1s}`);

  let prev = 0;
  for (const m of html.matchAll(/<h([1-6])[\s>]/gi)) {
    const lvl = Number(m[1]);
    if (prev && lvl > prev + 1) {
      add("error", "heading-order", `heading jumps from h${prev} to h${lvl}`);
      break;
    }
    prev = lvl;
  }

  const canonical = /<link[^>]*rel="canonical"[^>]*>/i.exec(html)?.[0];
  const href = canonical ? attr(canonical, "href") : null;
  if (indexable) {
    if (!href) add("error", "canonical", "missing canonical link");
    else if (!/^https?:\/\//.test(href))
      add("error", "canonical-abs", "canonical is not absolute");
    else if (opts.origin && !href.startsWith(opts.origin))
      add("error", "canonical-origin", `canonical leaves the site: ${href}`);
  }

  const robots = /<meta[^>]*name="robots"[^>]*>/i.exec(html)?.[0] ?? "";
  const noindex = /noindex/i.test(attr(robots, "content") ?? "");
  if (indexable && noindex)
    add("error", "noindex", "page is unexpectedly noindex");
  if (!indexable && !noindex && !/noindex/i.test(h("x-robots-tag") ?? ""))
    add("error", "should-noindex", "non-public page is indexable");

  for (const m of html.matchAll(/<img\b[^>]*>/gi))
    if (attr(m[0], "alt") === null)
      add("error", "img-alt", `image without alt: ${m[0].slice(0, 80)}`);

  // JSON-LD
  const { blocks, broken } = jsonLdBlocks(html);
  if (broken)
    add("error", "jsonld-parse", `${broken} JSON-LD block(s) do not parse`);
  const nodes = nodesOf(blocks);
  for (const b of blocks)
    if (b["@context"] !== "https://schema.org")
      add(
        "error",
        "jsonld-context",
        "JSON-LD block without schema.org @context",
      );
  for (const n of nodes) {
    const t = n["@type"];
    const types = Array.isArray(t)
      ? (t as string[])
      : typeof t === "string"
        ? [t]
        : [];
    if (!types.length)
      add("error", "jsonld-type", "JSON-LD node without @type");
    for (const ty of types)
      for (const f of REQUIRED[ty] ?? [])
        if (n[f] === undefined || n[f] === "")
          add("error", "jsonld-required", `${ty} is missing "${f}"`);
    if (types.includes("BreadcrumbList")) {
      const items = (n["itemListElement"] as Json[] | undefined) ?? [];
      items.forEach((it, i) => {
        if (it["position"] !== i + 1)
          add("error", "breadcrumb-order", "breadcrumb positions are not 1..n");
      });
    }
    if (types.includes("FAQPage")) {
      const visible = text(html.replace(/<script[\s\S]*?<\/script>/gi, ""));
      for (const q of (n["mainEntity"] as Json[] | undefined) ?? []) {
        const name = String(q["name"] ?? "");
        if (name && !visible.includes(name))
          add(
            "error",
            "faq-hidden",
            `FAQ question is not visible on the page: ${name}`,
          );
      }
    }
  }

  // headers
  if (h("x-content-type-options") !== "nosniff")
    add("error", "nosniff", "missing X-Content-Type-Options: nosniff");
  if (!h("content-security-policy"))
    add("error", "csp", "missing Content-Security-Policy");
  if (indexable && !h("cache-control"))
    add("warn", "cache", "missing Cache-Control");
  if (!/text\/html/i.test(h("content-type") ?? ""))
    add("error", "content-type", "not served as text/html");
  return issues;
}
