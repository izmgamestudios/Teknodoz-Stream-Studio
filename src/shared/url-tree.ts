// src/shared/url-tree.ts
// URL tree <-> `source` rows. Import formats: indented text (`- Title | https://… | private | tag1, tag2`)
// and nested JSON (`{ title, url, visibility, tags, children }`). Rows go through the normal import
// pipeline, so a tree can never create public items. Export: the same two formats plus a
// sitemap.xml with the public nodes only. URLs must be http(s) without credentials and must not
// point at localhost or private / link-local addresses (no server-side fetching happens anyway).
import { slugify } from "./schema-registry";
import type { Cells } from "./tabular";

export const MAX_TREE_NODES = 5000;
export const MAX_TREE_DEPTH = 8;

export interface TreeNode {
  title: string;
  url: string;
  visibility?: "draft" | "private";
  tags: string[];
  children: TreeNode[];
}

export type TreeError =
  | "empty"
  | "too-many-nodes"
  | "too-deep"
  | "bad-indent"
  | "bad-line"
  | "bad-url"
  | "tree-cannot-publish"
  | "bad-json";

export class TreeParseError extends Error {
  constructor(
    readonly code: TreeError,
    readonly line: number,
  ) {
    super(code);
  }
}

/* ------------------------------ url safety ------------------------------ */

function privateIPv4(h: string): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

/** http(s), no credentials, a real public hostname (not localhost / private / link-local). */
export function isSafePublicUrl(raw: string): boolean {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2000)
    return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "" ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan")
  )
    return false;
  if (privateIPv4(host)) return false;
  if (host.includes(":")) {
    // IPv6 literal: loopback, unspecified, unique-local, link-local, IPv4-mapped / compatible
    if (
      host === "::1" ||
      host === "::" ||
      /^f[cd]/.test(host) ||
      /^fe[89ab]/.test(host) ||
      host.startsWith("::ffff:") ||
      host.startsWith("::")
    )
      return false;
  } else if (!host.includes(".")) return false; // single-label names resolve on internal networks
  return true;
}

/* -------------------------------- parsing -------------------------------- */

const VIS = new Set(["draft", "private"]);

function makeNode(parts: string[], line: number): TreeNode {
  const [title = "", url = "", visibility = "", tags = ""] = parts.map((p) =>
    p.trim(),
  );
  if (!title) throw new TreeParseError("bad-line", line);
  if (!isSafePublicUrl(url)) throw new TreeParseError("bad-url", line);
  if (visibility && !VIS.has(visibility.toLowerCase()))
    throw new TreeParseError("tree-cannot-publish", line);
  return {
    title: title.slice(0, 200),
    url,
    ...(visibility
      ? { visibility: visibility.toLowerCase() as "draft" | "private" }
      : {}),
    tags: tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 20),
    children: [],
  };
}

/** Indented text: one node per line, `- ` optional, indent = 2 spaces / 1 tab per level. */
export function parseTreeText(text: string): TreeNode[] {
  const roots: TreeNode[] = [];
  const stack: { depth: number; node: TreeNode }[] = [];
  let count = 0;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    if (raw.trim() === "" || raw.trim().startsWith("#")) continue;
    const indent = /^[ \t]*/.exec(raw)![0];
    const width = indent.replace(/\t/g, "  ").length;
    if (width % 2 !== 0) throw new TreeParseError("bad-indent", i + 1);
    const depth = width / 2;
    if (depth >= MAX_TREE_DEPTH) throw new TreeParseError("too-deep", i + 1);
    const body = raw.trim().replace(/^[-*+]\s+/, "");
    const node = makeNode(body.split("|"), i + 1);
    if (++count > MAX_TREE_NODES)
      throw new TreeParseError("too-many-nodes", i + 1);
    while (stack.length && stack[stack.length - 1]!.depth >= depth) stack.pop();
    const parent = stack[stack.length - 1];
    if (depth > 0 && (!parent || parent.depth !== depth - 1))
      throw new TreeParseError("bad-indent", i + 1);
    (parent ? parent.node.children : roots).push(node);
    stack.push({ depth, node });
  }
  if (roots.length === 0) throw new TreeParseError("empty", 0);
  return roots;
}

export function parseTreeJson(text: string): TreeNode[] {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new TreeParseError("bad-json", 0);
  }
  let count = 0;
  const walk = (x: unknown, depth: number): TreeNode => {
    if (typeof x !== "object" || x === null)
      throw new TreeParseError("bad-json", 0);
    if (depth >= MAX_TREE_DEPTH) throw new TreeParseError("too-deep", 0);
    if (++count > MAX_TREE_NODES) throw new TreeParseError("too-many-nodes", 0);
    const o = x as {
      title?: unknown;
      url?: unknown;
      visibility?: unknown;
      tags?: unknown;
      children?: unknown;
    };
    const node = makeNode(
      [
        String(o.title ?? ""),
        String(o.url ?? ""),
        o.visibility === undefined || o.visibility === null
          ? ""
          : String(o.visibility),
        Array.isArray(o.tags) ? o.tags.map(String).join(",") : "",
      ],
      0,
    );
    if (Array.isArray(o.children))
      node.children = o.children.map((c) => walk(c, depth + 1));
    return node;
  };
  const arr = Array.isArray(v)
    ? v
    : ((v as { children?: unknown; roots?: unknown })?.roots ??
      (v as { children?: unknown })?.children ?? [v]);
  if (!Array.isArray(arr) || arr.length === 0)
    throw new TreeParseError("empty", 0);
  return arr.map((n) => walk(n, 0));
}

export function parseTree(text: string): TreeNode[] {
  return text.trimStart().startsWith("[") || text.trimStart().startsWith("{")
    ? parseTreeJson(text)
    : parseTreeText(text);
}

/* ------------------------------ to import rows ----------------------------- */

const extId = (path: string[]): string => {
  const id = `tree:${path.map((p) => slugify(p, 30)).join("/")}`;
  return id.length <= 100
    ? id
    : `${id.slice(0, 90)}~${path.length}${id.length % 1000}`;
};

/** Cells for the `source` template, parents before children, ids stable per path. */
export function treeToCells(nodes: readonly TreeNode[]): Cells[] {
  const out: Cells[] = [];
  const seen = new Set<string>();
  const walk = (n: TreeNode, path: string[], parent: string): void => {
    let ext = extId([...path, n.title]);
    for (let i = 2; seen.has(ext); i++)
      ext = `${extId([...path, n.title])}-${i}`;
    seen.add(ext);
    out.push({
      external_id: ext,
      title: n.title,
      source_url: n.url,
      kind: "website",
      visibility: n.visibility ?? "draft",
      tags: n.tags.join(", "),
      parent,
    });
    for (const c of n.children) walk(c, [...path, n.title], ext);
  };
  for (const r of nodes) walk(r, [], "");
  return out;
}

/* -------------------------------- export --------------------------------- */

export interface SourceRowLike {
  title: string;
  source_url: string;
  visibility: string;
  tags: string[];
  external_id: string;
  meta: Record<string, unknown>;
}

export function rowsToTree(rows: readonly SourceRowLike[]): TreeNode[] {
  const byExt = new Map<string, TreeNode>();
  const order: { node: TreeNode; parent: string }[] = [];
  for (const r of rows) {
    const node: TreeNode = {
      title: r.title,
      url: r.source_url,
      ...(r.visibility === "draft" || r.visibility === "private"
        ? { visibility: r.visibility }
        : {}),
      tags: r.tags,
      children: [],
    };
    if (r.external_id) byExt.set(r.external_id, node);
    order.push({
      node,
      parent: typeof r.meta["parent"] === "string" ? r.meta["parent"] : "",
    });
  }
  const roots: TreeNode[] = [];
  for (const { node, parent } of order) {
    const p = parent ? byExt.get(parent) : undefined;
    (p ? p.children : roots).push(node);
  }
  return roots;
}

export function treeToText(nodes: readonly TreeNode[], depth = 0): string {
  return nodes
    .map((n) => {
      const parts = [n.title, n.url, n.visibility ?? "", n.tags.join(", ")];
      while (parts.length > 2 && parts[parts.length - 1] === "") parts.pop();
      return `${"  ".repeat(depth)}- ${parts.join(" | ")}\n${treeToText(n.children, depth + 1)}`;
    })
    .join("");
}

export const treeToJson = (nodes: readonly TreeNode[]): string =>
  JSON.stringify(nodes, null, 2);

const xml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** sitemap.xml with the PUBLIC nodes only (draft / private / protected never appear). */
export function treeSitemap(rows: readonly SourceRowLike[]): string {
  const urls = rows
    .filter((r) => r.visibility === "public" && isSafePublicUrl(r.source_url))
    .map((r) => `<url><loc>${xml(r.source_url)}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}
