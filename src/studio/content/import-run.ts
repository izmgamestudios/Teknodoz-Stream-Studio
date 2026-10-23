// src/studio/content/import-run.ts
// Runs an import against the API chunk by chunk: dry run for every chunk, then (after the admin
// has seen the plan) commit with each chunk's plan hash. The network call is injected for tests.
import type { EntityType } from "../../shared/schema-registry";
import {
  type ImportCall,
  type ImportRowDto,
  type PlanRowDto,
  type PlanSummary,
} from "./content-client";
import { chunkRows } from "./files";

export interface DryRun {
  importId: string;
  chunks: { rows: ImportRowDto[]; planHash: string }[];
  summary: PlanSummary;
  rows: PlanRowDto[];
}

export const emptySummary = (): PlanSummary => ({
  create: 0,
  update: 0,
  skip: 0,
  error: 0,
  unpublish: 0,
  conflict: 0,
});

const add = (a: PlanSummary, b: PlanSummary): PlanSummary => ({
  create: a.create + b.create,
  update: a.update + b.update,
  skip: a.skip + b.skip,
  error: a.error + b.error,
  unpublish: a.unpublish + b.unpublish,
  conflict: a.conflict + b.conflict,
});

export type RunFailure = { ok: false; error: string; atChunk: number };

export async function dryRun(
  post: ImportCall,
  type: EntityType,
  rows: readonly ImportRowDto[],
  onMatch: "draft" | "keep",
  importId: string,
  progress?: (done: number, total: number) => void,
): Promise<({ ok: true } & DryRun) | RunFailure> {
  const chunks = chunkRows(rows);
  const out: DryRun = {
    importId,
    chunks: [],
    summary: emptySummary(),
    rows: [],
  };
  for (let i = 0; i < chunks.length; i++) {
    progress?.(i, chunks.length);
    const r = await post({
      type,
      importId,
      onMatch,
      mode: "dry",
      rows: chunks[i]!,
    });
    if (!r.ok) return { ok: false, error: r.error, atChunk: i };
    out.chunks.push({ rows: chunks[i]!, planHash: r.data.planHash });
    out.summary = add(out.summary, r.data.summary);
    out.rows.push(...r.data.rows);
  }
  progress?.(chunks.length, chunks.length);
  return { ok: true, ...out };
}

export async function commitRun(
  post: ImportCall,
  type: EntityType,
  dry: DryRun,
  onMatch: "draft" | "keep",
  confirmUnpublish: boolean,
  progress?: (done: number, total: number) => void,
): Promise<
  { ok: true; summary: PlanSummary; rows: PlanRowDto[] } | RunFailure
> {
  let summary = emptySummary();
  const rows: PlanRowDto[] = [];
  for (let i = 0; i < dry.chunks.length; i++) {
    progress?.(i, dry.chunks.length);
    const c = dry.chunks[i]!;
    const r = await post({
      type,
      importId: dry.importId,
      onMatch,
      mode: "commit",
      rows: c.rows,
      planHash: c.planHash,
      confirmUnpublish,
    });
    if (!r.ok) return { ok: false, error: r.error, atChunk: i };
    summary = add(summary, r.data.summary);
    rows.push(...r.data.rows);
  }
  progress?.(dry.chunks.length, dry.chunks.length);
  return { ok: true, summary, rows };
}
