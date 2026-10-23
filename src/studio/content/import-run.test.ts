// src/studio/content/import-run.test.ts
import { describe, expect, it } from "vitest";

import type {
  ImportCall,
  ImportRequest,
  ImportResponse,
} from "./content-client";
import { commitRun, dryRun } from "./import-run";

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    n: i + 2,
    input: { title: `T${i}` },
  }));

function fakeApi(failOn?: {
  mode: "dry" | "commit";
  chunk: number;
  error: string;
}) {
  const log: ImportRequest[] = [];
  const post: ImportCall = async (req) => {
    const chunk = log.filter((r) => r.mode === req.mode).length;
    log.push(req);
    if (failOn && failOn.mode === req.mode && failOn.chunk === chunk)
      return { ok: false, status: 409, error: failOn.error };
    const data: ImportResponse = {
      mode: req.mode,
      planHash: `h${chunk}`,
      summary: {
        create: req.rows.length,
        update: 0,
        skip: 0,
        error: 0,
        unpublish: 0,
        conflict: 0,
      },
      rows: req.rows.map((r) => ({
        n: r.n,
        action: "create",
        id: "",
        slug: "",
        issues: [],
      })),
    };
    return { ok: true, data };
  };
  return { post, log };
}

describe("import runner", () => {
  it("dry-runs every chunk of 500 and commits with each chunk's hash", async () => {
    const api = fakeApi();
    const progress: string[] = [];
    const dry = await dryRun(
      api.post,
      "video",
      rows(1201),
      "draft",
      "imp-12345678",
      (d, t) => progress.push(`${d}/${t}`),
    );
    expect(dry.ok).toBe(true);
    if (!dry.ok) return;
    expect(dry.chunks.map((c) => c.rows.length)).toEqual([500, 500, 201]);
    expect(dry.summary.create).toBe(1201);
    expect(progress).toEqual(["0/3", "1/3", "2/3", "3/3"]);
    const done = await commitRun(api.post, "video", dry, "draft", true);
    expect(done.ok && done.summary.create).toBe(1201);
    const commits = api.log.filter((r) => r.mode === "commit");
    expect(commits.map((c) => c.planHash)).toEqual(["h0", "h1", "h2"]);
    expect(
      commits.every(
        (c) => c.confirmUnpublish === true && c.importId === "imp-12345678",
      ),
    ).toBe(true);
  });

  it("stops at the first failing chunk and says which", async () => {
    const dry = await dryRun(
      fakeApi({ mode: "dry", chunk: 1, error: "rate-limited" }).post,
      "video",
      rows(900),
      "draft",
      "imp-12345678",
    );
    expect(dry).toEqual({ ok: false, error: "rate-limited", atChunk: 1 });
    const api = fakeApi({ mode: "commit", chunk: 1, error: "plan-changed" });
    const ok = await dryRun(
      api.post,
      "video",
      rows(900),
      "draft",
      "imp-12345678",
    );
    if (!ok.ok) throw new Error("dry failed");
    expect(await commitRun(api.post, "video", ok, "draft", false)).toEqual({
      ok: false,
      error: "plan-changed",
      atChunk: 1,
    });
  });
});
