/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";

import { DEFAULT_BRAND } from "../../studio/branding/brand";
import { memoryStore } from "../catalog";
import type { Redirect } from "../content";
import { blankRow, type ContentRow } from "../content-model";
import { recordBackedContentStore } from "../content-store";
import { withSecurityHeaders } from "../security-headers";
import { createSeoApi } from "./router";
import { siteFromEnv } from "./site";
import { validatePage } from "./validate";

const NOW = "2026-10-22T10:00:00.000Z";
const ORIGIN = "https://studio.example.org";
const site = siteFromEnv(
  { ...DEFAULT_BRAND, name: "Teknodoz Studio" },
  { SITE_URL: ORIGIN, PUBLISHER_NAME: "Teknodoz" },
);
const row = (type: any, title: string, patch: Partial<ContentRow>) =>
  blankRow(type, title, NOW, { visibility: "public", locale: "tr", ...patch });

const rows: ContentRow[] = [
  row("video", "Çağrı Merkezi Röportajı", {
    slug: "cagri-merkezi",
    summary: "Bir çağrı merkezinin bir günü.",
    body_blocks: [{ type: "paragraph", text: "Merhaba" }],
    meta: {
      media_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      duration_sec: 125,
      poster_url: "https://cdn.example.org/p.jpg",
      faq: [{ q: "Ne anlatıyor?", a: "Bir günü." }],
    },
  }),
  row("podcast", "Bölüm 1", {
    slug: "bolum-1",
    summary: "İlk bölüm.",
    meta: {
      media_url: "https://cdn.example.org/a.mp3",
      duration_sec: 61,
      series: "Seri A",
      episode: 1,
    },
  }),
  row("story", "Haber", {
    slug: "haber",
    summary: "Kısa haber.",
    body_blocks: [{ type: "paragraph", text: "Metin" }],
  }),
];

async function page(path: string) {
  const store = recordBackedContentStore(memoryStore<ContentRow>(rows));
  const api = createSeoApi({
    store,
    redirects: memoryStore<Redirect>([]),
    site: () => site,
    readVtt: async () => null,
    now: () => Date.parse(NOW),
  });
  const req = new Request(`${ORIGIN}${path}`);
  const res = withSecurityHeaders(req, (await api.handle(req))!);
  return { res, html: await res.text() };
}

describe("public page validator", () => {
  for (const path of [
    "/library/videos/cagri-merkezi",
    "/library/podcasts/bolum-1",
    "/library/stories/haber",
    "/library/videos",
  ])
    it(`${path} has no errors`, async () => {
      const { res, html } = await page(path);
      const errors = validatePage(html, res.headers, { origin: ORIGIN }).filter(
        (i) => i.level === "error",
      );
      expect(errors).toEqual([]);
    });

  it("an empty /docs page stays out of the index (thin content)", async () => {
    const { res, html } = await page("/docs");
    expect(
      validatePage(html, res.headers, { origin: ORIGIN, indexable: false }),
    ).toEqual([]);
  });

  it("the pages sitemap lists only lists that have content", async () => {
    const { html: xml } = await page("/sitemap-pages.xml");
    expect(xml).toContain(`${ORIGIN}/library/videos<`);
    expect(xml).toContain(`${ORIGIN}/library/stories<`);
    expect(xml).not.toContain("/docs<"); // no public sources in this fixture
  });

  it("a media-less item is an Article, not an invalid VideoObject", async () => {
    const { html } = await page("/library/stories/haber");
    expect(html).toContain('"@type":"Article"');
    expect(html).not.toContain('"@type":"VideoObject"');
  });

  it("flags skipped heading levels", () => {
    const html = `<!doctype html><html lang="tr"><body><h1>a</h1><h3>b</h3></body></html>`;
    expect(validatePage(html, {}).map((i) => i.code)).toContain(
      "heading-order",
    );
  });

  it("flags the classic mistakes", () => {
    const bad = `<html><head><title></title><script type="application/ld+json">{"@context":"https://schema.org","@type":"VideoObject","name":"x"}</script></head><body><h1>a</h1><h1>b</h1><img src="x.png"></body></html>`;
    const codes = validatePage(bad, {}, { origin: ORIGIN }).map((i) => i.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "doctype",
        "lang",
        "viewport",
        "title",
        "description",
        "h1",
        "canonical",
        "img-alt",
        "jsonld-required",
        "nosniff",
        "csp",
      ]),
    );
  });

  it("flags a FAQ whose text is not visible and unparsable JSON-LD", () => {
    const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="x"><title>t</title><meta name="description" content="d"><link rel="canonical" href="${ORIGIN}/a"><script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"name":"Gizli soru"}]}</script><script type="application/ld+json">{oops</script></head><body><h1>x</h1></body></html>`;
    const codes = validatePage(html, {
      "x-content-type-options": "nosniff",
      "content-security-policy": "x",
      "content-type": "text/html",
    }).map((i) => i.code);
    expect(codes).toContain("faq-hidden");
    expect(codes).toContain("jsonld-parse");
  });

  it("non-public pages must be noindex", () => {
    const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="x"><title>t</title></head><body><h1>x</h1></body></html>`;
    const codes = validatePage(
      html,
      {
        "x-content-type-options": "nosniff",
        "content-security-policy": "x",
        "content-type": "text/html",
      },
      { indexable: false },
    ).map((i) => i.code);
    expect(codes).toContain("should-noindex");
  });
});
