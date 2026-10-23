/* eslint-disable @typescript-eslint/no-explicit-any */
// src/server/content-import.test.ts
import { describe, expect, it } from "vitest";

import { memoryStore } from "./catalog";
import { memoryAudit, type Redirect } from "./content";
import { createImportApi, IMPORTS_PER_HOUR } from "./content-import";
import { blankRow, type ContentRow } from "./content-model";
import { PocketBase } from "./pocketbase";
import { pbContentStore, recordBackedContentStore } from "./content-store";

const TOKEN = "a-very-long-admin-token-123";
const NOW = "2026-10-22T10:00:00.000Z";

function setup(seed: ContentRow[] = []) {
  const rows = memoryStore<ContentRow>(seed);
  const store = recordBackedContentStore(rows);
  const redirects = memoryStore<Redirect>();
  const audit = memoryAudit();
  const api = createImportApi({
    token: TOKEN,
    store,
    redirects,
    audit,
    now: () => new Date(NOW),
  });
  let seq = 0;
  const post = async (body: Record<string, unknown>, auth = true) => {
    const res = await api.handle(
      new Request("http://x/api/import/content", {
        method: "POST",
        headers: {
          ...(auth ? { authorization: `Bearer ${TOKEN}` } : {}),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          type: "video",
          importId: `import-${Math.floor(seq / 100)}-abcdef`,
          onMatch: "draft",
          ...body,
        }),
      }),
    );
    seq++;
    return { status: res!.status, json: (await res!.json()) as any };
  };
  return { post, rows, store, audit, redirects };
}

const row = (
  n: number,
  input: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) => ({ n, input, ...extra });
const live = (patch: Partial<ContentRow>): ContentRow =>
  blankRow("video", "Canlı Video", NOW, {
    slug: "canli-video",
    external_id: "ext-1",
    visibility: "public",
    ...patch,
  });

describe("import: dry run", () => {
  it("needs admin and validates the body", async () => {
    const s = setup();
    expect(
      (await s.post({ mode: "dry", rows: [row(1, { title: "x" })] }, false))
        .status,
    ).toBe(401);
    expect((await s.post({ mode: "dry", rows: [] })).status).toBe(400);
    expect(
      (
        await s.post({
          mode: "dry",
          type: "nope",
          rows: [row(1, { title: "x" })],
        })
      ).status,
    ).toBe(400);
  });

  it("plans creates as drafts, writes nothing, and reports row errors", async () => {
    const s = setup();
    const r = await s.post({
      mode: "dry",
      rows: [
        row(2, { title: "Yeni Video", tags: ["a"] }),
        row(3, { title: "Özel", visibility: "private" }),
        row(4, { title: "Yayınla", visibility: "public" }),
        row(5, { title: "x", media_url: "javascript:1" }),
        row(6, { title: "x" }, { clientIssues: ["duration_sec:bad-number"] }),
        row(7, { title: "Secret", stream_key: "k" }),
        row(8, { title: "Yeni Video" }),
      ],
    });
    const by = Object.fromEntries(r.json.rows.map((x: any) => [x.n, x]));
    expect(by[2]).toMatchObject({ action: "create", slug: "yeni-video" });
    expect(by[3].action).toBe("create");
    expect(by[4]).toMatchObject({
      action: "error",
      issues: ["import-cannot-publish"],
    });
    expect(by[5].action).toBe("error");
    expect(by[6]).toMatchObject({
      action: "error",
      issues: ["duration_sec:bad-number"],
    });
    expect(by[7].action).toBe("error"); // secret field rejected by the registry schema
    expect(by[8]).toMatchObject({ action: "create", slug: "yeni-video-2" }); // generated slugs stay unique in a file
    expect(r.json.summary).toMatchObject({ create: 3, error: 4 });
    expect(await s.rows.list()).toHaveLength(0);
  });

  it("detects duplicates inside the file and id problems", async () => {
    const s = setup([live({ id: "aaaaaaaaaaaaaaa" })]);
    const r = await s.post({
      mode: "dry",
      rows: [
        row(1, { title: "A", external_id: "dup" }),
        row(2, { title: "B", external_id: "dup" }),
        row(3, { title: "C" }, { id: "zzzzzzzzzzzzzzz" }),
      ],
    });
    expect(r.json.rows.map((x: any) => x.issues[0] ?? x.action)).toEqual([
      "create",
      "duplicate-in-file",
      "id-not-found",
    ]);
  });
});

describe("import: matching", () => {
  it("matches id -> external_id -> slug and updates instead of duplicating", async () => {
    const a = live({
      id: "aaaaaaaaaaaaaaa",
      visibility: "draft",
      slug: "bir",
      external_id: "e1",
      title: "Bir",
    });
    const b = live({
      id: "bbbbbbbbbbbbbbb",
      visibility: "draft",
      slug: "iki",
      external_id: "e2",
      title: "İki",
    });
    const s = setup([a, b]);
    const r = await s.post({
      mode: "dry",
      rows: [
        row(1, { title: "Bir (yeni)" }, { id: "aaaaaaaaaaaaaaa" }),
        row(2, { title: "İki (yeni)", external_id: "e2" }),
        row(3, { title: "Üç", slug: "bir", summary: "özet" }),
        row(4, { title: "Çakışma", external_id: "e1", slug: "iki" }),
        row(5, { title: "Bir" }, { id: "aaaaaaaaaaaaaaa" }),
      ],
    });
    expect(r.json.rows.map((x: any) => [x.n, x.action, x.id])).toEqual([
      [1, "update", a.id],
      [2, "update", b.id],
      [3, "update", a.id],
      [4, "conflict", ""],
      [5, "error", a.id],
    ]);
  });

  it("an unchanged row is skipped", async () => {
    const a = live({
      id: "aaaaaaaaaaaaaaa",
      visibility: "draft",
      title: "Bir",
      slug: "bir",
      external_id: "",
    });
    const s = setup([a]);
    const r = await s.post({
      mode: "dry",
      rows: [row(1, { title: "Bir", slug: "bir" }, { id: a.id })],
    });
    expect(r.json.rows[0].action).toBe("skip");
  });
});

describe("import: onMatch policy and unpublish confirmation", () => {
  const publicRow = live({ id: "aaaaaaaaaaaaaaa" });

  it("draft policy marks live items as unpublish and blocks commit until confirmed", async () => {
    const s = setup([publicRow]);
    const rows = [
      row(1, { title: "Canlı Video (düzenlendi)", external_id: "ext-1" }),
    ];
    const dry = await s.post({ mode: "dry", rows });
    expect(dry.json.rows[0].action).toBe("unpublish");
    const blocked = await s.post({
      mode: "commit",
      rows,
      planHash: dry.json.planHash,
    });
    expect(blocked).toMatchObject({
      status: 409,
      json: { error: "unpublish-not-confirmed" },
    });
    expect((await s.store.get(publicRow.id))?.visibility).toBe("public");
    const ok = await s.post({
      mode: "commit",
      rows,
      planHash: dry.json.planHash,
      confirmUnpublish: true,
    });
    expect(ok.status).toBe(200);
    const after = await s.store.get(publicRow.id);
    expect(after).toMatchObject({
      visibility: "draft",
      title: "Canlı Video (düzenlendi)",
    });
    expect(s.audit.entries.at(-1)).toMatchObject({
      action: "import",
      source: "import",
    });
    expect((s.audit.entries.at(-1)!.before as any).unpublished).toEqual([
      publicRow.id,
    ]);
  });

  it("the row may ask for private; keep leaves visibility alone", async () => {
    const s = setup([publicRow]);
    const priv = await s.post({
      mode: "dry",
      rows: [
        row(1, { title: "T", external_id: "ext-1", visibility: "private" }),
      ],
    });
    const r1 = await s.post({
      mode: "commit",
      rows: [
        row(1, { title: "T", external_id: "ext-1", visibility: "private" }),
      ],
      planHash: priv.json.planHash,
      confirmUnpublish: true,
    });
    expect(r1.status).toBe(200);
    expect((await s.store.get(publicRow.id))?.visibility).toBe("private");

    const s2 = setup([publicRow]);
    const rows = [row(1, { title: "Sadece başlık", external_id: "ext-1" })];
    const dry = await s2.post({ mode: "dry", onMatch: "keep", rows });
    expect(dry.json.rows[0].action).toBe("update");
    expect(
      (
        await s2.post({
          mode: "commit",
          onMatch: "keep",
          rows,
          planHash: dry.json.planHash,
        })
      ).status,
    ).toBe(200);
    expect((await s2.store.get(publicRow.id))?.visibility).toBe("public");
  });

  it("commit needs the dry run's hash; a changed store invalidates it", async () => {
    const s = setup();
    const rows = [row(1, { title: "Yeni" })];
    expect((await s.post({ mode: "commit", rows })).status).toBe(409);
    const dry = await s.post({ mode: "dry", rows });
    // someone creates the same slug in between
    await s.rows.upsert(
      live({ id: "ccccccccccccccc", slug: "yeni", external_id: "" }),
    );
    const stale = await s.post({
      mode: "commit",
      rows,
      planHash: dry.json.planHash,
    });
    expect(stale).toMatchObject({
      status: 409,
      json: { error: "plan-changed" },
    });
  });

  it("commit counts equal the dry run counts, and re-import updates instead of duplicating", async () => {
    const s = setup();
    const rows = [
      row(1, { title: "A", external_id: "x1" }),
      row(2, { title: "B", external_id: "x2" }),
      row(3, { title: "Hata", media_url: "ftp://x" }),
    ];
    const dry = await s.post({ mode: "dry", rows });
    const commit = await s.post({
      mode: "commit",
      rows,
      planHash: dry.json.planHash,
    });
    expect(commit.json.summary).toEqual(dry.json.summary);
    expect(await s.rows.list()).toHaveLength(2);
    expect((await s.rows.list()).every((r) => r.visibility === "draft")).toBe(
      true,
    );
    const again = await s.post({ mode: "dry", rows: rows.slice(0, 2) });
    expect(again.json.summary).toMatchObject({ create: 0, skip: 2 });
    const edit = [row(1, { title: "A2", external_id: "x1" })];
    const d2 = await s.post({ mode: "dry", rows: edit });
    expect(d2.json.rows[0].action).toBe("update");
    await s.post({ mode: "commit", rows: edit, planHash: d2.json.planHash });
    expect(await s.rows.list()).toHaveLength(2);
  });

  it("rate limits new imports (chunks of one import are free)", async () => {
    const s = setup();
    const call = (importId: string) =>
      s
        .post({ mode: "dry", importId, rows: [row(1, { title: "x" })] })
        .then((r) => r.status);
    for (let i = 0; i < IMPORTS_PER_HOUR; i++)
      expect(await call(`import-limit-${i}-aaaa`)).toBe(200);
    expect(await call("import-limit-extra-aaaa")).toBe(429);
    expect(await call("import-limit-0-aaaa")).toBe(200); // another chunk of an existing import
  });
});

describe("PocketBase putMany (batch)", () => {
  function fake(batchOn: boolean) {
    const calls: string[] = [];
    let enabled = batchOn;
    let created = false;
    const fetchImpl = async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url.pathname}`);
      const reply = (s: number, b?: unknown) =>
        new Response(b === undefined ? null : JSON.stringify(b), { status: s });
      if (url.pathname.endsWith("auth-with-password"))
        return reply(200, { token: "tok" });
      if (url.pathname === "/api/collections" && method === "POST") {
        created = true;
        return reply(200, {});
      }
      if (url.pathname === "/api/collections/content_items")
        return reply(created ? 200 : 404, {});
      if (url.pathname === "/api/settings" && method === "PATCH") {
        enabled = true;
        return reply(200, {});
      }
      if (url.pathname === "/api/batch")
        return enabled
          ? reply(200, [])
          : reply(403, { message: "batch disabled" });
      return reply(200, {});
    };
    return { fetchImpl, calls };
  }
  const items = [
    {
      row: blankRow("video", "A", NOW, { id: "aaaaaaaaaaaaaaa" }),
      isNew: true,
    },
    {
      row: blankRow("video", "B", NOW, { id: "bbbbbbbbbbbbbbb" }),
      isNew: false,
    },
  ];

  it("sends one atomic batch (POST for new, PATCH for existing)", async () => {
    const f = fake(true);
    await pbContentStore(
      new PocketBase(
        { url: "http://pb", email: "a", password: "b" },
        f.fetchImpl,
      ),
    ).putMany(items);
    expect(f.calls.filter((c) => c === "POST /api/batch")).toHaveLength(1);
    expect(f.calls).not.toContain("PATCH /api/settings");
  });

  it("switches the batch API on when it is disabled, then retries", async () => {
    const f = fake(false);
    await pbContentStore(
      new PocketBase(
        { url: "http://pb", email: "a", password: "b" },
        f.fetchImpl,
      ),
    ).putMany(items);
    expect(f.calls).toContain("PATCH /api/settings");
    expect(
      f.calls.filter((c) => c === "POST /api/batch").length,
    ).toBeGreaterThanOrEqual(2);
    expect(f.calls.at(-1)).toBe("POST /api/batch");
  });
});
