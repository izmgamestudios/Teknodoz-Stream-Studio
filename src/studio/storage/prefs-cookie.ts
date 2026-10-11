// src/studio/storage/prefs-cookie.ts
// Cookie "tkz_prefs": a tiny mirror of the shortcut map + UI language ONLY (nothing else), used as a
// fallback when localStorage is empty or blocked. SameSite=Strict, Secure on https, 365 days.
import { z } from "zod";
import type { AppSettings, ShortcutMap } from "../types";
import { isRecord, langSchema, shortcutsSchema } from "./settings-schema";

export const PREFS_COOKIE_NAME = "tkz_prefs";
/** Whole Set-Cookie string must stay below this many characters (browsers cap near 4 KB). */
export const PREFS_COOKIE_MAX_LENGTH = 3500;
export const PREFS_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
/** Ignore cookie values larger than this before even decoding them. */
const MAX_READ_LENGTH = 8192;

export interface PrefsCookieData {
  shortcuts: ShortcutMap;
  lang: AppSettings["lang"];
}

const prefsSchema = z.preprocess(
  (value) => (isRecord(value) ? value : {}),
  z.object({ s: shortcutsSchema, l: langSchema }),
);

/**
 * The full `document.cookie` assignment string for `prefs`, or `undefined` when it would not fit
 * under PREFS_COOKIE_MAX_LENGTH. Values are re-validated, so junk can never be written.
 */
export function serializePrefsCookie(
  prefs: PrefsCookieData,
  secure: boolean,
): string | undefined {
  const parsed = prefsSchema.safeParse({ s: prefs.shortcuts, l: prefs.lang });
  if (!parsed.success) return undefined;
  const value = encodeURIComponent(
    JSON.stringify({ v: 1, s: parsed.data.s, l: parsed.data.l }),
  );
  const cookie =
    `${PREFS_COOKIE_NAME}=${value}; Max-Age=${PREFS_COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Strict` +
    (secure ? "; Secure" : "");
  return cookie.length < PREFS_COOKIE_MAX_LENGTH ? cookie : undefined;
}

function readRawCookies(): string | undefined {
  try {
    if (typeof document === "undefined") return undefined;
    return document.cookie;
  } catch {
    return undefined; // sandboxed iframe / cookies disabled
  }
}

/** Parses the "tkz_prefs" cookie. Missing or corrupt cookie -> undefined; bad fields are repaired. */
export function readPrefsCookie(): PrefsCookieData | undefined {
  const all = readRawCookies();
  if (!all) return undefined;
  for (const part of all.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq).trim() !== PREFS_COOKIE_NAME) continue;
    const encoded = part.slice(eq + 1).trim();
    if (encoded === "" || encoded.length > MAX_READ_LENGTH) continue;
    try {
      const json: unknown = JSON.parse(decodeURIComponent(encoded));
      if (!isRecord(json)) continue;
      const parsed = prefsSchema.safeParse(json);
      if (parsed.success)
        return { shortcuts: parsed.data.s, lang: parsed.data.l };
    } catch {
      /* malformed percent-encoding or JSON: try the next cookie with this name */
    }
  }
  return undefined;
}

/** Writes the cookie. Returns false when cookies are unavailable or the payload is too large. */
export function writePrefsCookie(prefs: PrefsCookieData): boolean {
  try {
    if (typeof document === "undefined") return false;
    const secure =
      typeof location !== "undefined" && location.protocol === "https:";
    const cookie = serializePrefsCookie(prefs, secure);
    if (cookie === undefined) return false;
    document.cookie = cookie;
    return true;
  } catch {
    return false;
  }
}

/** Expires the cookie immediately. Never throws. */
export function clearPrefsCookie(): void {
  try {
    if (typeof document === "undefined") return;
    document.cookie = `${PREFS_COOKIE_NAME}=; Max-Age=0; Path=/; SameSite=Strict`;
  } catch {
    /* nothing to clear */
  }
}
