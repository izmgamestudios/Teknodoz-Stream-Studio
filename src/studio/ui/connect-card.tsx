// src/studio/ui/connect-card.tsx
// "Paste/confirm the invite -> get the answer code" card for the manual (serverless) flow.
import { useEffect, useState } from "react";

import { useT } from "../i18n/use-t";
import type { ClientStatus } from "../p2p";
import { BTN_ACCENT, Check, INPUT } from "./fields";
import { QrImage } from "./qr-image";
import { useFragmentCode, type ConnectPhase } from "./use-client";

export function ConnectCard({
  phase,
  answer,
  status,
  error,
  askName,
  onConnect,
}: {
  phase: ConnectPhase;
  answer: string;
  status: ClientStatus;
  error: string;
  askName: boolean;
  onConnect: (code: string, name: string, usePublicStun: boolean) => void;
}) {
  const t = useT();
  const fragment = useFragmentCode();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [stun, setStun] = useState(true);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (fragment) setCode(fragment);
  }, [fragment]);

  if (phase === "answer" && status === "connecting") {
    return (
      <div className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="font-semibold">{t("connect.step2")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("connect.step2.body")}
        </p>
        <textarea
          readOnly
          className={`${INPUT} h-28 resize-y font-mono`}
          value={answer}
          onFocus={(e) => e.currentTarget.select()}
          aria-label={t("connect.answerLabel")}
        />
        <div className="flex flex-wrap items-start gap-4">
          <button
            className={BTN_ACCENT}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(answer);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                /* the user can still select the text */
              }
            }}
          >
            {copied ? t("common.copied") : t("connect.copyCode")}
          </button>
          <QrImage text={answer} size={180} />
        </div>
        <p className="text-xs text-muted-foreground" role="status">
          {t("connect.waitingHost")}
        </p>
      </div>
    );
  }

  if (phase === "answer") return null;

  return (
    <form
      className="space-y-3 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onConnect(code, name, stun);
      }}
    >
      <h2 className="font-semibold">{t("connect.step1")}</h2>
      <label className="block text-xs text-muted-foreground">
        {t("connect.inviteLabel")}
        <textarea
          className={`${INPUT} mt-1 h-24 resize-y font-mono`}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={t("connect.invitePlaceholder")}
          spellCheck={false}
        />
      </label>
      {askName && (
        <label className="block text-xs text-muted-foreground">
          {t("connect.name")}
          <input
            className={`${INPUT} mt-1`}
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      )}
      <Check checked={stun} onChange={setStun}>
        {t("connect.stun")}
      </Check>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <button
        className={BTN_ACCENT}
        type="submit"
        disabled={phase === "connecting" || code.trim() === ""}
      >
        {phase === "connecting"
          ? t("connect.preparing")
          : t("connect.continue")}
      </button>
      <p className="text-[11px] text-muted-foreground">
        {t("connect.privacy")}
      </p>
    </form>
  );
}
