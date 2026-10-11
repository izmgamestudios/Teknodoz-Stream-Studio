// src/studio/room/log.ts
// Local activity log of the room (invites, requests, approvals, connections). Stored only in
// this browser (IndexedDB via KvStore); nothing is sent to the server.
import type { KvStore } from "../types";

export type LogKind =
  | "room"
  | "link"
  | "request"
  | "approve"
  | "reject"
  | "connect"
  | "disconnect"
  | "error";

export interface LogEntry {
  id: string;
  at: number;
  kind: LogKind;
  text: string;
  guestId?: string;
}

export const LOG_KEY = "room:log";
export const MAX_LOG_ENTRIES = 500;

let counter = 0;
export function newLogId(at: number): string {
  counter = (counter + 1) % 1_000_000;
  return `${at.toString(36)}-${counter.toString(36)}`;
}

export function isLogEntry(v: unknown): v is LogEntry {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e["id"] === "string" &&
    typeof e["at"] === "number" &&
    Number.isFinite(e["at"]) &&
    typeof e["text"] === "string" &&
    typeof e["kind"] === "string"
  );
}

export async function loadLog(kv: KvStore): Promise<LogEntry[]> {
  try {
    const raw = await kv.get<unknown>(LOG_KEY);
    if (!Array.isArray(raw)) return [];
    return raw.filter(isLogEntry).slice(-MAX_LOG_ENTRIES);
  } catch {
    return [];
  }
}

export async function saveLog(
  kv: KvStore,
  log: readonly LogEntry[],
): Promise<void> {
  try {
    await kv.set(LOG_KEY, log.slice(-MAX_LOG_ENTRIES));
  } catch {
    // quota / private mode: the in-memory log still works
  }
}

/** CSV-escape a cell and neutralise spreadsheet formula injection (=, +, -, @, tab, CR). */
export function csvCell(v: string): string {
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function logToCsv(log: readonly LogEntry[]): string {
  const rows = [["zaman", "tur", "olay", "kisi"]];
  for (const e of log) {
    rows.push([new Date(e.at).toISOString(), e.kind, e.text, e.guestId ?? ""]);
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}
