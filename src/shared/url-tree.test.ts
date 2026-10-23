// src/shared/url-tree.test.ts
import { describe, expect, it } from "vitest";

import {
  TreeParseError,
  isSafePublicUrl,
  parseTree,
  parseTreeJson,
  parseTreeText,
  rowsToTree,
  treeSitemap,
  treeToCells,
  treeToJson,
  treeToText,
} from "./url-tree";

describe("isSafePublicUrl (SSRF guard)", () => {
  it("accepts public http(s) urls", () => {
    for (const u of [
      "https://example.org",
      "http://example.org/a?b=1",
      "https://sub.example.co.uk/x#y",
      "https://93.184.216.34/",
      "https://[2606:4700::1111]/",
    ])
      expect(isSafePublicUrl(u), u).toBe(true);
  });
  it("rejects credentials, odd schemes, localhost, private / link-local / loopback addresses", () => {
    for (const u of [
      "javascript:alert(1)",
      "ftp://example.org",
      "file:///etc/passwd",
      "https://user:pw@example.org",
      "https://u@example.org",
      "http://localhost",
      "http://app.localhost",
      "http://127.0.0.1",
      "http://0.0.0.0",
      "http://10.1.2.3",
      "http://172.16.0.1",
      "http://172.31.255.1",
      "http://192.168.1.1",
      "http://169.254.169.254/latest/meta-data",
      "http://100.64.0.1",
      "http://2130706433",
      "http://0x7f000001",
      "http://127.1",
      "http://[::1]/",
      "http://[fd00::1]/",
      "http://[fe80::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://intranet",
      "http://printer.local",
      "http://db.internal",
      "",
      "not a url",
    ])
      expect(isSafePublicUrl(u), u).toBe(false);
    expect(isSafePublicUrl("https://example.org/" + "a".repeat(2000))).toBe(
      false,
    );
  });
});

describe("text format", () => {
  const text = `# kaynaklar
- Teknodoz | https://teknodoz.example.org | private | marka, ürün
  - Blog | https://teknodoz.example.org/blog
    - Yazı 1 | https://teknodoz.example.org/blog/1 | draft | a, b
  - Hakkında | https://teknodoz.example.org/about
- Başka | https://example.org
`;

  it("builds the nesting, defaults and tags", () => {
    const t = parseTreeText(text);
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({
      title: "Teknodoz",
      visibility: "private",
      tags: ["marka", "ürün"],
    });
    expect(t[0]!.children.map((c) => c.title)).toEqual(["Blog", "Hakkında"]);
    expect(t[0]!.children[0]!.children[0]).toMatchObject({
      title: "Yazı 1",
      visibility: "draft",
      tags: ["a", "b"],
    });
    expect(t[1]!.children).toEqual([]);
  });

  it("reports the line of each problem", () => {
    const code = (s: string): [string, number] => {
      try {
        parseTreeText(s);
        return ["ok", 0];
      } catch (e) {
        return e instanceof TreeParseError ? [e.code, e.line] : ["?", 0];
      }
    };
    expect(code("- A | http://127.0.0.1")).toEqual(["bad-url", 1]);
    expect(code("- A | https://a.example | public")).toEqual([
      "tree-cannot-publish",
      1,
    ]);
    expect(code("- A | https://a.example\n   - B | https://b.example")).toEqual(
      ["bad-indent", 2],
    );
    expect(
      code("- A | https://a.example\n    - B | https://b.example"),
    ).toEqual(["bad-indent", 2]); // skips a level
    expect(code("| https://a.example")).toEqual(["bad-line", 1]);
    expect(code("\n\n")).toEqual(["empty", 0]);
    expect(
      code(
        Array.from(
          { length: 9 },
          (_, i) => `${"  ".repeat(i)}- N${i} | https://a.example/${i}`,
        ).join("\n"),
      )[0],
    ).toBe("too-deep");
  });

  it("limits the number of nodes", () => {
    const many = Array.from(
      { length: 5001 },
      (_, i) => `- N${i} | https://a.example/${i}`,
    ).join("\n");
    expect(() => parseTreeText(many)).toThrow(TreeParseError);
  });
});

describe("json format, rows and export", () => {
  const json = JSON.stringify([
    {
      title: "Kök",
      url: "https://example.org",
      visibility: "private",
      tags: ["x"],
      children: [{ title: "Çocuk", url: "https://example.org/c" }],
    },
  ]);

  it("parses nested JSON and rejects unsafe / public nodes", () => {
    const t = parseTreeJson(json);
    expect(t[0]!.children[0]).toMatchObject({ title: "Çocuk", tags: [] });
    expect(parseTree(json)).toEqual(t);
    expect(() =>
      parseTreeJson('[{"title":"x","url":"http://localhost"}]'),
    ).toThrow(TreeParseError);
    expect(() =>
      parseTreeJson(
        '[{"title":"x","url":"https://a.example","visibility":"public"}]',
      ),
    ).toThrow(TreeParseError);
    expect(() => parseTreeJson("{")).toThrow(TreeParseError);
  });

  it("becomes import cells: parents first, stable external ids, always a draft or private", () => {
    const cells = treeToCells(parseTreeJson(json));
    expect(cells).toEqual([
      {
        external_id: "tree:kok",
        title: "Kök",
        source_url: "https://example.org",
        kind: "website",
        visibility: "private",
        tags: "x",
        parent: "",
      },
      {
        external_id: "tree:kok/cocuk",
        title: "Çocuk",
        source_url: "https://example.org/c",
        kind: "website",
        visibility: "draft",
        tags: "",
        parent: "tree:kok",
      },
    ]);
    // same title under the same parent stays unique
    const dup = treeToCells(
      parseTreeText("- A | https://a.example\n- A | https://b.example"),
    );
    expect(new Set(dup.map((c) => c["external_id"])).size).toBe(2);
  });

  it("exports back to the same tree (text + JSON) and a sitemap of public nodes only", () => {
    const rows = [
      {
        title: "Kök",
        source_url: "https://example.org",
        visibility: "public",
        tags: [],
        external_id: "tree:kok",
        meta: {},
      },
      {
        title: "Çocuk",
        source_url: "https://example.org/c",
        visibility: "draft",
        tags: ["a"],
        external_id: "tree:kok/cocuk",
        meta: { parent: "tree:kok" },
      },
      {
        title: "Özel",
        source_url: "https://example.org/p",
        visibility: "private",
        tags: [],
        external_id: "tree:ozel",
        meta: {},
      },
    ];
    const tree = rowsToTree(rows);
    expect(tree).toHaveLength(2);
    expect(tree[0]!.children[0]!.title).toBe("Çocuk");
    expect(treeToText(tree)).toBe(
      "- Kök | https://example.org\n  - Çocuk | https://example.org/c | draft | a\n- Özel | https://example.org/p | private\n",
    );
    expect(JSON.parse(treeToJson(tree))[0].children[0].title).toBe("Çocuk");
    const sm = treeSitemap(rows);
    expect(sm).toContain("<loc>https://example.org</loc>");
    expect(sm).not.toContain("/c<");
    expect(sm).not.toContain("/p<");
    expect(parseTreeText(treeToText(tree))[0]!.children[0]!.title).toBe(
      "Çocuk",
    );
  });
});
