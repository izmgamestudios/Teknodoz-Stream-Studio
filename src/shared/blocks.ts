// src/shared/blocks.ts
// Structured body of a content item. No HTML is ever stored or rendered from user data.
import { z } from "zod";

export const EMBED_HOSTS = [
  "www.youtube.com",
  "www.youtube-nocookie.com",
  "player.vimeo.com",
  "open.spotify.com",
] as const;

const safeUrl = z
  .string()
  .max(2000)
  .refine((v) => {
    try {
      const u = new URL(v);
      return (
        (u.protocol === "https:" || u.protocol === "http:") &&
        !u.username &&
        !u.password
      );
    } catch {
      return false;
    }
  }, "url");

const text = z.string().max(5000);

export const blockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("heading"),
    level: z.number().int().min(1).max(4),
    text: z.string().max(300),
  }),
  z.object({ type: z.literal("paragraph"), text }),
  z.object({
    type: z.literal("list"),
    ordered: z.boolean(),
    items: z.array(z.string().max(1000)).max(100),
  }),
  z.object({
    type: z.literal("link"),
    url: safeUrl,
    text: z.string().max(300),
  }),
  z.object({
    type: z.literal("image"),
    url: safeUrl,
    alt: z.string().max(300),
  }),
  z.object({
    type: z.literal("embed"),
    url: safeUrl.refine(
      (v) => (EMBED_HOSTS as readonly string[]).includes(new URL(v).hostname),
      "embed-host",
    ),
  }),
]);
export type Block = z.infer<typeof blockSchema>;

export const blocksSchema = z.array(blockSchema).max(500);

/** Plain text of the blocks (search index, markdown twin, summaries). */
export function blocksToText(blocks: readonly Block[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case "heading":
        case "paragraph":
          return b.text;
        case "list":
          return b.items.join("\n");
        case "link":
          return b.text;
        case "image":
          return b.alt;
        case "embed":
          return "";
      }
    })
    .filter(Boolean)
    .join("\n\n");
}

/** Paragraph blocks from plain text (blank line = new paragraph). */
export function textToBlocks(input: string): Block[] {
  return input
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 500)
    .map((p) => ({ type: "paragraph" as const, text: p.slice(0, 5000) }));
}
