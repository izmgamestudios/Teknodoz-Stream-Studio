// src/studio/ui/content/bulk-bar.tsx
// Bulk actions for the selected rows. Every action is one request to /api/content/bulk (one
// transaction on the server); publishing shows the affected count and needs an explicit tick.
import { useState } from "react";

import { useT } from "../../i18n/use-t";
import type { MessageKey } from "../../i18n/messages";
import {
  bulkAction,
  type BulkAction,
  type BulkResult,
} from "../../content/content-client";
import {
  bulkSettableFields,
  type EntityType,
} from "../../../shared/schema-registry";
import { BTN_ACCENT, Check, INPUT_AUTO } from "../fields";
import { fieldLabel } from "./labels";

const ACTIONS: readonly BulkAction[] = [
  "set-visibility",
  "protect",
  "change-password",
  "remove-protection",
  "tags-add",
  "tags-remove",
  "set-field",
  "soft-delete",
  "restore",
];

const ERRORS: Record<string, MessageKey> = {
  "weak-password": "ct.bulk.err.weak",
  "group-ambiguous": "ct.bulk.err.group",
  "public-not-confirmed": "ct.bulk.err.confirm",
  "field-not-allowed": "ct.bulk.err.field",
  invalid: "ct.bulk.err.invalid",
  "bad-params": "ct.bulk.err.params",
};

export function BulkBar({
  type,
  ids,
  onDone,
}: {
  type: EntityType;
  ids: readonly string[];
  onDone: (message: string) => void;
}) {
  const t = useT();
  const [action, setAction] = useState<BulkAction | "">("");
  const [visibility, setVisibility] = useState<"draft" | "private" | "public">(
    "draft",
  );
  const [confirmPublic, setConfirmPublic] = useState(false);
  const [password, setPassword] = useState("");
  const [groupName, setGroupName] = useState("");
  const [tags, setTags] = useState("");
  const [field, setField] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fields = bulkSettableFields(type);

  const needsPassword = action === "protect" || action === "change-password";
  const ready =
    action !== "" &&
    (action !== "set-visibility" || visibility !== "public" || confirmPublic) &&
    (!needsPassword || password.length >= 8) &&
    ((action !== "tags-add" && action !== "tags-remove") ||
      tags.trim() !== "") &&
    (action !== "set-field" || field !== "");

  const params = (): Record<string, unknown> => {
    switch (action) {
      case "set-visibility":
        return {
          visibility,
          ...(visibility === "public" ? { confirmPublic: true } : {}),
        };
      case "protect":
        return {
          password,
          ...(groupName.trim() ? { name: groupName.trim() } : {}),
        };
      case "change-password":
        return { password };
      case "tags-add":
      case "tags-remove":
        return {
          tags: tags
            .split(/[,;|]/)
            .map((x) => x.trim())
            .filter(Boolean),
        };
      case "set-field": {
        const def = fields.find((f) => f.key === field);
        const v =
          def?.kind === "bool"
            ? ["true", "1", "yes", "evet"].includes(value.toLowerCase())
            : def?.kind === "number"
              ? Number(value.replace(",", "."))
              : value;
        return { field, value: v };
      }
      default:
        return {};
    }
  };

  const apply = async () => {
    if (!action) return;
    setBusy(true);
    setMsg(null);
    const r = await bulkAction(type, action, ids, params());
    setBusy(false);
    if (r.ok) {
      const d: BulkResult = r.data;
      setPassword("");
      setConfirmPublic(false);
      onDone(
        t("ct.bulk.done", {
          u: d.updated,
          s: d.skipped,
          e: d.errors.length,
        }),
      );
    } else
      setMsg({ ok: false, text: t(ERRORS[r.error] ?? "ct.bulk.err.generic") });
  };

  return (
    <section
      className="space-y-2 rounded-xl border border-primary/40 bg-card p-3"
      aria-label={t("ct.bulk.title")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-xs">
          {t("ct.bulk.title")} · {t("ct.selected", { n: ids.length })}
        </b>
        <select
          className={INPUT_AUTO}
          aria-label={t("ct.bulk.action")}
          value={action}
          onChange={(e) => {
            setAction(e.target.value as BulkAction | "");
            setMsg(null);
          }}
        >
          <option value="">{t("ct.bulk.choose")}</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {t(`ct.bulk.a.${a}` as MessageKey)}
            </option>
          ))}
        </select>

        {action === "set-visibility" && (
          <select
            className={INPUT_AUTO}
            aria-label={t("ct.bulk.visibilityValue")}
            value={visibility}
            onChange={(e) => {
              setVisibility(e.target.value as typeof visibility);
              setConfirmPublic(false);
            }}
          >
            {(["draft", "private", "public"] as const).map((v) => (
              <option key={v} value={v}>
                {t(`ct.vis.${v}` as MessageKey)}
              </option>
            ))}
          </select>
        )}
        {needsPassword && (
          <input
            className={`${INPUT_AUTO} w-48`}
            type="password"
            autoComplete="new-password"
            aria-label={t("ct.bulk.password")}
            placeholder={t("ct.bulk.password")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
        {action === "protect" && (
          <input
            className={`${INPUT_AUTO} w-40`}
            aria-label={t("ct.bulk.groupName")}
            placeholder={t("ct.bulk.groupName")}
            maxLength={80}
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
          />
        )}
        {(action === "tags-add" || action === "tags-remove") && (
          <input
            className={`${INPUT_AUTO} w-56`}
            aria-label={t("ct.hint.tags")}
            placeholder={t("ct.hint.tags")}
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
        )}
        {action === "set-field" && (
          <>
            <select
              className={INPUT_AUTO}
              aria-label={t("ct.bulk.field")}
              value={field}
              onChange={(e) => {
                setField(e.target.value);
                setValue("");
              }}
            >
              <option value="">{t("ct.bulk.field")}</option>
              {fields.map((f) => (
                <option key={f.key} value={f.key}>
                  {fieldLabel(t, f.key)}
                </option>
              ))}
            </select>
            {field &&
              (fields.find((f) => f.key === field)?.kind === "select" ? (
                <select
                  className={INPUT_AUTO}
                  aria-label={t("ct.bulk.value")}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                >
                  <option value="">—</option>
                  {(fields.find((f) => f.key === field)?.options ?? []).map(
                    (o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ),
                  )}
                </select>
              ) : (
                <input
                  className={`${INPUT_AUTO} w-44`}
                  aria-label={t("ct.bulk.value")}
                  placeholder={
                    fields.find((f) => f.key === field)?.kind === "bool"
                      ? "true / false"
                      : t("ct.bulk.value")
                  }
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              ))}
          </>
        )}
        <button
          className={BTN_ACCENT}
          disabled={!ready || busy}
          onClick={() => void apply()}
        >
          {t("ct.bulk.apply")}
        </button>
      </div>
      {action === "set-visibility" && visibility === "public" && (
        <div role="alert" className="rounded-md border border-primary p-2">
          <Check checked={confirmPublic} onChange={setConfirmPublic}>
            {t("ct.bulk.confirmPublic", { n: ids.length })}
          </Check>
        </div>
      )}
      {action === "protect" && (
        <p className="text-xs text-muted-foreground">
          {t("ct.bulk.protectHint")}
        </p>
      )}
      {action === "change-password" && (
        <p className="text-xs text-muted-foreground">
          {t("ct.bulk.changeHint")}
        </p>
      )}
      {msg && (
        <p
          role={msg.ok ? "status" : "alert"}
          className={`text-xs ${msg.ok ? "text-muted-foreground" : "text-destructive"}`}
        >
          {msg.text}
        </p>
      )}
    </section>
  );
}
