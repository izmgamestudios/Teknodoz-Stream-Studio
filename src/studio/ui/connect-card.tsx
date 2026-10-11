// src/studio/ui/connect-card.tsx
// "Paste/confirm the invite -> get the answer code" card shared by /join and /remote.
import { useEffect, useState } from "react";

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
        <h2 className="font-semibold">
          2. adım — yanıt kodunu yayıncıya gönderin
        </h2>
        <p className="text-sm text-muted-foreground">
          Aşağıdaki kodu kopyalayıp yayıncıya iletin; yayıncı “Yanıt kodu”
          kutusuna yapıştırınca bağlantı otomatik kurulur.
        </p>
        <textarea
          readOnly
          className={`${INPUT} h-28 resize-y font-mono`}
          value={answer}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Yanıt kodu"
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
            {copied ? "✓ Kopyalandı" : "Kodu kopyala"}
          </button>
          <QrImage text={answer} size={180} />
        </div>
        <p className="text-xs text-muted-foreground" role="status">
          Yayıncının kodu girmesi bekleniyor…
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
      <h2 className="font-semibold">1. adım — daveti doğrulayın</h2>
      <label className="block text-xs text-muted-foreground">
        Davet bağlantısı veya kodu
        <textarea
          className={`${INPUT} mt-1 h-24 resize-y font-mono`}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Bağlantı otomatik gelmediyse buraya yapıştırın"
          spellCheck={false}
        />
      </label>
      {askName && (
        <label className="block text-xs text-muted-foreground">
          Adınız (yayıncı görür)
          <input
            className={`${INPUT} mt-1`}
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      )}
      <Check checked={stun} onChange={setStun}>
        Genel STUN kullan (internet üzerinden bağlanmak için; yalnızca IP
        adresiniz STUN sağlayıcısına görünür)
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
        {phase === "connecting" ? "Hazırlanıyor…" : "Devam"}
      </button>
      <p className="text-[11px] text-muted-foreground">
        Kamera, mikrofon veya ekran görüntünüz hiçbir sunucuya gitmez; yalnızca
        yayıncının tarayıcısıyla doğrudan (P2P) paylaşılır.
      </p>
    </form>
  );
}
