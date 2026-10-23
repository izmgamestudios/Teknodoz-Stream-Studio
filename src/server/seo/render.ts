// src/server/seo/render.ts
// Server-rendered public pages (plain HTML, no client framework). Everything user-provided goes
// through esc(); URLs are validated by absUrl(); the only script is the constant unlock handler.
import type { Block } from "../../shared/blocks";
import { EMBED_HOSTS } from "../../shared/blocks";
import type { Locale } from "../../shared/schema-registry";
import type { Cue } from "../../studio/watch/cues";
import type { ContentRow } from "../content-model";
import { citationOf, type Citation } from "./citation";
import { esc, shell, type PageHead } from "./html";
import {
  itemGraph,
  listGraph,
  breadcrumb,
  orgNode,
  websiteNode,
} from "./jsonld";
import {
  clip,
  descriptionOf,
  faqOf,
  fmtTime,
  itemPath,
  listPath,
  mediaOf,
  posterOf,
  titleOf,
  TYPE_PATH,
  type MediaInfo,
} from "./model";
import { absUrl, type SiteConfig } from "./site";
import { tx, type TextKey } from "./text";

export interface Page {
  status: number;
  html: string;
  robots: string;
}

const robotsIndex =
  "index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1";

function chrome(site: SiteConfig, locale: Locale) {
  return {
    home: "/library",
    brand: site.siteName,
    skip: tx(locale, "skip"),
    links: [
      { href: "/library/stories", label: tx(locale, "stories") },
      { href: "/library/videos", label: tx(locale, "videos") },
      { href: "/library/podcasts", label: tx(locale, "podcasts") },
      { href: "/docs", label: tx(locale, "docs") },
      { href: "/", label: tx(locale, "app") },
    ],
  };
}

const footer = (site: SiteConfig, locale: Locale): string =>
  `© ${new Date().getFullYear()} ${esc(site.publisherName)} · ${esc(tx(locale, "footer"))}`;

const baseHead = (
  site: SiteConfig,
  locale: Locale,
  p: Partial<PageHead> & Pick<PageHead, "title" | "description" | "canonical">,
): PageHead => ({
  lang: locale,
  robots: robotsIndex,
  ogType: "website",
  ogImage: site.ogImage,
  siteName: site.siteName,
  twitter: site.twitter,
  ...p,
});

/* -------------------------------- blocks -------------------------------- */

export function blocksHtml(blocks: readonly Block[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case "heading": {
          const n = Math.min(5, b.level + 1);
          return `<h${n}>${esc(b.text)}</h${n}>`;
        }
        case "paragraph":
          return `<p>${esc(b.text)}</p>`;
        case "list": {
          const tag = b.ordered ? "ol" : "ul";
          return `<${tag}>${b.items.map((i) => `<li>${esc(i)}</li>`).join("")}</${tag}>`;
        }
        case "link":
          return `<p><a href="${esc(b.url)}" rel="noopener nofollow ugc">${esc(b.text || b.url)}</a></p>`;
        case "image":
          return `<p><img src="${esc(b.url)}" alt="${esc(b.alt)}" loading="lazy" width="800"></p>`;
        case "embed":
          return (EMBED_HOSTS as readonly string[]).includes(
            new URL(b.url).hostname,
          )
            ? `<div class="player"><iframe src="${esc(b.url)}" loading="lazy" title="embed" allow="fullscreen"></iframe></div>`
            : "";
      }
    })
    .join("\n");
}

/* --------------------------------- player -------------------------------- */

export function playerHtml(
  row: ContentRow,
  media: MediaInfo,
  poster: string,
): string {
  if (media.kind === "youtube" || media.kind === "vimeo")
    return `<div class="player"><iframe src="${esc(media.embed)}" title="${esc(row.title)}" loading="lazy" allow="fullscreen; picture-in-picture"></iframe></div>`;
  if (media.kind === "video")
    return `<div class="player"><video controls preload="none" playsinline${poster ? ` poster="${esc(poster)}"` : ""} src="${esc(media.src)}"${media.mime ? "" : ""}>${media.mime ? `<source src="${esc(media.src)}" type="${esc(media.mime)}">` : ""}</video></div>`;
  if (media.kind === "audio")
    return `<div class="player audio"><audio controls preload="none" src="${esc(media.src)}"></audio></div>`;
  return "";
}

/* --------------------------------- cards --------------------------------- */

function card(site: SiteConfig, row: ContentRow, locale: Locale): string {
  const href = itemPath(row.type, row.slug);
  const media = mediaOf(row, site);
  const poster = posterOf(row, site, media);
  const lock = row.visibility === "protected";
  return `<li class="card"><a class="cover" href="${esc(href)}" aria-hidden="true" tabindex="-1">${poster ? `<img src="${esc(poster)}" alt="" loading="lazy" width="480" height="270">` : ""}</a><div class="body"><h3><a href="${esc(href)}">${lock ? "🔒 " : ""}${esc(row.title)}</a></h3>${lock ? `<p>${esc(tx(locale, "locked"))}</p>` : row.summary ? `<p>${esc(clip(row.summary, 140))}</p>` : ""}</div></li>`;
}

const cards = (
  site: SiteConfig,
  rows: readonly ContentRow[],
  locale: Locale,
): string =>
  `<ul class="grid">${rows.map((r) => card(site, r, locale)).join("")}</ul>`;

const typeLabel = (locale: Locale, type: string): string =>
  tx(locale, TYPE_PATH[type] as TextKey);

/* --------------------------------- pages --------------------------------- */

export function renderIndex(
  site: SiteConfig,
  locale: Locale,
  sections: { type: "story" | "video" | "podcast"; rows: ContentRow[] }[],
): Page {
  const title = `${tx(locale, "indexTitle")} | ${site.siteName}`;
  const body = `<h1>${esc(tx(locale, "indexTitle"))}</h1><p class="meta">${esc(tx(locale, "indexDesc"))}</p>${sections
    .map(
      (s) =>
        `<h2><a href="${listPath(s.type)}">${esc(typeLabel(locale, s.type))}</a></h2>${s.rows.length ? cards(site, s.rows, locale) : `<p class="meta">${esc(tx(locale, "empty"))}</p>`}`,
    )
    .join("")}`;
  const head = baseHead(site, locale, {
    title,
    description: tx(locale, "indexDesc"),
    canonical: `${site.origin}/library`,
    jsonLd: {
      "@context": "https://schema.org",
      "@graph": [
        orgNode(site),
        websiteNode(site),
        breadcrumb(site, [{ name: tx(locale, "library"), path: "/library" }]),
      ],
    },
  });
  return {
    status: 200,
    robots: head.robots,
    html: shell(head, chrome(site, locale), body, footer(site, locale)),
  };
}

export function renderList(
  site: SiteConfig,
  locale: Locale,
  type: "story" | "video" | "podcast",
  page: number,
  rows: ContentRow[],
  hasMore: boolean,
): Page {
  const label = typeLabel(locale, type);
  const path = listPath(type);
  const canonical = `${site.origin}${path}${page > 1 ? `?page=${page}` : ""}`;
  const crumbs = [
    { name: tx(locale, "library"), path: "/library" },
    { name: label, path },
  ];
  const desc = tx(locale, "listDesc", {
    type: label.toLowerCase(),
    site: site.siteName,
  });
  const pager = `<nav class="pager" aria-label="${esc(tx(locale, "page"))}">${page > 1 ? `<a rel="prev" href="${esc(`${path}${page > 2 ? `?page=${page - 1}` : ""}`)}">← ${esc(tx(locale, "prev"))}</a>` : ""}<span>${esc(tx(locale, "page"))} ${page}</span>${hasMore ? `<a rel="next" href="${esc(`${path}?page=${page + 1}`)}">${esc(tx(locale, "next"))} →</a>` : ""}</nav>`;
  const body = `<nav class="crumbs" aria-label="breadcrumb"><a href="/library">${esc(tx(locale, "library"))}</a> › ${esc(label)}</nav><h1>${esc(label)}</h1><p class="meta">${esc(desc)}</p>${rows.length ? cards(site, rows, locale) : `<p>${esc(tx(locale, "empty"))}</p>`}${pager}`;
  const head = baseHead(site, locale, {
    title: `${label}${page > 1 ? ` (${tx(locale, "page")} ${page})` : ""} | ${site.siteName}`,
    description: desc,
    canonical,
    jsonLd: listGraph(site, label, path, crumbs, rows),
    extra: `${page > 1 ? `<link rel="prev" href="${esc(`${site.origin}${path}${page > 2 ? `?page=${page - 1}` : ""}`)}">` : ""}${hasMore ? `<link rel="next" href="${esc(`${site.origin}${path}?page=${page + 1}`)}">` : ""}${type === "podcast" ? `<link rel="alternate" type="application/rss+xml" title="${esc(label)}" href="${site.origin}/library/podcasts/feed.xml">` : ""}`,
    robots: rows.length === 0 ? "noindex,follow" : robotsIndex,
  });
  return {
    status: 200,
    robots: head.robots,
    html: shell(head, chrome(site, locale), body, footer(site, locale)),
  };
}

export function renderItem(
  site: SiteConfig,
  row: ContentRow,
  cues: readonly Cue[],
  related: readonly ContentRow[],
): Page {
  const locale = row.locale;
  const path = itemPath(row.type, row.slug);
  const url = `${site.origin}${path}`;
  const media = mediaOf(row, site);
  const poster = posterOf(row, site, media);
  const label = typeLabel(locale, row.type);
  const crumbs = [
    { name: tx(locale, "library"), path: "/library" },
    { name: label, path: listPath(row.type) },
    { name: row.title, path },
  ];
  const fmt = new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeZone: "UTC",
  });
  const faq = faqOf(row);
  const embedCode = `<iframe src="${site.origin}/embed/${TYPE_PATH[row.type]}/${row.slug}" width="640" height="360" loading="lazy" allowfullscreen title="${row.title.replace(/["<>&]/g, "")}"></iframe>`;

  const body = `<nav class="crumbs" aria-label="breadcrumb"><a href="/library">${esc(tx(locale, "library"))}</a> › <a href="${esc(listPath(row.type))}">${esc(label)}</a></nav>
<article>
<h1>${esc(row.title)}</h1>
<p class="meta">${esc(tx(locale, "by"))}: <a href="${esc(site.publisherUrl)}">${esc(site.publisherName)}</a> · ${esc(tx(locale, "published"))}: <time datetime="${esc(row.created_at)}">${esc(fmt.format(new Date(row.created_at)))}</time> · ${esc(tx(locale, "updated"))}: <time datetime="${esc(row.updated_at)}">${esc(fmt.format(new Date(row.updated_at)))}</time></p>
${row.summary ? `<div class="answer"><strong>${esc(tx(locale, "summary"))}</strong><br>${esc(row.summary)}</div>` : ""}
${playerHtml(row, media, poster)}
${blocksHtml(row.body_blocks)}
${faq.length ? `<h2>${esc(tx(locale, "faq"))}</h2>${faq.map((f) => `<details class="faq"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("")}` : ""}
${cues.length ? `<h2>${esc(tx(locale, "transcript"))}</h2><ol class="transcript">${cues.map((c) => `<li><time>${esc(fmtTime(c.startMs))}</time><span>${esc(c.text.replace(/\n/g, " "))}</span></li>`).join("")}</ol>` : ""}
${row.tags.length ? `<p>${row.tags.map((t) => `<a class="tag" href="${esc(`${listPath(row.type)}?tag=${encodeURIComponent(t)}`)}">${esc(t)}</a>`).join("")}</p>` : ""}
<section class="kit" aria-label="${esc(tx(locale, "pressKit"))}"><h2>${esc(tx(locale, "share"))}</h2>
<p>${poster ? `<a href="${esc(poster)}" download>${esc(tx(locale, "poster"))}</a> · ` : ""}<a href="${esc(`${path}.md`)}">${esc(tx(locale, "mdVersion"))}</a> · <a href="${esc(`/embed/${TYPE_PATH[row.type]}/${row.slug}`)}">${esc(tx(locale, "embed"))}</a> · <a href="${esc(`/api/oembed?format=json&url=${encodeURIComponent(url)}`)}">${esc(tx(locale, "oembed"))}</a></p>
<p><strong>${esc(tx(locale, "embedCode"))}</strong></p><pre class="embed">${esc(embedCode)}</pre></section>
</article>
${related.length ? `<h2>${esc(tx(locale, "related"))}</h2>${cards(site, related, locale)}` : ""}`;

  const head = baseHead(site, locale, {
    title: titleOf(row, site.siteName),
    description: descriptionOf(row),
    canonical: url,
    ogType: row.type === "podcast" ? "music.song" : "video.other",
    ogImage: poster || site.ogImage,
    robots: row.noindex ? "noindex,follow" : robotsIndex,
    jsonLd: itemGraph(site, row, crumbs, cues),
    extra: [
      `<link rel="alternate" hreflang="${esc(locale)}" href="${esc(url)}">`,
      `<link rel="alternate" hreflang="x-default" href="${esc(url)}">`,
      `<link rel="alternate" type="text/markdown" href="${esc(`${url}.md`)}">`,
      `<link rel="alternate" type="application/json+oembed" href="${esc(`${site.origin}/api/oembed?format=json&url=${encodeURIComponent(url)}`)}" title="${esc(row.title)}">`,
      `<meta property="og:locale" content="${esc(locale)}">`,
      `<meta property="article:published_time" content="${esc(row.created_at)}">`,
      `<meta property="article:modified_time" content="${esc(row.updated_at)}">`,
      ...row.tags
        .slice(0, 6)
        .map((t) => `<meta property="article:tag" content="${esc(t)}">`),
    ].join("\n"),
  });
  return {
    status: 200,
    robots: head.robots,
    html: shell(head, chrome(site, locale), body, footer(site, locale)),
  };
}

/** Protected item: title only, never indexed, unlock form (the only thing the script does). */
export function renderStub(site: SiteConfig, row: ContentRow): Page {
  const locale = row.locale;
  const url = `${site.origin}${itemPath(row.type, row.slug)}`;
  const body = `<nav class="crumbs"><a href="/library">${esc(tx(locale, "library"))}</a> › <a href="${esc(listPath(row.type))}">${esc(typeLabel(locale, row.type))}</a></nav>
<h1>🔒 ${esc(row.title)}</h1>
<div class="lock"><h2>${esc(tx(locale, "locked"))}</h2><p>${esc(tx(locale, "lockedBody"))}</p>
<form id="unlock" data-id="${esc(row.id)}" data-wrong="${esc(tx(locale, "wrong"))}" data-locked="${esc(tx(locale, "tooMany"))}" data-fail="${esc(tx(locale, "fail"))}" autocomplete="off"><label>${esc(tx(locale, "password"))} <input type="password" name="password" required maxlength="200" autocomplete="current-password"></label> <button type="submit">${esc(tx(locale, "unlock"))}</button></form>
<p id="unlock-msg" class="err" role="alert"></p></div>
<article id="unlocked" hidden></article>`;
  const head = baseHead(site, locale, {
    title: `${row.title} | ${site.siteName}`,
    description: tx(locale, "lockedBody"),
    canonical: url,
    robots: "noindex,nofollow",
  });
  return {
    status: 200,
    robots: head.robots,
    html: shell(head, chrome(site, locale), body, footer(site, locale), {
      withScript: true,
    }),
  };
}

export function renderNotFound(site: SiteConfig, locale: Locale): Page {
  const head = baseHead(site, locale, {
    title: `${tx(locale, "notFound")} | ${site.siteName}`,
    description: tx(locale, "notFoundBody"),
    canonical: `${site.origin}/library`,
    robots: "noindex,follow",
  });
  const body = `<h1>${esc(tx(locale, "notFound"))}</h1><p>${esc(tx(locale, "notFoundBody"))}</p><p><a href="/library">${esc(tx(locale, "library"))}</a></p>`;
  return {
    status: 404,
    robots: head.robots,
    html: shell(head, chrome(site, locale), body, footer(site, locale)),
  };
}

export function renderEmbed(site: SiteConfig, row: ContentRow): Page {
  const media = mediaOf(row, site);
  const poster = posterOf(row, site, media);
  const url = `${site.origin}${itemPath(row.type, row.slug)}`;
  const head = baseHead(site, row.locale, {
    title: titleOf(row, site.siteName),
    description: descriptionOf(row),
    canonical: url,
    robots: "noindex,follow",
    ogImage: poster,
  });
  const body = `${playerHtml(row, media, poster)}<p class="meta"><a href="${esc(url)}" target="_blank" rel="noopener">${esc(row.title)} — ${esc(site.siteName)}</a></p>`;
  return {
    status: 200,
    robots: head.robots,
    html: shell(head, chrome(site, row.locale), body, "", { chrome: false }),
  };
}

/* ---------------------------------- docs --------------------------------- */

const KINDS = [
  "article",
  "book",
  "video",
  "podcast",
  "website",
  "other",
] as const;

function citationHtml(c: Citation): string {
  const title = c.italicTitle ? `<em>${esc(c.title)}</em>` : esc(c.title);
  return `${c.authors ? `${esc(c.authors)} ` : ""}(${esc(c.year)}). ${title}.${c.publisher ? ` ${esc(c.publisher)}.` : ""}${c.url ? ` <a href="${esc(c.url)}" rel="noopener nofollow">${esc(c.url)}</a>` : ""}`;
}

export function renderDocs(
  site: SiteConfig,
  locale: Locale,
  rows: readonly ContentRow[],
): Page {
  const byKind = new Map<string, ContentRow[]>();
  for (const r of rows) {
    const k =
      typeof r.meta["kind"] === "string" &&
      (KINDS as readonly string[]).includes(r.meta["kind"] as string)
        ? (r.meta["kind"] as string)
        : "other";
    byKind.set(k, [...(byKind.get(k) ?? []), r]);
  }
  const body = `<h1>${esc(tx(locale, "docsTitle"))}</h1><p class="meta">${esc(tx(locale, "docsDesc"))}· <a id="admin-link" href="/admin/tables/source" hidden>${esc(tx(locale, "manage"))}</a></p>
${rows.length === 0 ? `<p>${esc(tx(locale, "empty"))}</p>` : ""}
${KINDS.filter((k) => byKind.has(k))
  .map(
    (k) =>
      `<section class="src"><h3>${esc(tx(locale, `kind.${k}` as TextKey))}</h3><ol>${(
        byKind.get(k) ?? []
      )
        .sort((a, b) =>
          citationOf(a).authors.localeCompare(citationOf(b).authors, locale),
        )
        .map(
          (r) => `<li id="${esc(r.slug)}">${citationHtml(citationOf(r))}</li>`,
        )
        .join("")}</ol></section>`,
  )
  .join("")}`;
  const head = baseHead(site, locale, {
    title: `${tx(locale, "docsTitle")} | ${site.siteName}`,
    description: tx(locale, "docsDesc"),
    canonical: `${site.origin}/docs`,
    robots: rows.length === 0 ? "noindex,follow" : robotsIndex,
    jsonLd: {
      "@context": "https://schema.org",
      "@graph": [
        orgNode(site),
        websiteNode(site),
        breadcrumb(site, [{ name: tx(locale, "docsTitle"), path: "/docs" }]),
        {
          "@type": "ItemList",
          name: tx(locale, "docsTitle"),
          itemListElement: rows.map((r, i) => ({
            "@type": "ListItem",
            position: i + 1,
            item: {
              "@type": "CreativeWork",
              name: r.title,
              ...(absUrl(site, r.source_url) ? { url: r.source_url } : {}),
            },
          })),
        },
      ],
    },
  });
  return {
    status: 200,
    robots: head.robots,
    html: shell(head, chrome(site, locale), body, footer(site, locale), {
      adminScript: true,
    }),
  };
}
