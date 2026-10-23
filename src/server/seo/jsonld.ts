// src/server/seo/jsonld.ts
// schema.org graphs for the public pages (JSON-LD). Only facts that are visible on the page.
import type { Cue } from "../../studio/watch/cues";
import type { ContentRow } from "../content-model";
import {
  descriptionOf,
  durationIso,
  durationOf,
  faqOf,
  itemPath,
  listPath,
  mediaOf,
  posterOf,
} from "./model";
import type { SiteConfig } from "./site";

type Json = Record<string, unknown>;
const drop = (o: Json): Json =>
  Object.fromEntries(
    Object.entries(o).filter(
      ([, v]) => v !== "" && v !== undefined && v !== null,
    ),
  );

export const orgNode = (site: SiteConfig): Json =>
  drop({
    "@type": "Organization",
    "@id": `${site.origin}/#org`,
    name: site.publisherName,
    url: site.publisherUrl,
    logo: { "@type": "ImageObject", url: site.logoUrl },
  });

export const websiteNode = (site: SiteConfig): Json => ({
  "@type": "WebSite",
  "@id": `${site.origin}/#site`,
  url: site.origin,
  name: site.siteName,
  publisher: { "@id": `${site.origin}/#org` },
});

export function breadcrumb(
  site: SiteConfig,
  crumbs: { name: string; path: string }[],
): Json {
  return {
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: `${site.origin}${c.path}`,
    })),
  };
}

export function itemGraph(
  site: SiteConfig,
  row: ContentRow,
  crumbs: { name: string; path: string }[],
  cues: readonly Cue[],
): Json {
  const url = `${site.origin}${itemPath(row.type, row.slug)}`;
  const media = mediaOf(row, site);
  const duration = durationOf(row);
  const poster = posterOf(row, site, media);
  const common = drop({
    "@id": `${url}#media`,
    name: row.title,
    description: descriptionOf(row),
    url,
    inLanguage: row.locale,
    datePublished: row.created_at,
    dateModified: row.updated_at,
    keywords: row.tags.join(", "),
    thumbnailUrl: poster,
    image: poster,
    publisher: { "@id": `${site.origin}/#org` },
    isAccessibleForFree: true,
    duration: duration ? durationIso(duration) : "",
    transcript: cues.length
      ? cues
          .map((c) => c.text)
          .join(" ")
          .slice(0, 20_000)
      : "",
  });

  let node: Json;
  if (row.type === "podcast") {
    const series =
      typeof row.meta["series"] === "string" ? row.meta["series"] : "";
    node = drop({
      ...common,
      "@type": "PodcastEpisode",
      episodeNumber:
        typeof row.meta["episode"] === "number" ? row.meta["episode"] : "",
      timeRequired: duration ? durationIso(duration) : "",
      associatedMedia: media.src
        ? drop({
            "@type": "AudioObject",
            contentUrl: media.src,
            encodingFormat: media.mime,
            duration: duration ? durationIso(duration) : "",
          })
        : "",
      partOfSeries: series
        ? {
            "@type": "PodcastSeries",
            name: series,
            url: `${site.origin}${listPath("podcast")}`,
          }
        : "",
    });
  } else if (!media.src && !media.embed) {
    // no playable media: a VideoObject without contentUrl/embedUrl is invalid structured data
    const { name, ...rest } = common;
    node = drop({
      ...rest,
      "@type": "Article",
      headline: name,
      author: { "@id": `${site.origin}/#org` },
      mainEntityOfPage: url,
    });
  } else {
    node = drop({
      ...common,
      "@type": "VideoObject",
      uploadDate: row.created_at,
      contentUrl: media.src,
      embedUrl: media.embed || "",
    });
  }

  const graph: Json[] = [
    orgNode(site),
    websiteNode(site),
    breadcrumb(site, crumbs),
    node,
  ];
  const faq = faqOf(row);
  if (faq.length)
    graph.push({
      "@type": "FAQPage",
      mainEntity: faq.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    });
  return { "@context": "https://schema.org", "@graph": graph };
}

export function listGraph(
  site: SiteConfig,
  name: string,
  path: string,
  crumbs: { name: string; path: string }[],
  items: readonly ContentRow[],
): Json {
  return {
    "@context": "https://schema.org",
    "@graph": [
      orgNode(site),
      websiteNode(site),
      breadcrumb(site, crumbs),
      {
        "@type": "CollectionPage",
        name,
        url: `${site.origin}${path}`,
        isPartOf: { "@id": `${site.origin}/#site` },
        mainEntity: {
          "@type": "ItemList",
          itemListElement: items.map((r, i) => ({
            "@type": "ListItem",
            position: i + 1,
            url: `${site.origin}${itemPath(r.type, r.slug)}`,
            name: r.title,
          })),
        },
      },
    ],
  };
}
