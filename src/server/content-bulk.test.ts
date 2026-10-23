/* eslint-disable @typescript-eslint/no-explicit-any */
// src/server/content-bulk.test.ts
import { describe, expect, it } from "vitest";

import { memoryStore } from "./catalog";
import { memoryAudit, type Redirect } from "./content";
import { createContentApi } from "./content";
import { createBulkApi, settableFields } from "./content-bulk";
import {
  LOCK_MINUTES,
  MAX_FAILED_ATTEMPTS,
  type AccessGroup,
} from "./content-groups";
import { blankRow, type ContentRow } from "./content-model";
import { recordBackedContentStore, type ContentStore } from "./content-store";

const TOKEN = "a-very-long-admin-token-123";
let clock = Date.parse("2026-10-22T10:00:00.000Z");
const now = () => new Date(clock);

function setup(n = 3, type: "video" | "story" = "video") {
  const rows = Array.from({ length: n }, (_, i) =>
    blankRow(type, `Kayıt ${i}`, "2026-10-22T09:00:00Z", {
      id: `row${String(i).padStart(12, "0")}`,
      slug: `kayit-${i}`,
      body_blocks: [{ type: "paragraph", text: `Gizli gövde ${i}` }],
    }),
  );
  const base = recordBackedContentStore(memoryStore<ContentRow>(rows));
  let putManyCalls = 0;
  const store: ContentStore = {
    ...base,
    putMany: async (r) => (putManyCalls++, base.putMany(r)),
  };
  const groups = memoryStore<AccessGroup>();
  const audit = memoryAudit();
  const api = createBulkApi({ token: TOKEN, store, groups, audit, now });
  const content = createContentApi({
    token: TOKEN,
    store,
    redirects: memoryStore<Redirect>(),
    audit,
    now,
  });
  const post = async (
    path: string,
    body: unknown,
    admin = true,
    headers: Record<string, string> = {},
  ) => {
    const res = await api.handle(
      new Request(`http://x${path}`, {
        method: "POST",
        headers: {
          ...(admin ? { authorization: `Bearer ${TOKEN}` } : {}),
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify(body),
      }),
    );
    return {
      status: res!.status,
      json: (await res!.json()) as any,
      headers: res!.headers,
    };
  };
  const bulk = (
    action: string,
    ids: string[],
    params: Record<string, unknown> = {},
    admin = true,
  ) => post("/api/content/bulk", { action, type: type, ids, params }, admin);
  return {
    rows,
    store,
    groups,
    audit,
    api,
    content,
    post,
    bulk,
    calls: () => putManyCalls,
    ids: rows.map((r) => r.id),
  };
}

describe("bulk actions", () => {
  it("is admin only and validates input", async () => {
    const s = setup();
    expect((await s.bulk("soft-delete", s.ids, {}, false)).status).toBe(401);
    expect(
      (
        await s.post("/api/content/bulk", {
          action: "nope",
          type: "video",
          ids: s.ids,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await s.post("/api/content/bulk", {
          action: "restore",
          type: "video",
          ids: [],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await s.post("/api/content/bulk", {
          action: "restore",
          type: "video",
          ids: Array(501).fill("a".repeat(15)),
        })
      ).status,
    ).toBe(400);
    const r = await s.bulk("restore", ["zzzzzzzzzzzzzzz"]);
    expect(r.json.errors).toEqual([
      { id: "zzzzzzzzzzzzzzz", error: "not-found" },
    ]);
  });

  it("publishing needs explicit confirmation with the affected count", async () => {
    const s = setup();
    const r1 = await s.bulk("set-visibility", s.ids, { visibility: "public" });
    expect(r1).toMatchObject({
      status: 409,
      json: { error: "public-not-confirmed", count: 3 },
    });
    expect((await s.store.get(s.ids[0]!))?.visibility).toBe("draft");
    const r2 = await s.bulk("set-visibility", s.ids, {
      visibility: "public",
      confirmPublic: true,
    });
    expect(r2.json).toMatchObject({ updated: 3, skipped: 0 });
    const again = await s.bulk("set-visibility", s.ids, {
      visibility: "public",
      confirmPublic: true,
    });
    expect(again.json).toMatchObject({ updated: 0, skipped: 3 });
    expect(
      (await s.bulk("set-visibility", s.ids, { visibility: "protected" }))
        .status,
    ).toBe(400);
  });

  it("200 rows in one atomic write, audited with before/after", async () => {
    const s = setup(200);
    const r = await s.bulk("set-visibility", s.ids, { visibility: "private" });
    expect(r.json.updated).toBe(200);
    expect(s.calls()).toBe(1);
    const e = s.audit.entries.at(-1)!;
    expect(e).toMatchObject({ action: "bulk:set-visibility", source: "bulk" });
    expect(e.target_ids).toHaveLength(200);
    expect((e.before as any)[s.ids[0]!]).toMatchObject({ visibility: "draft" });
  });

  it("tags, set-field, soft delete / restore", async () => {
    const s = setup();
    await s.bulk("tags-add", s.ids, { tags: ["a", "b"] });
    expect((await s.store.get(s.ids[0]!))?.tags).toEqual(["a", "b"]);
    expect(
      (await s.bulk("tags-add", s.ids, { tags: ["a"] })).json,
    ).toMatchObject({ updated: 0, skipped: 3 });
    await s.bulk("tags-remove", s.ids, { tags: ["a"] });
    expect((await s.store.get(s.ids[1]!))?.tags).toEqual(["b"]);
    expect((await s.bulk("tags-add", s.ids, { tags: [] })).status).toBe(400);

    await s.bulk("set-field", s.ids, { field: "locale", value: "en" });
    expect((await s.store.get(s.ids[0]!))?.locale).toBe("en");
    await s.bulk("set-field", s.ids, { field: "category", value: "Röportaj" });
    expect((await s.store.get(s.ids[0]!))?.meta["category"]).toBe("Röportaj");
    expect(
      (await s.bulk("set-field", s.ids, { field: "locale", value: "xx" }))
        .status,
    ).toBe(400);
    for (const f of [
      "title",
      "slug",
      "visibility",
      "body_md",
      "stream_key",
      "id",
    ])
      expect(
        (await s.bulk("set-field", s.ids, { field: f, value: "x" })).json.error,
      ).toBe("field-not-allowed");
    expect(settableFields("video")).toEqual(
      expect.arrayContaining(["locale", "noindex", "category", "duration_sec"]),
    );

    expect((await s.bulk("soft-delete", s.ids)).json.updated).toBe(3);
    expect((await s.store.get(s.ids[0]!))?.is_deleted).toBe(true);
    expect((await s.bulk("restore", s.ids)).json.updated).toBe(3);
  });
});

describe("protection and unlock", () => {
  async function protectedSetup() {
    const s = setup();
    const r = await s.bulk("protect", s.ids, {
      password: "correct-horse",
      name: "Basın",
    });
    expect(r.json.updated).toBe(3);
    const group = (await s.groups.list())[0]!;
    return { s, group };
  }

  it("protect creates one group (hashed), sets visibility, and never leaks it", async () => {
    const { s, group } = await protectedSetup();
    expect(group.password_hash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/);
    expect(group.password_hash).not.toContain("correct-horse");
    const rows = await Promise.all(s.ids.map((id) => s.store.get(id)));
    expect(
      rows.every(
        (r) => r!.visibility === "protected" && r!.access_group === group.id,
      ),
    ).toBe(true);
    expect(JSON.stringify(s.audit.entries)).not.toMatch(
      /correct-horse|[0-9a-f]{64}/,
    );
    expect(
      (await s.bulk("protect", s.ids, { password: "short" })).json.error,
    ).toBe("weak-password");
    // the raw API of the admin never carries the hash either; rows only point at the group id
    expect(JSON.stringify(rows)).not.toContain(group.password_hash);
  });

  it("unlock returns the body only with the right password; wrong ones are counted", async () => {
    const { s, group } = await protectedSetup();
    const id = s.ids[0]!;
    const bad = await s.post(
      `/api/content/${id}/unlock`,
      { password: "nope" },
      false,
    );
    expect(bad).toMatchObject({
      status: 403,
      json: { error: "wrong-password" },
    });
    expect(JSON.stringify(bad.json)).not.toContain("Gizli gövde");
    expect((await s.groups.list())[0]!.failed_attempts).toBe(1);
    const ok = await s.post(
      `/api/content/${id}/unlock`,
      { password: "correct-horse" },
      false,
    );
    expect(ok.status).toBe(200);
    expect(ok.json.item.body_blocks).toEqual([
      { type: "paragraph", text: "Gizli gövde 0" },
    ]);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect((await s.groups.list())[0]!.failed_attempts).toBe(0); // reset on success
    expect(group.id).toBe((await s.groups.list())[0]!.id);
    expect(
      (await s.post(`/api/content/${s.ids[0]}/unlock`, { password: "" }, false))
        .status,
    ).toBe(400);
  });

  it("5 failures lock the group for 15 minutes, even for the right password", async () => {
    const { s } = await protectedSetup();
    const id = s.ids[0]!;
    // spread the attempts over time so only the group lock-out (not the per-IP limit) applies
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      expect(
        (
          await s.post(
            `/api/content/${id}/unlock`,
            { password: `wrong-${i}` },
            false,
          )
        ).status,
      ).toBe(403);
      clock += 10_000;
    }
    const locked = await s.post(
      `/api/content/${id}/unlock`,
      { password: "correct-horse" },
      false,
    );
    expect(locked.status).toBe(429);
    expect(locked.json.error).toBe("locked");
    expect(locked.json.retryAfterSec).toBeGreaterThan(LOCK_MINUTES * 60 - 30);
    clock += (LOCK_MINUTES * 60 + 1) * 1000;
    expect(
      (
        await s.post(
          `/api/content/${id}/unlock`,
          { password: "correct-horse" },
          false,
        )
      ).status,
    ).toBe(200);
  });

  it("the unlock endpoint is rate limited per client", async () => {
    const { s } = await protectedSetup();
    const id = s.ids[0]!;
    clock += 3_600_000;
    let last = 0;
    for (let i = 0; i < 11; i++)
      last = (
        await s.post(
          `/api/content/${id}/unlock`,
          { password: "correct-horse" },
          false,
          { "x-forwarded-for": "9.9.9.9" },
        )
      ).status;
    expect(last).toBe(429);
    expect(
      (
        await s.post(
          `/api/content/${id}/unlock`,
          { password: "correct-horse" },
          false,
          { "x-forwarded-for": "8.8.8.8" },
        )
      ).status,
    ).toBe(200);
  });

  it("unlock only works for protected rows", async () => {
    const { s } = await protectedSetup();
    await s.bulk("remove-protection", [s.ids[1]!]);
    expect(await s.store.get(s.ids[1]!)).toMatchObject({
      visibility: "draft",
      access_group: "",
    });
    expect(
      (
        await s.post(
          `/api/content/${s.ids[1]}/unlock`,
          { password: "correct-horse" },
          false,
        )
      ).status,
    ).toBe(404);
    await s.bulk("soft-delete", [s.ids[2]!]);
    expect(
      (
        await s.post(
          `/api/content/${s.ids[2]}/unlock`,
          { password: "correct-horse" },
          false,
        )
      ).status,
    ).toBe(404);
  });

  it("changing the group password applies to every member", async () => {
    const { s, group } = await protectedSetup();
    expect(
      (await s.bulk("change-password", s.ids, { password: "short" })).json
        .error,
    ).toBe("weak-password");
    const r = await s.bulk("change-password", s.ids, {
      password: "brand-new-pass",
    });
    expect(r.json.updated).toBe(3);
    for (const id of s.ids) {
      expect(
        (
          await s.post(
            `/api/content/${id}/unlock`,
            { password: "correct-horse" },
            false,
            { "x-forwarded-for": `1.1.1.${id.slice(-1)}` },
          )
        ).status,
      ).toBe(403);
      clock += 1000;
    }
    clock += 16 * 60_000; // (the wrong attempts above may have locked the group)
    const ok = await s.post(
      `/api/content/${s.ids[1]}/unlock`,
      { password: "brand-new-pass" },
      false,
      { "x-forwarded-for": "2.2.2.2" },
    );
    expect(ok.status).toBe(200);
    expect(
      (await s.groups.list()).find((g) => g.id === group.id)!.password_hash,
    ).not.toBe(group.password_hash);
    // ambiguity: rows of two different groups need an explicit groupId
    await s.bulk("protect", [s.ids[0]!], { password: "another-secret" });
    expect(
      (await s.bulk("change-password", s.ids, { password: "yet-another-one" }))
        .status,
    ).toBe(409);
  });

  it("the public library shows protected rows as stubs only", async () => {
    const { s } = await protectedSetup();
    const res = await s.content.handle(
      new Request("http://x/api/library/video"),
    );
    const body = (await res!.json()) as any;
    expect(body.items).toHaveLength(3);
    expect(
      body.items.every(
        (i: any) =>
          i.protected === true &&
          Object.keys(i).sort().join() === "id,protected,slug,title,type",
      ),
    ).toBe(true);
    expect(JSON.stringify(body)).not.toContain("Gizli gövde");
    const one = await s.content.handle(
      new Request(
        `http://x/api/library/video/${(await s.store.get(s.ids[0]!))!.slug}`,
      ),
    );
    expect(JSON.stringify(await one!.json())).not.toContain("Gizli gövde");
  });
});
