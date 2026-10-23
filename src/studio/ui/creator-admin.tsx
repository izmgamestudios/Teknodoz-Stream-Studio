// src/studio/ui/creator-admin.tsx
// Administrator's list of creator applications: approve (creates the sign-in details, shown
// once), reject, revoke, reset the password, delete. Ready-made mail / SMS / WhatsApp links carry
// the message to the person: the server sends nothing itself.
import { useCallback, useEffect, useState } from "react";

import { useLang, useT } from "../i18n/use-t";
import type { MessageKey } from "../i18n/messages";
import {
  contactLinks,
  credentialMessage,
  decideCreator,
  deleteCreator,
  listCreators,
  type CreatorEntry,
  type Credentials,
} from "../watch/creator-session";
import { BTN, BTN_ACCENT, PANEL, PanelTitle } from "./fields";

export function CreatorApplications() {
  const t = useT();
  const lang = useLang();
  const [list, setList] = useState<CreatorEntry[] | null>(null);
  const [off, setOff] = useState(false);
  const [shown, setShown] = useState<{
    entry: CreatorEntry;
    creds: Credentials;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const r = await listCreators();
    setOff(r === null);
    setList(r);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function decide(
    entry: CreatorEntry,
    action: "approve" | "reject" | "revoke" | "reset",
  ) {
    const r = await decideCreator(entry.id, action);
    if (r.ok && r.credentials) setShown({ entry, creds: r.credentials });
    await load();
  }

  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(lang) : t("cr.admin.never");
  const pending = (list ?? []).filter((c) => c.status === "pending").length;

  return (
    <section className={PANEL} aria-label={t("cr.admin.title")}>
      <PanelTitle>
        {t("cr.admin.title")}
        {pending > 0 ? ` (${pending})` : ""}
      </PanelTitle>
      {off && (
        <p className="text-sm text-muted-foreground">{t("cr.admin.off")}</p>
      )}
      {list && list.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("cr.admin.empty")}</p>
      )}

      {shown && (
        <div
          role="status"
          className="my-2 space-y-2 rounded-md border border-speaker-b/50 p-3 text-sm"
        >
          <p className="font-semibold">{t("cr.admin.creds")}</p>
          <p className="font-mono">
            {shown.creds.username} · {shown.creds.password}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {t("cr.admin.send")}
            </span>
            {contactLinks(
              shown.entry,
              credentialMessage(shown.entry.name, shown.creds, location.origin),
            ).map((l) => (
              <a
                key={l.label}
                className={BTN}
                href={l.href}
                target={l.label === "whatsapp" ? "_blank" : undefined}
                rel="noreferrer"
              >
                {t(`cr.admin.${l.label}` as MessageKey)}
              </a>
            ))}
            <button
              className={BTN}
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(
                    credentialMessage(
                      shown.entry.name,
                      shown.creds,
                      location.origin,
                    ),
                  )
                  .then(() => setCopied(true));
              }}
            >
              {copied ? t("cr.admin.copied") : t("cr.admin.copy")}
            </button>
            <button
              className="text-xs underline"
              onClick={() => setShown(null)}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <ul className="divide-y">
        {(list ?? []).map((c) => (
          <li key={c.id} className="space-y-1 py-2" data-testid="creator-row">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{c.name}</span>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px]">
                {t(`cr.status.${c.status}` as MessageKey)}
              </span>
              {c.username && (
                <span className="font-mono text-xs">{c.username}</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {[c.phone, c.email].filter(Boolean).join(" · ")} ·{" "}
              {when(c.createdAt)}
              {c.status === "approved" &&
                ` · ${t("cr.admin.lastLogin")}: ${when(c.lastLoginAt)}`}
            </p>
            <div className="flex flex-wrap gap-2">
              {c.status === "pending" && (
                <>
                  <button
                    className={BTN_ACCENT}
                    onClick={() => void decide(c, "approve")}
                  >
                    {t("cr.admin.approve")}
                  </button>
                  <button
                    className={BTN}
                    onClick={() => void decide(c, "reject")}
                  >
                    {t("cr.admin.reject")}
                  </button>
                </>
              )}
              {c.status === "approved" && (
                <>
                  <button
                    className={BTN}
                    onClick={() => void decide(c, "reset")}
                  >
                    {t("cr.admin.reset")}
                  </button>
                  <button
                    className={BTN}
                    onClick={() => void decide(c, "revoke")}
                  >
                    {t("cr.admin.revoke")}
                  </button>
                </>
              )}
              <button
                className={BTN}
                onClick={async () => {
                  if (!confirm(t("cr.admin.deleteConfirm"))) return;
                  await deleteCreator(c.id);
                  await load();
                }}
              >
                {t("cr.admin.delete")}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
