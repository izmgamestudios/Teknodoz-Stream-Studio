// src/shared/markdown.ts
// Restricted Markdown <-> body blocks, no library and no HTML. Supported: # headings (1-4),
// paragraphs, - / * / 1. lists, a line that is only a link / image / allowlisted embed URL.
// Inline emphasis markers are dropped, inline links become "text (url)", and every `<tag>` is
// removed, so nothing that looks like markup survives into stored text.
import { EMBED_HOSTS, blockSchema, type Block } from "./blocks";

const stripInline = (s: string): string =>
  s
    .replace(/<[^>]*>/g, "")
    .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, "$1 ($2)")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();

const valid = (b: unknown): Block | null => {
  const r = blockSchema.safeParse(b);
  return r.success ? r.data : null;
};

const isEmbedUrl = (u: string): boolean => {
  try {
    return (EMBED_HOSTS as readonly string[]).includes(new URL(u).hostname);
  } catch {
    return false;
  }
};

export function mdToBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const push = (b: unknown) => {
    const v = valid(b);
    if (v) out.push(v);
  };
  const flushPara = () => {
    if (para.length)
      push({
        type: "paragraph",
        text: stripInline(para.join(" ")).slice(0, 5000),
      });
    para = [];
  };
  const flushList = () => {
    if (list && list.items.length)
      push({
        type: "list",
        ordered: list.ordered,
        items: list.items.slice(0, 100),
      });
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") {
      flushPara();
      flushList();
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      flushList();
      push({
        type: "heading",
        level: h[1]!.length,
        text: stripInline(h[2]!).slice(0, 300),
      });
      continue;
    }
    const li = /^(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (li) {
      flushPara();
      const ordered = li[2] !== undefined;
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push(stripInline(li[3]!).slice(0, 1000));
      continue;
    }
    flushList();
    const img = /^!\[([^\]]*)\]\(([^)\s]+)[^)]*\)$/.exec(line);
    if (img) {
      flushPara();
      push({
        type: "image",
        url: img[2],
        alt: stripInline(img[1]!).slice(0, 300),
      });
      continue;
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)[^)]*\)$/.exec(line);
    if (link) {
      flushPara();
      push({
        type: "link",
        url: link[2],
        text: stripInline(link[1]!).slice(0, 300),
      });
      continue;
    }
    if (/^https?:\/\/\S+$/.test(line) && isEmbedUrl(line)) {
      flushPara();
      push({ type: "embed", url: line });
      continue;
    }
    para.push(line);
  }
  flushPara();
  flushList();
  return out.slice(0, 500);
}

export function blocksToMd(blocks: readonly Block[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case "heading":
          return `${"#".repeat(b.level)} ${b.text}`;
        case "paragraph":
          return b.text;
        case "list":
          return b.items
            .map((t, i) => (b.ordered ? `${i + 1}. ${t}` : `- ${t}`))
            .join("\n");
        case "link":
          return `[${b.text}](${b.url})`;
        case "image":
          return `![${b.alt}](${b.url})`;
        case "embed":
          return b.url;
      }
    })
    .join("\n\n");
}
