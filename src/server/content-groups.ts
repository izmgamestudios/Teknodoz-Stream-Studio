// src/server/content-groups.ts
// Access groups for `protected` content: one password shared by all items of a group. Rows never
// carry a hash; only this module (and the bulk / unlock routes) read the group store.
import { checkPassword, hashPassword, type RecordStore } from "./catalog";
import { newContentId } from "./content-model";

export interface AccessGroup {
  id: string;
  name: string;
  /** scrypt "salt:hash" */
  password_hash: string;
  failed_attempts: number;
  /** ISO time until which unlocking is refused (empty = not locked) */
  locked_until: string;
  created_at: string;
  updated_at: string;
}

export type GroupStore = RecordStore<AccessGroup>;

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;
export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 200;

export const validPassword = (p: unknown): p is string =>
  typeof p === "string" && p.length >= MIN_PASSWORD && p.length <= MAX_PASSWORD;

export function newGroup(
  name: string,
  password: string,
  now: string,
): AccessGroup {
  return {
    id: newContentId(),
    name: name.slice(0, 80),
    password_hash: hashPassword(password),
    failed_attempts: 0,
    locked_until: "",
    created_at: now,
    updated_at: now,
  };
}

export function setGroupPassword(
  g: AccessGroup,
  password: string,
  now: string,
): AccessGroup {
  return {
    ...g,
    password_hash: hashPassword(password),
    failed_attempts: 0,
    locked_until: "",
    updated_at: now,
  };
}

export type UnlockCheck =
  | { ok: true; group: AccessGroup }
  | { ok: false; reason: "locked"; retryAfterSec: number }
  | { ok: false; reason: "wrong"; group: AccessGroup };

/** Lock-out first (a locked group is not even tested), then the password. Pure: returns the next group state. */
export function tryUnlock(
  group: AccessGroup,
  password: string,
  nowMs: number,
): UnlockCheck {
  const until = group.locked_until ? Date.parse(group.locked_until) : 0;
  if (until > nowMs)
    return {
      ok: false,
      reason: "locked",
      retryAfterSec: Math.ceil((until - nowMs) / 1000),
    };
  if (checkPassword(password, group.password_hash))
    return {
      ok: true,
      group: {
        ...group,
        failed_attempts: 0,
        locked_until: "",
        updated_at: new Date(nowMs).toISOString(),
      },
    };
  const failed = group.failed_attempts + 1;
  const lock = failed >= MAX_FAILED_ATTEMPTS;
  return {
    ok: false,
    reason: "wrong",
    group: {
      ...group,
      failed_attempts: lock ? 0 : failed,
      locked_until: lock
        ? new Date(nowMs + LOCK_MINUTES * 60_000).toISOString()
        : "",
      updated_at: new Date(nowMs).toISOString(),
    },
  };
}
