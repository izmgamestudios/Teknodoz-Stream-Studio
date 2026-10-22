// src/studio/watch/admin-token.ts
// The CATALOG_ADMIN_TOKEN typed on the admin pages. Kept in sessionStorage: this tab only.
const KEY = "studio.catalog.token";

export function readAdminToken(): string {
  try {
    return sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveAdminToken(token: string): void {
  try {
    sessionStorage.setItem(KEY, token);
  } catch {
    /* tab-only */
  }
}
