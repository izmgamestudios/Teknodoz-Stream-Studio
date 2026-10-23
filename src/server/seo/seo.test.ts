/* eslint-disable @typescript-eslint/no-explicit-any */
// src/server/seo/seo.test.ts
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { memoryStore } from "../catalog";
import type { Redirect } from "../content";
import { blankRow, type ContentRow } from "../content-model";
import { recordBackedContentStore } from "../content-store";
import { citationOf, citationText } from "./citation";
import { ADMIN_JS, CSP, UNLOCK_JS, ldJson, sha256b64 } from "./html";
import { durationIso, clip } from "./model";
import { createSeoApi } from "./router";
import { siteFromEnv, absUrl } from "./site";
import { DICTS, DICT_KEYS } from "./text";
import { DEFAULT_BRAND } from "../../studio/branding/brand";

const NOW = "2026-10-22T10:00:00.000Z";
const site = siteFromEnv(
  { ...DEFAULT_BRAND, name: "Teknodoz Studio" },
  {
    SITE_URL: "https://studio.example.org/",
    PUBLISHER_NAME: "Teknodoz · IZM Game Studios",
  },
);

const row = (patch: Partial<ContentRow>): ContentRow =>
  blankRow("video", "Röportaj", NOW, {
    slug: "roportaj",
    visibility: "public",
    locale: "tr",
    ...patch,
  });

function setup(
  rows: ContentRow[],
  vtt: Record<string, string> = {},
  redirects: Redirect[] = [],
) {
  const store = recordBackedContentStore(memoryStore<ContentRow>(rows));
  let t = Date.parse(NOW);
  let reads = 0;
  const counting = {
    ...store,
    list: async (q: any) => (reads++, store.list(q)),
    findBySlug: async (a: any, b: any) => (reads++, store.findBySlug(a, b)),
  };
  const api = createSeoApi({
    store: counting,
    redirects: memoryStore<Redirect>(redirects),
    site: () => site,
    readVtt: async (p) => vtt[p] ?? null,
    now: () => t,
  });
  const get = async (
    path: string,
    headers: Record<string, string> = {},
    method = "GET",
  ) => {
    const res = await api.handle(
      new Request(`https://studio.example.org${path}`, { method, headers }),
    );
    return {
      res: res!,
      text:
        res && res.status !== 304 && method !== "HEAD" ? await res.text() : "",
    };
  };
  return { get, advance: (ms: number) => (t += ms), reads: () => reads };
}

const ld = (html: string): any => {
  const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(
    html,
  );
  return m ? JSON.parse(m[1]!) : null;
};

describe("item page", () => {
  const video = row({
    title: "Çağrı Merkezi Röportajı",
    slug: "cagri-merkezi",
    summary: "Bir çağrı merkezinin bir günü.",
    body_blocks: [
      { type: "heading", level: 1, text: "Giriş" },
      { type: "paragraph", text: "Merhaba dünya" },
      { type: "list", ordered: false, items: ["bir", "iki"] },
    ],
    tags: ["röportaj", "çağrı"],
    meta: {
      media_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      duration_sec: 125,
      poster_url: "https://cdn.example.org/p.jpg",
      faq: [{ q: "Ne anlatıyor?", a: "Bir günü." }],
      transcript_url: "/media/0123456789abcdef/captions/tr.vtt",
    },
  });
  const vtt = {
    "/media/0123456789abcdef/captions/tr.vtt":
      "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nİlk cümle\n\n00:01:05.000 --> 00:01:07.000\nİkinci cümle\n",
  };

  it("renders a full SEO / AEO / GEO page for anonymous visitors", async () => {
    const s = setup([video], vtt);
    const { res, text } = await s.get("/library/videos/cagri-merkezi");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(text).toContain('<html lang="tr">');
    expect(text).toMatch(/<h1>Çağrı Merkezi Röportajı<\/h1>/);
    expect(text).toContain(
      '<link rel="canonical" href="https://studio.example.org/library/videos/cagri-merkezi">',
    );
    expect(text).toContain('hreflang="x-default"');
    expect(text).toContain(
      'rel="alternate" type="text/markdown" href="https://studio.example.org/library/videos/cagri-merkezi.md"',
    );
    expect(text).toContain("application/json+oembed");
    expect(text).toContain(
      '<meta name="description" content="Bir çağrı merkezinin bir günü.">',
    );
    expect(text).toContain(
      'property="og:image" content="https://cdn.example.org/p.jpg"',
    );
    expect(text).toContain("Bir çağrı merkezinin bir günü."); // answer-first box
    expect(text).toContain("<h2>Giriş</h2>");
    expect(text).toContain("<li>iki</li>");
    expect(text).toContain("<summary>Ne anlatıyor?</summary>");
    expect(text).toContain('<ol class="transcript"><li><time>0:01</time>');
    expect(text).toContain("1:05"); // time-linked transcript
    expect(text).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(res.headers.get("x-robots-tag")).toContain("index,follow");
    expect(res.headers.get("cache-control")).toContain("s-maxage=3600");
  });

  it("emits valid JSON-LD: Organization, WebSite, BreadcrumbList, VideoObject, FAQPage", async () => {
    const s = setup([video], vtt);
    const g = ld((await s.get("/library/videos/cagri-merkezi")).text)["@graph"];
    const types = g.map((n: any) => n["@type"]);
    expect(types).toEqual([
      "Organization",
      "WebSite",
      "BreadcrumbList",
      "VideoObject",
      "FAQPage",
    ]);
    const v = g[3];
    expect(v).toMatchObject({
      name: "Çağrı Merkezi Röportajı",
      inLanguage: "tr",
      duration: "PT2M5S",
      thumbnailUrl: "https://cdn.example.org/p.jpg",
      isAccessibleForFree: true,
    });
    expect(v.embedUrl).toContain("youtube-nocookie.com/embed/");
    expect(v.transcript).toBe("İlk cümle İkinci cümle");
    expect(v.publisher).toEqual({ "@id": "https://studio.example.org/#org" });
    expect(g[2].itemListElement.map((x: any) => x.name)).toEqual([
      "Kütüphane",
      "Videolar",
      "Çağrı Merkezi Röportajı",
    ]);
    expect(g[4].mainEntity[0]).toMatchObject({
      "@type": "Question",
      name: "Ne anlatıyor?",
    });
  });

  it("a podcast gets PodcastEpisode + AudioObject + series and an <audio> player", async () => {
    const pod = row({
      type: "podcast",
      slug: "bolum-1",
      title: "Bölüm 1",
      meta: {
        media_url: "/media/0123456789abcdef",
        duration_sec: 61,
        series: "Seri A",
        episode: 1,
      },
    });
    const s = setup([pod]);
    const { text } = await s.get("/library/podcasts/bolum-1");
    const node = ld(text)["@graph"].find(
      (n: any) => n["@type"] === "PodcastEpisode",
    );
    expect(node).toMatchObject({
      episodeNumber: 1,
      partOfSeries: { "@type": "PodcastSeries", name: "Seri A" },
    });
    expect(node.associatedMedia.contentUrl).toBe(
      "https://studio.example.org/media/0123456789abcdef",
    );
    expect(text).toContain("<audio controls");
  });

  it("escapes everything user-provided (XSS) in HTML, attributes and JSON-LD", async () => {
    const evil = row({
      title: '<script>alert(1)</script>"><img src=x onerror=alert(2)>',
      slug: "evil",
      summary: "</script><script>alert(3)</script>",
      tags: ['"><b>'],
      body_blocks: [
        { type: "paragraph", text: "<img src=x onerror=1>" },
        {
          type: "link",
          url: 'https://ok.example/?q="><script>',
          text: "<b>x</b>",
        },
      ],
      meta: {
        media_url: "javascript:alert(1)",
        poster_url: "javascript:alert(2)",
        faq: [{ q: "<i>q</i>", a: "<u>a</u>" }],
      },
    });
    const s = setup([evil]);
    const { text } = await s.get("/library/videos/evil");
    expect(text).not.toContain("<script>alert");
    expect(text).not.toMatch(/<img src=x/);
    expect(text).not.toContain("javascript:");
    expect(text).not.toContain("<b>x</b>");
    // JSON-LD cannot be closed early
    const raw =
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(
        text,
      )![1]!;
    expect(raw).not.toContain("</");
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(ldJson({ a: "</script>" })).toBe('{"a":"\\u003c/script>"}');
  });

  it("noindex rows render with a noindex header and leave the sitemap", async () => {
    const hidden = row({
      slug: "gizli-sayfa",
      title: "Gizli sayfa",
      noindex: true,
    });
    const s = setup([hidden, video]);
    const page = await s.get("/library/videos/gizli-sayfa");
    expect(page.res.headers.get("x-robots-tag")).toBe("noindex,follow");
    expect(page.text).toContain('name="robots" content="noindex,follow"');
    const sm = await s.get("/sitemap-videos-1.xml");
    expect(sm.text).toContain("cagri-merkezi");
    expect(sm.text).not.toContain("gizli-sayfa");
  });

  it("slug redirects answer 301, drafts and unknown slugs 404 with noindex", async () => {
    const s = setup(
      [
        row({ slug: "yeni", title: "Yeni" }),
        row({ slug: "taslak", visibility: "draft" }),
        row({ slug: "sil", is_deleted: true }),
      ],
      {},
      [{ id: "video:eski", type: "video", from: "eski", to: "yeni" }],
    );
    const moved = await s.get("/library/videos/eski");
    expect(moved.res.status).toBe(301);
    expect(moved.res.headers.get("location")).toBe("/library/videos/yeni");
    expect(
      (await s.get("/library/videos/eski.md")).res.headers.get("location"),
    ).toBe("/library/videos/yeni.md");
    for (const slug of ["taslak", "sil", "yok"]) {
      const r = await s.get(`/library/videos/${slug}`);
      expect(r.res.status).toBe(404);
      expect(r.res.headers.get("x-robots-tag")).toContain("noindex");
    }
  });
});

describe("protected items", () => {
  it("show a title-only noindex stub with the unlock form, never the body", async () => {
    const p = row({
      slug: "sifreli",
      title: "Şifreli Yapım",
      visibility: "protected",
      access_group: "g",
      body_blocks: [{ type: "paragraph", text: "ÇOK GİZLİ" }],
      summary: "GİZLİ ÖZET",
      meta: { media_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    });
    const s = setup([p]);
    const { res, text } = await s.get("/library/videos/sifreli");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag")).toBe("noindex,nofollow");
    expect(text).toContain('<form id="unlock"');
    expect(text).toContain(`data-id="${p.id}"`);
    expect(text).not.toMatch(/ÇOK GİZLİ|GİZLİ ÖZET|youtube/);
    expect(text).not.toContain("application/ld+json");
    expect((await s.get("/library/videos/sifreli.md")).res.status).toBe(404);
    expect((await s.get("/embed/videos/sifreli")).res.status).toBe(404);
    // listed as a stub card, absent from sitemap / llms
    const list = await s.get("/library/videos");
    expect(list.text).toContain("🔒 Şifreli Yapım");
    expect(list.text).not.toContain("ÇOK GİZLİ");
    expect((await s.get("/sitemap-videos-1.xml")).res.status).toBe(404);
    expect((await s.get("/llms.txt")).text).not.toContain("Şifreli");
  });
});

describe("lists, index and docs", () => {
  const rows = Array.from({ length: 30 }, (_, i) =>
    row({
      title: `Video ${i}`,
      slug: `video-${i}`,
      updated_at: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}T00:00:00Z`,
      summary: `Özet ${i}`,
    }),
  );

  it("pages the list (24 per page) with prev/next links and CollectionPage JSON-LD", async () => {
    const s = setup(rows);
    const p1 = await s.get("/library/videos");
    expect((p1.text.match(/class="card"/g) ?? []).length).toBe(24);
    expect(p1.text).toContain('rel="next" href="/library/videos?page=2"');
    expect(
      ld(p1.text)["@graph"].some((n: any) => n["@type"] === "CollectionPage"),
    ).toBe(true);
    const p2 = await s.get("/library/videos?page=2");
    expect((p2.text.match(/class="card"/g) ?? []).length).toBe(6);
    expect(p2.text).toContain('rel="prev"');
    expect(p2.text).toContain(
      '<link rel="canonical" href="https://studio.example.org/library/videos?page=2">',
    );
  });

  it("an empty list is noindex; the library index shows the three sections", async () => {
    const s = setup([]);
    expect(
      (await s.get("/library/podcasts")).res.headers.get("x-robots-tag"),
    ).toContain("noindex");
    const idx = await s.get("/library");
    expect(idx.res.status).toBe(200);
    for (const h of ["Hikayeler", "Videolar", "Podcastler"])
      expect(idx.text).toContain(h);
    expect((await s.get("/library?lang=en")).text).toContain(
      "Publishing library",
    );
  });

  it("tag filter pages are noindex", async () => {
    const s = setup([row({ slug: "a", tags: ["x"] })]);
    const r = await s.get("/library/videos?tag=x");
    expect(r.res.headers.get("x-robots-tag")).toBe("noindex,follow");
  });

  it("/docs lists public sources as APA 7 grouped by kind", async () => {
    const src = [
      row({
        type: "source",
        slug: "kitap",
        title: "Yayın Tekniği",
        source_url: "https://example.org/kitap",
        meta: {
          kind: "book",
          authors: ["Ayşe Yılmaz", "Can Demir"],
          publisher: "Örnek Yayınları",
          published_on: "2021-05-01",
        },
      }),
      row({
        type: "source",
        slug: "gizli-kaynak",
        title: "Taslak kaynak",
        visibility: "draft",
      }),
    ];
    const s = setup(src);
    const { res, text } = await s.get("/docs");
    expect(res.status).toBe(200);
    expect(text).toContain("<h3>Kitaplar</h3>");
    expect(text).toContain(
      "Yılmaz, A., &amp; Demir, C. (2021). <em>Yayın Tekniği</em>. Örnek Yayınları.",
    );
    expect(text).not.toContain("Taslak kaynak");
    expect(text).toContain(
      'id="admin-link" href="/admin/tables/source" hidden',
    );
    expect(citationText(citationOf(src[0]!))).toBe(
      "Yılmaz, A., & Demir, C. (2021). Yayın Tekniği. Örnek Yayınları. https://example.org/kitap",
    );
  });
});

describe("machine-readable surfaces", () => {
  const video = row({
    title: "Video",
    slug: "video",
    summary: "Özet",
    meta: {
      media_url: "https://cdn.example.org/a.mp4",
      poster_url: "https://cdn.example.org/p.jpg",
      duration_sec: 90,
    },
    body_blocks: [{ type: "paragraph", text: "Metin" }],
    tags: ["a"],
  });
  const pod = row({
    type: "podcast",
    title: "Bölüm",
    slug: "bolum",
    meta: {
      media_url: "https://cdn.example.org/a.mp3",
      duration_sec: 60,
      episode: 2,
      explicit: false,
    },
  });

  it("robots.txt points at the sitemap, blocks app areas, and can block AI crawlers", async () => {
    const s = setup([]);
    const t = (await s.get("/robots.txt")).text;
    expect(t).toContain("Disallow: /admin");
    expect(t).toContain("Disallow: /api/");
    expect(t).toContain("Sitemap: https://studio.example.org/sitemap.xml");
    expect(t).not.toContain("GPTBot");
    const blocked = createSeoApi({
      store: recordBackedContentStore(memoryStore<ContentRow>([])),
      redirects: memoryStore<Redirect>(),
      site: () => ({ ...site, aiCrawlers: "block" }),
      readVtt: async () => null,
    });
    const bt = await (await blocked.handle(
      new Request("https://studio.example.org/robots.txt"),
    ))!.text();
    expect(bt).toContain("User-agent: GPTBot\nDisallow: /");
    expect(bt).toContain("ClaudeBot");
  });

  it("sitemap index -> chunked url sets with video entries", async () => {
    const s = setup([video, pod]);
    const idx = (await s.get("/sitemap.xml")).text;
    expect(idx).toContain(
      "<loc>https://studio.example.org/sitemap-pages.xml</loc>",
    );
    expect(idx).toContain("sitemap-videos-1.xml");
    expect(idx).toContain("sitemap-podcasts-1.xml");
    expect(idx).not.toContain("sitemap-stories");
    const v = (await s.get("/sitemap-videos-1.xml")).text;
    expect(v).toContain(
      "<loc>https://studio.example.org/library/videos/video</loc>",
    );
    expect(v).toContain(
      "<video:thumbnail_loc>https://cdn.example.org/p.jpg</video:thumbnail_loc>",
    );
    expect(v).toContain("<video:duration>90</video:duration>");
    expect(v).toContain(
      "<video:content_loc>https://cdn.example.org/a.mp4</video:content_loc>",
    );
    expect((await s.get("/sitemap-podcasts-1.xml")).text).not.toContain(
      "video:video",
    );
    expect((await s.get("/sitemap-videos-9.xml")).res.status).toBe(404);
  });

  it("llms.txt, llms-full.txt and the Markdown twin carry the content for LLMs", async () => {
    const s = setup([video]);
    const llms = (await s.get("/llms.txt")).text;
    expect(llms).toContain("# Teknodoz Studio");
    expect(llms).toContain(
      "[Video](https://studio.example.org/library/videos/video.md): Özet",
    );
    const md = await s.get("/library/videos/video.md");
    expect(md.res.headers.get("content-type")).toContain("text/markdown");
    expect(md.text).toContain("# Video");
    expect(md.text).toContain(
      "- URL: https://studio.example.org/library/videos/video",
    );
    expect(md.text).toContain("## Summary\n\nÖzet");
    expect(md.text).toContain("Metin");
    expect((await s.get("/llms-full.txt")).text).toContain("# Video");
  });

  it("podcast RSS has enclosure, duration, episode and explicit tags", async () => {
    const s = setup([pod]);
    const { res, text } = await s.get("/library/podcasts/feed.xml");
    expect(res.headers.get("content-type")).toContain("application/rss+xml");
    expect(text).toContain(
      '<enclosure url="https://cdn.example.org/a.mp3" length="0" type="audio/mpeg"/>',
    );
    expect(text).toContain("<itunes:duration>60</itunes:duration>");
    expect(text).toContain("<itunes:episode>2</itunes:episode>");
    expect(text).toContain("<itunes:explicit>false</itunes:explicit>");
    expect((await s.get("/library/videos/feed.xml")).res.status).toBe(404);
  });

  it("oEmbed returns an iframe for public items of this site only", async () => {
    const s = setup([video]);
    const ok = await s.get(
      `/api/oembed?format=json&url=${encodeURIComponent("https://studio.example.org/library/videos/video")}&maxwidth=800`,
    );
    const j = JSON.parse(ok.text);
    expect(j).toMatchObject({
      version: "1.0",
      type: "video",
      provider_name: "Teknodoz Studio",
      width: 800,
      height: 450,
      thumbnail_url: "https://cdn.example.org/p.jpg",
    });
    expect(j.html).toContain(
      'src="https://studio.example.org/embed/videos/video"',
    );
    expect(
      (
        await s.get(
          `/api/oembed?url=${encodeURIComponent("https://evil.example/library/videos/video")}`,
        )
      ).res.status,
    ).toBe(404);
    expect((await s.get("/api/oembed?url=not-a-url")).res.status).toBe(400);
  });

  it("embed page is minimal, noindex and allows framing by the configured origins", async () => {
    const s = setup([video]);
    const r = await s.get("/embed/videos/video");
    expect(r.res.status).toBe(200);
    expect(r.res.headers.get("x-robots-tag")).toBe("noindex,follow");
    expect(r.res.headers.get("content-security-policy")).toContain(
      "frame-ancestors *",
    );
    expect(r.text).not.toContain("<header");
    expect(r.text).toContain("<video controls");
  });
});

describe("delivery: cache, etag, csp, hashes", () => {
  it("serves ETag / 304, HEAD without body, 405 for writes, and caches reads in-process", async () => {
    const s = setup([row({ slug: "x", title: "X" })]);
    const a = await s.get("/library/videos/x");
    const tag = a.res.headers.get("etag")!;
    expect(tag).toMatch(/^W\//);
    const reads = s.reads();
    const b = await s.get("/library/videos/x", { "if-none-match": tag });
    expect(b.res.status).toBe(304);
    expect(s.reads()).toBe(reads); // second hit came from the in-process cache
    expect((await s.get("/library/videos/x", {}, "HEAD")).res.status).toBe(200);
    expect((await s.get("/library/videos/x", {}, "POST")).res.status).toBe(405);
    s.advance(61_000);
    await s.get("/library/videos/x");
    expect(s.reads()).toBeGreaterThan(reads); // expired -> read again
  });

  it("pins the inline style and scripts by hash in the CSP; other paths are not handled", async () => {
    const s = setup([row({ slug: "x" })]);
    const csp = (await s.get("/library/videos/x")).res.headers.get(
      "content-security-policy",
    )!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain(`'sha256-${sha256b64(UNLOCK_JS)}'`);
    expect(csp).toContain(`'sha256-${sha256b64(ADMIN_JS)}'`);
    expect(csp).toContain("frame-ancestors 'self'");
    expect(CSP("*")).toContain("frame-ancestors *");
    const html = (await s.get("/library/videos/x")).text;
    const css = /<style>([\s\S]*?)<\/style>/.exec(html)![1]!;
    expect(csp).toContain(
      `'sha256-${createHash("sha256").update(css).digest("base64")}'`,
    );
    const api = createSeoApi({
      store: recordBackedContentStore(memoryStore<ContentRow>([])),
      redirects: memoryStore<Redirect>(),
      site: () => site,
      readVtt: async () => null,
    });
    expect(
      await api.handle(new Request("https://studio.example.org/watch")),
    ).toBeNull();
    expect(
      await api.handle(new Request("https://studio.example.org/api/content")),
    ).toBeNull();
  });
});

describe("helpers", () => {
  it("duration, clip, absolute urls, site config", () => {
    expect(durationIso(0)).toBe("PT0S");
    expect(durationIso(3725)).toBe("PT1H2M5S");
    expect(durationIso(3600)).toBe("PT1H");
    expect(clip("a ".repeat(200), 20).length).toBeLessThanOrEqual(20);
    expect(absUrl(site, "/media/x")).toBe("https://studio.example.org/media/x");
    expect(absUrl(site, "https://a.example/p.png")).toBe(
      "https://a.example/p.png",
    );
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,x",
      "//evil.example/x",
      "ftp://x",
      "",
    ])
      expect(absUrl(site, bad)).toBe("");
    expect(site.origin).toBe("https://studio.example.org");
    expect(site.publisherName).toBe("Teknodoz · IZM Game Studios");
  });

  it("all four languages define every chrome string", () => {
    for (const l of ["tr", "en", "de", "es"] as const)
      for (const k of DICT_KEYS) expect(DICTS[l][k], `${l}.${k}`).toBeTruthy();
  });
});
