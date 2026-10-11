// src/studio/ui/live-destinations.tsx
// Editor of the RTMP(S) destinations (platform preset, server URL, stream key).
import { useState } from "react";

import { createLiveApi } from "../live/api";
import { describeApiError } from "../live/messages";
import { PLATFORMS, getPlatform, type PlatformId } from "../live/platforms";
import { newDest, type DestState } from "../live/settings";
import { BTN, BTN_ACCENT, Check, INPUT, PANEL, PanelTitle } from "./fields";

const MAX = 4;

function DestinationCard({
  d,
  token,
  disabled,
  onChange,
  onRemove,
}: {
  d: DestState;
  token: string;
  disabled: boolean;
  onChange: (patch: Partial<DestState>) => void;
  onRemove: () => void;
}) {
  const p = getPlatform(d.platform);
  const [show, setShow] = useState(false);
  const [probe, setProbe] = useState<string | null>(null);
  const plain = d.server.trim().toLowerCase().startsWith("rtmp://");

  const test = async () => {
    setProbe("Deneniyor…");
    try {
      const r = await createLiveApi().probe(token, d.server.trim());
      setProbe(
        r.reachable
          ? `✓ ${r.host}:${r.port} erişilebilir (${r.ms} ms). Anahtar yayın başlayınca doğrulanır.`
          : `✗ ${r.host}:${r.port} sunucudan erişilemiyor (güvenlik duvarı?).`,
      );
    } catch (e) {
      setProbe(
        `✗ ${e instanceof Error && "code" in e ? describeApiError(e as never) : "Sınanamadı."}`,
      );
    }
  };

  return (
    <li className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={d.enabled}
            disabled={disabled}
            onChange={(e) => onChange({ enabled: e.target.checked })}
            aria-label={`${p.name} hedefini kullan`}
          />
          <span aria-hidden="true">{p.icon}</span>
          <select
            className="rounded-md border bg-background px-2 py-1 text-sm"
            value={d.platform}
            disabled={disabled}
            aria-label="Platform"
            onChange={(e) => {
              const next = getPlatform(e.target.value);
              onChange({
                platform: next.id,
                label: next.name,
                // keep a custom address, otherwise take the preset of the new platform
                server:
                  next.server ||
                  (getPlatform(d.platform).server === d.server ? "" : d.server),
              });
            }}
          >
            {PLATFORMS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <button className={BTN} disabled={disabled} onClick={onRemove}>
          Kaldır
        </button>
      </div>

      <label className="block text-xs">
        <span className="mb-1 block text-muted-foreground">Sunucu adresi</span>
        <input
          className={`${INPUT} font-mono`}
          value={d.server}
          disabled={disabled}
          placeholder="rtmps://…"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => onChange({ server: e.target.value })}
        />
      </label>
      <label className="block text-xs">
        <span className="mb-1 block text-muted-foreground">
          Yayın anahtarı (stream key)
        </span>
        <span className="flex gap-1.5">
          <input
            className={`${INPUT} font-mono`}
            type={show ? "text" : "password"}
            value={d.key}
            disabled={disabled}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => onChange({ key: e.target.value })}
          />
          <button
            className={BTN}
            type="button"
            onClick={() => setShow((v) => !v)}
          >
            {show ? "Gizle" : "Göster"}
          </button>
        </span>
      </label>

      <p className="text-[11px] text-muted-foreground">
        <b>Nerede:</b> {p.where}. {p.note}
      </p>
      {plain && (
        <p className="text-[11px] text-primary">
          ⚠ rtmp:// şifresizdir; yayın anahtarınız ağda açık gider. Mümkünse
          rtmps:// kullanın.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          className={BTN}
          disabled={disabled || !d.server.trim()}
          onClick={() => void test()}
        >
          Sunucuyu sına
        </button>
        {probe && (
          <span className="text-[11px] text-muted-foreground">{probe}</span>
        )}
      </div>
    </li>
  );
}

export function DestinationsCard({
  dests,
  token,
  locked,
  rememberKeys,
  onChange,
  onRememberKeys,
}: {
  dests: DestState[];
  token: string;
  locked: boolean;
  rememberKeys: boolean;
  onChange: (next: DestState[]) => void;
  onRememberKeys: (on: boolean) => void;
}) {
  const [adding, setAdding] = useState<PlatformId>("youtube");
  return (
    <section className={PANEL} aria-label="Hedefler">
      <PanelTitle
        aside={
          <span className="text-[11px] text-muted-foreground">
            {dests.filter((d) => d.enabled).length}/{dests.length} açık · en çok{" "}
            {MAX}
          </span>
        }
      >
        Hedefler
      </PanelTitle>
      <p className="mb-2 text-[11px] text-muted-foreground">
        Birden fazla hedef seçerseniz görüntü sunucuda tek kez kodlanır ve
        hepsine birden gider.
      </p>
      <ul className="space-y-2">
        {dests.map((d) => (
          <DestinationCard
            key={d.id}
            d={d}
            token={token}
            disabled={locked}
            onChange={(patch) =>
              onChange(
                dests.map((x) => (x.id === d.id ? { ...x, ...patch } : x)),
              )
            }
            onRemove={() => onChange(dests.filter((x) => x.id !== d.id))}
          />
        ))}
      </ul>
      {dests.length < MAX && (
        <div className="mt-2 flex items-center gap-2">
          <select
            className="rounded-md border bg-background px-2 py-1.5 text-xs"
            value={adding}
            disabled={locked}
            aria-label="Eklenecek platform"
            onChange={(e) => setAdding(e.target.value as PlatformId)}
          >
            {PLATFORMS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.icon} {x.name}
              </option>
            ))}
          </select>
          <button
            className={BTN_ACCENT}
            disabled={locked}
            onClick={() => onChange([...dests, newDest(adding)])}
          >
            + Hedef ekle
          </button>
        </div>
      )}
      <div className="mt-3 border-t pt-2">
        <Check checked={rememberKeys} onChange={onRememberKeys}>
          <span className="text-[11px]">
            Yayın anahtarlarını bu tarayıcıda sakla (varsayılan: kapalı; anahtar
            yalnızca bellekte tutulur)
          </span>
        </Check>
      </div>
    </section>
  );
}
