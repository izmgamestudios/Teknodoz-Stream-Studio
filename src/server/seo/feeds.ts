// src/server/seo/feeds.ts
// Machine-readable surfaces: robots.txt, sitemaps (index + paged, with video entries), llms.txt /
// llms-full.txt, the Markdown twin of an item, the podcast RSS feed and oEmbed. Pure builders.
import { blocksToMd } from "../../shared/markdown";
import type { Cue } from "../../studio/watch/cues";
import type { ContentRow } from "../content-model";
import { citationOf, citationText } from "./citation";
import { esc } from "./html";
import {
  descriptionOf,
  durationOf,
  faqOf,
  fmtTime,
  itemPath,
  listPath,
  mediaOf,
  posterOf,
  TYPE_PATH,
} from "./model";
import type { SiteConfig } from "./site";

export const SITEMAP_CHUNK = 1000;

const AI_BOTS = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "Google-Extended",
  "PerplexityBot",
  "ClaudeBot",
  "anthropic-ai",
  "CCBot",
  "Bytespider",
  "Applebot-Extended",
];

export function robotsTxt(site: SiteConfig): string {
  const lines = [
    "User-agent: *",
    "Allow: /library",
    "Allow: /docs",
    "Allow: /embed",
    "Disallow: /admin",
    "Disallow: /api/",
    "Disallow: /r/",
    "Disallow: /join",
    "Disallow: /remote",
    "Disallow: /chat/",
    "",
  ];
  if (site.aiCrawlers === "block")
    for (const bot of AI_BOTS)
      lines.push(`User-agent: ${bot}`, "Disallow: /", "");
  lines.push(
    `Sitemap: ${site.origin}/sitemap.xml`,
    `# LLM site map: ${site.origin}/llms.txt`,
  );
  return `${lines.join("\n")}\n`;
}

/* -------------------------------- sitemaps ------------------------------- */

const XML = '<?xml version="1.0" encoding="UTF-8"?>\n';
const day = (iso: string): string => iso.slice(0, 10);

export function sitemapIndex(
  site: SiteConfig,
  parts: { path: string; lastmod: string }[],
): string {
  return `${XML}<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${parts
    .map(
      (p) =>
        `<sitemap><loc>${esc(site.origin + p.path)}</loc><lastmod>${esc(day(p.lastmod))}</lastmod></sitemap>`,
    )
    .join("\n")}\n</sitemapindex>\n`;
}

export function sitemapUrls(
  site: SiteConfig,
  rows: readonly ContentRow[],
): string {
  const entries = rows.map((r) => {
    const loc = site.origin + itemPath(r.type, r.slug);
    const media = mediaOf(r, site);
    const poster = posterOf(r, site, media);
    const dur = durationOf(r);
    const video =
      r.type !== "podcast" && poster && (media.src || media.embed)
        ? `<video:video><video:thumbnail_loc>${esc(poster)}</video:thumbnail_loc><video:title>${esc(r.title)}</video:title><video:description>${esc(descriptionOf(r))}</video:description>${media.src ? `<video:content_loc>${esc(media.src)}</video:content_loc>` : `<video:player_loc>${esc(media.embed)}</video:player_loc>`}${dur ? `<video:duration>${Math.round(dur)}</video:duration>` : ""}<video:publication_date>${esc(r.created_at)}</video:publication_date><video:family_friendly>yes</video:family_friendly></video:video>`
        : "";
    return `<url><loc>${esc(loc)}</loc><lastmod>${esc(day(r.updated_at))}</lastmod><xhtml:link rel="alternate" hreflang="${esc(r.locale)}" href="${esc(loc)}"/>${video}</url>`;
  });
  return `${XML}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">\n${entries.join("\n")}\n</urlset>\n`;
}

/** Only pages that have content: empty lists are served noindex and must not be advertised. */
export function sitemapPages(
  site: SiteConfig,
  lastmod: string,
  paths: readonly string[],
): string {
  return `${XML}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map((p) => `<url><loc>${esc(site.origin + p)}</loc><lastmod>${esc(day(lastmod))}</lastmod></url>`).join("\n")}\n</urlset>\n`;
}

/* ---------------------------------- llms --------------------------------- */

export function llmsTxt(
  site: SiteConfig,
  sections: { title: string; path: string; rows: readonly ContentRow[] }[],
  sourcesCount: number,
): string {
  const out = [
    `# ${site.siteName}`,
    "",
    `> Public library of stories, videos and podcasts published by ${site.publisherName}. Every item has a server-rendered page with a summary, transcript and FAQ, and a Markdown twin (add .md to the item URL). Content can be read anonymously; attribute quotations to ${site.publisherName} and link the item URL.`,
    "",
    `Full text of recent items: ${site.origin}/llms-full.txt`,
    "",
  ];
  for (const s of sections) {
    out.push(`## ${s.title}`, "");
    for (const r of s.rows)
      out.push(
        `- [${r.title}](${site.origin}${itemPath(r.type, r.slug)}.md): ${descriptionOf(r)}`,
      );
    out.push(`- [All ${s.title.toLowerCase()}](${site.origin}${s.path})`, "");
  }
  out.push(
    "## Optional",
    "",
    `- [Sources and references](${site.origin}/docs) (${sourcesCount})`,
    `- [Sitemap](${site.origin}/sitemap.xml)`,
    "",
  );
  return out.join("\n");
}

export function markdownTwin(
  site: SiteConfig,
  row: ContentRow,
  cues: readonly Cue[],
): string {
  const url = site.origin + itemPath(row.type, row.slug);
  const dur = durationOf(row);
  const faq = faqOf(row);
  const parts = [
    `# ${row.title}`,
    "",
    [
      `- URL: ${url}`,
      `- Publisher: ${site.publisherName}`,
      `- Type: ${row.type}`,
      `- Language: ${row.locale}`,
      `- Published: ${row.created_at.slice(0, 10)}`,
      `- Updated: ${row.updated_at.slice(0, 10)}`,
      dur ? `- Duration: ${fmtTime(dur * 1000)}` : "",
      row.tags.length ? `- Tags: ${row.tags.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    "",
  ];
  if (row.summary) parts.push("## Summary", "", row.summary, "");
  const body = blocksToMd(row.body_blocks);
  if (body) parts.push(body, "");
  if (faq.length)
    parts.push(
      "## FAQ",
      "",
      ...faq.flatMap((f) => [`**${f.q}**`, "", f.a, ""]),
    );
  if (cues.length)
    parts.push(
      "## Transcript",
      "",
      ...cues.map(
        (c) => `[${fmtTime(c.startMs)}] ${c.text.replace(/\n/g, " ")}`,
      ),
      "",
    );
  if (row.source_url) parts.push("## Source", "", row.source_url, "");
  return `${parts.join("\n")}\n`;
}

export function llmsFull(
  site: SiteConfig,
  rows: readonly ContentRow[],
): string {
  return `${rows.map((r) => markdownTwin(site, r, []).trimEnd()).join("\n\n---\n\n")}\n`;
}

export { citationOf, citationText };

/* ----------------------------------- rss ---------------------------------- */

const rfc822 = (iso: string): string => new Date(iso).toUTCString();

export function podcastRss(
  site: SiteConfig,
  rows: readonly ContentRow[],
  language: string,
): string {
  const link = `${site.origin}${listPath("podcast")}`;
  const items = rows
    .map((r) => {
      const media = mediaOf(r, site);
      if (!media.src) return "";
      const url = site.origin + itemPath(r.type, r.slug);
      const dur = durationOf(r);
      return `<item><title>${esc(r.title)}</title><link>${esc(url)}</link><guid isPermaLink="true">${esc(url)}</guid><pubDate>${rfc822(r.created_at)}</pubDate><description>${esc(descriptionOf(r))}</description><enclosure url="${esc(media.src)}" length="0" type="${esc(media.mime || "audio/mpeg")}"/>${dur ? `<itunes:duration>${Math.round(dur)}</itunes:duration>` : ""}${typeof r.meta["episode"] === "number" ? `<itunes:episode>${r.meta["episode"]}</itunes:episode>` : ""}<itunes:explicit>${r.meta["explicit"] === true ? "true" : "false"}</itunes:explicit></item>`;
    })
    .filter(Boolean)
    .join("\n");
  return `${XML}<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${esc(site.siteName)} — Podcasts</title><link>${esc(link)}</link><atom:link href="${esc(`${link}/feed.xml`)}" rel="self" type="application/rss+xml"/><description>${esc(site.siteName)}</description><language>${esc(language)}</language><itunes:author>${esc(site.publisherName)}</itunes:author><itunes:image href="${esc(site.logoUrl)}"/><image><url>${esc(site.logoUrl)}</url><title>${esc(site.siteName)}</title><link>${esc(link)}</link></image>\n${items}\n</channel></rss>\n`;
}

/* --------------------------------- oembed -------------------------------- */

export function oembed(
  site: SiteConfig,
  row: ContentRow,
  maxWidth: number,
  maxHeight: number,
) {
  const width = Math.min(Math.max(maxWidth || 640, 200), 1280);
  const height = Math.min(
    Math.round((width * 9) / 16),
    maxHeight > 0 ? maxHeight : 10_000,
  );
  const media = mediaOf(row, site);
  const poster = posterOf(row, site, media);
  const src = `${site.origin}/embed/${TYPE_PATH[row.type]}/${row.slug}`;
  return {
    version: "1.0",
    type: "video",
    provider_name: site.siteName,
    provider_url: site.origin,
    author_name: site.publisherName,
    author_url: site.publisherUrl,
    title: row.title,
    width,
    height,
    ...(poster ? { thumbnail_url: poster } : {}),
    html: `<iframe src="${esc(src)}" width="${width}" height="${height}" loading="lazy" allowfullscreen title="${esc(row.title)}"></iframe>`,
  };
}
