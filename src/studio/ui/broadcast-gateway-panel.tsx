// src/studio/ui/broadcast-gateway-panel.tsx
// Talks to the local NVIDIA Broadcast MCP gateway (Broadcast 2.3+, loopback, no key). The effect
// list is whatever the gateway advertises, so nothing here assumes tool names.
import { useState } from "react";

import {
  type ArgField,
  type BroadcastGateway,
  DEFAULT_GATEWAY,
  discoverGateway,
  fieldsFor,
  GatewayError,
  type GatewayTool,
} from "../engine/broadcast-gateway";
import { BTN, INPUT } from "./fields";

const HELP =
  "Bağlanamadı. Kontrol et: NVIDIA Broadcast 2.3 veya üstü açık mı (Ayarlar → AI Agent Resources)? Tarayıcı, siteye yerel ağ erişimi izni vermeli (Chrome: adres çubuğu → site ayarları → Yerel ağ erişimi). Gateway tarayıcı (CORS) isteklerini kabul etmiyorsa bu panel çalışmaz; yine de yukarıdan “✨ NVIDIA Broadcast” mikrofonunu seçmek aynı gürültü gidermeyi verir.";

function ToolForm({ gw, tool }: { gw: BroadcastGateway; tool: GatewayTool }) {
  const fields = fieldsFor(tool);
  const [vals, setVals] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, f.initial])),
  );
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setOut("");
    try {
      const args = Object.fromEntries(
        fields
          .filter((f) => f.required || vals[f.name] !== "")
          .map((f) => [f.name, vals[f.name]]),
      );
      setOut(await gw.call(tool.name, args));
    } catch (e) {
      setOut(`Hata: ${e instanceof Error ? e.message : "bilinmeyen"}`);
    } finally {
      setBusy(false);
    }
  };

  const input = (f: ArgField) => {
    const v = vals[f.name];
    const set = (x: unknown) => setVals((p) => ({ ...p, [f.name]: x }));
    if (f.kind === "boolean")
      return (
        <input
          type="checkbox"
          className="size-4"
          checked={Boolean(v)}
          onChange={(e) => set(e.target.checked)}
        />
      );
    if (f.kind === "enum")
      return (
        <select
          className={INPUT}
          value={String(v)}
          onChange={(e) => set(e.target.value)}
        >
          {f.options!.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      );
    if (f.kind === "number")
      return (
        <input
          type="number"
          className={INPUT}
          value={Number(v)}
          {...(f.min !== undefined ? { min: f.min } : {})}
          {...(f.max !== undefined ? { max: f.max } : {})}
          step="any"
          onChange={(e) => set(Number(e.target.value))}
        />
      );
    return (
      <input
        className={INPUT}
        value={String(v ?? "")}
        onChange={(e) => set(e.target.value)}
      />
    );
  };

  return (
    <li className="space-y-1.5 rounded-lg border p-2">
      <p className="text-xs font-semibold">{tool.name}</p>
      {tool.description && (
        <p className="text-[11px] text-muted-foreground">{tool.description}</p>
      )}
      {fields.map((f) => (
        <label key={f.name} className="block text-[11px]">
          <span className="text-muted-foreground">
            {f.label}
            {f.required ? " *" : ""}
          </span>
          {input(f)}
        </label>
      ))}
      <button className={BTN} disabled={busy} onClick={() => void run()}>
        {busy ? "Çalışıyor…" : "Çalıştır"}
      </button>
      {out && (
        <pre
          role="status"
          className="max-h-24 overflow-auto whitespace-pre-wrap rounded bg-secondary p-1.5 text-[10px]"
        >
          {out}
        </pre>
      )}
    </li>
  );
}

export function BroadcastGatewayPanel() {
  const [url, setUrl] = useState("");
  const [gw, setGw] = useState<BroadcastGateway | null>(null);
  const [state, setState] = useState<"idle" | "connecting" | "error">("idle");
  const [err, setErr] = useState("");

  const connect = async () => {
    setState("connecting");
    setErr("");
    try {
      setGw(await discoverGateway(url || undefined));
      setState("idle");
    } catch (e) {
      setGw(null);
      setState("error");
      setErr(
        e instanceof GatewayError && e.code === "invalid-url"
          ? e.message
          : e instanceof GatewayError && e.code === "rpc"
            ? `Gateway yanıt verdi ama hata döndürdü: ${e.message}`
            : HELP,
      );
    }
  };

  return (
    <details className="mt-3 rounded-lg border p-2">
      <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        NVIDIA Broadcast gateway (gelişmiş)
      </summary>
      <div className="mt-2 space-y-2 text-xs">
        <p className="text-[11px] text-muted-foreground">
          NVIDIA Broadcast 2.3+ bilgisayarında yerel bir MCP sunucusu açar (
          {DEFAULT_GATEWAY}, portlar 18100–18109, anahtar yok). Bağlanınca
          kamera/mikrofon/hoparlör efektleri (gürültü giderme, yankı giderme,
          Studio Voice…) burada listelenir.
        </p>
        <div className="flex gap-2">
          <input
            className={INPUT}
            placeholder="Otomatik (18100–18109)"
            aria-label="Gateway adresi"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button
            className={BTN}
            disabled={state === "connecting"}
            onClick={() => void connect()}
          >
            {state === "connecting" ? "Aranıyor…" : gw ? "Yenile" : "Bağlan"}
          </button>
        </div>
        {state === "error" && (
          <p role="alert" className="text-[11px] text-destructive">
            {err}
          </p>
        )}
        {gw && (
          <>
            <p role="status" className="text-[11px] text-speaker-b">
              ✓ Bağlandı ({gw.url.host}) · {gw.tools.length} araç
            </p>
            <ul className="space-y-2">
              {gw.tools.map((t) => (
                <ToolForm key={t.name} gw={gw} tool={t} />
              ))}
            </ul>
          </>
        )}
      </div>
    </details>
  );
}
