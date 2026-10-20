// src/studio/ui/voice-panel.tsx
// Voice enhancement: noise gate / reduction, EQ + compression, rumble filter, limiter and
// automatic music ducking while someone speaks. Presets cover the common cases.
import { useRef, useState } from "react";

import { meterFraction } from "../engine/audio-bus";
import {
  applyVoicePreset,
  type VoicePreset,
  type VoiceSettings,
} from "../engine/voice";
import { useAudioState, useStudio, useVoice } from "../runtime/use-studio";
import { BroadcastGatewayPanel } from "./broadcast-gateway-panel";
import { Check, Field, PANEL, PanelTitle, RangeInput } from "./fields";

const PRESETS: readonly {
  id: Exclude<VoicePreset, "custom">;
  label: string;
  hint: string;
}[] = [
  {
    id: "off",
    label: "Kapalı",
    hint: "Yalnızca tarayıcının yerleşik gürültü/yankı engelleme",
  },
  { id: "speech", label: "Konuşma", hint: "Temiz ses, hafif dokunuş" },
  { id: "podcast", label: "Podcast", hint: "Sıcak, net, sıkı dinamik" },
  {
    id: "noisy",
    label: "Gürültülü ortam",
    hint: "Fan, sokak, klavye: yapay zeka + güçlü kapı",
  },
  {
    id: "nvidia",
    label: "✨ NVIDIA / AI mikrofon",
    hint: "Mikrofon zaten temiz (NVIDIA Broadcast, RTX Voice, Krisp): çift işleme yok",
  },
];

export function VoicePanel() {
  const rt = useStudio();
  const { settings: s, meter } = useVoice();
  const audio = useAudioState();
  const hasMic = audio.channels.some((c) => c.id === "mic");
  const [calibrating, setCalibrating] = useState(false);
  const [note, setNote] = useState("");
  const samples = useRef<number[]>([]);

  const set = (patch: Partial<VoiceSettings>) =>
    rt.setVoiceSettings({ ...s, ...patch, preset: "custom" });
  const setDuck = (patch: Partial<VoiceSettings["ducking"]>) =>
    rt.setVoiceSettings({ ...s, ducking: { ...s.ducking, ...patch } });

  /** Measure 3 s of room noise and put the gate threshold just above it. */
  function calibrate() {
    if (!hasMic || calibrating) return;
    samples.current = [];
    setCalibrating(true);
    setNote("Sessiz kalın… ortam gürültüsü ölçülüyor (3 sn)");
    const off = rt.micFx.subscribe((m) => samples.current.push(m.db));
    setTimeout(() => {
      off();
      setCalibrating(false);
      const v = samples.current.filter((x) => x > -95).sort((a, b) => a - b);
      if (v.length < 5)
        return setNote("Ölçüm için yeterli veri yok. Mikrofon açık mı?");
      const floor = v[Math.floor(v.length * 0.9)]!;
      const gateDb = Math.round(Math.min(-20, Math.max(-75, floor + 8)));
      rt.setVoiceSettings({
        ...s,
        enabled: true,
        gate: true,
        gateDb,
        preset: "custom",
      });
      setNote(
        `Ortam gürültüsü ≈ ${Math.round(floor)} dB, kapı eşiği ${gateDb} dB olarak ayarlandı.`,
      );
    }, 3000);
  }

  const btn = "rounded px-2 py-1 text-xs";
  return (
    <section className={PANEL} aria-label="Ses iyileştirme">
      <PanelTitle
        aside={
          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              className="size-4"
              checked={s.enabled}
              onChange={(e) =>
                rt.setVoiceSettings({
                  ...s,
                  enabled: e.target.checked,
                  preset: s.preset,
                })
              }
              aria-label="Ses iyileştirmeyi aç"
            />
            Açık
          </label>
        }
      >
        Ses iyileştirme
      </PanelTitle>

      {!hasMic && (
        <p className="mb-2 rounded-md bg-secondary px-2 py-1.5 text-[11px] text-muted-foreground">
          Mikrofon kapalı. Kamerayı/mikrofonu açınca ayarlar anında etkinleşir.
        </p>
      )}

      <div
        className="mb-2 flex flex-wrap gap-1"
        role="group"
        aria-label="Hazır ayarlar"
      >
        {PRESETS.map((p) => (
          <button
            key={p.id}
            title={p.hint}
            aria-pressed={s.preset === p.id}
            className={`${btn} ${s.preset === p.id ? "bg-speaker-b text-background" : "bg-secondary hover:bg-accent"}`}
            onClick={() => rt.setVoiceSettings(applyVoicePreset(s, p.id))}
          >
            {p.label}
          </button>
        ))}
        {s.preset === "custom" && (
          <span className="px-1 py-1 text-[11px] text-muted-foreground">
            özel
          </span>
        )}
      </div>

      <div
        className="mb-3 flex items-center gap-2 text-[11px]"
        aria-live="polite"
      >
        <span
          className={`inline-block size-2.5 rounded-full ${!hasMic ? "bg-muted-foreground" : meter.open ? "bg-speaker-b" : "bg-speaker-a"}`}
        />
        <span className="flex-1 text-muted-foreground">
          {!hasMic
            ? "Mikrofon yok"
            : !s.enabled || !s.gate
              ? "Kapı kapalı"
              : meter.open
                ? "Ses algılandı"
                : "Sessiz: gürültü bastırılıyor"}
        </span>
        <span
          className="h-1.5 w-24 overflow-hidden rounded-full bg-secondary"
          aria-hidden
        >
          <span
            className="block h-full bg-speaker-b transition-[width] duration-75"
            style={{
              width: `${(hasMic ? meterFraction(meter.db) : 0) * 100}%`,
            }}
          />
        </span>
      </div>

      <div className="space-y-2">
        <Check
          checked={s.gate}
          onChange={(gate) => set({ gate, enabled: gate || s.enabled })}
        >
          Gürültü kapısı (sessizken arka plan gürültüsünü kıs)
        </Check>
        <Check
          checked={s.ai}
          onChange={(ai) => set({ ai, enabled: ai || s.enabled })}
        >
          Yapay zeka gürültü bastırma (RNNoise · açık kaynak, tarayıcıda yerel
          çalışır)
        </Check>
        {s.ai && (
          <p role="status" className="text-[11px] text-muted-foreground">
            {rt.micFx.aiState === "loading"
              ? "Model yükleniyor…"
              : rt.micFx.aiState === "ready"
                ? "✓ Yapay zeka gürültü bastırma etkin"
                : rt.micFx.aiState === "error"
                  ? `Yüklenemedi: ${rt.micFx.aiError || "tarayıcı AudioWorklet/WebAssembly desteklemiyor olabilir."}`
                  : "Mikrofon açılınca etkinleşir."}
          </p>
        )}
        <Field label={`Kapı eşiği: ${s.gateDb} dB`}>
          <RangeInput
            label="Kapı eşiği"
            min={-75}
            max={-20}
            value={s.gateDb}
            onChange={(gateDb) => set({ gateDb })}
          />
        </Field>
        <Field label={`Gürültü bastırma: ${s.reductionDb} dB`}>
          <RangeInput
            label="Gürültü bastırma"
            min={3}
            max={45}
            value={s.reductionDb}
            onChange={(reductionDb) => set({ reductionDb })}
          />
        </Field>
        <Field
          label={`Ses iyileştirici (EQ + sıkıştırma): %${Math.round(s.enhance)}`}
        >
          <RangeInput
            label="Ses iyileştirici"
            min={0}
            max={100}
            value={s.enhance}
            onChange={(enhance) => set({ enhance })}
          />
        </Field>
        <Field label={`Uğultu / rüzgâr filtresi: ${Math.round(s.hpf)} Hz`}>
          <RangeInput
            label="Uğultu filtresi"
            min={30}
            max={250}
            value={s.hpf}
            onChange={(hpf) => set({ hpf })}
          />
        </Field>
        <Check checked={s.limiter} onChange={(limiter) => set({ limiter })}>
          Limiter (patlamaları engelle)
        </Check>
        <button
          className={`${btn} w-full bg-secondary hover:bg-accent disabled:opacity-40`}
          disabled={!hasMic || calibrating}
          onClick={calibrate}
        >
          {calibrating
            ? "Ölçülüyor…"
            : "🎚 Ortam gürültüsünü ölç ve eşiği ayarla"}
        </button>
        {note && (
          <p className="text-[11px] text-muted-foreground" role="status">
            {note}
          </p>
        )}
      </div>

      <fieldset className="mt-3 space-y-2 rounded-lg border p-2">
        <legend className="px-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Otomatik müzik kısma (ducking)
        </legend>
        <Check
          checked={s.ducking.enabled}
          onChange={(enabled) => setDuck({ enabled })}
        >
          Konuşurken müziği kıs
        </Check>
        <Field label={`Kısma miktarı: ${s.ducking.amountDb} dB`}>
          <RangeInput
            label="Kısma miktarı"
            min={-30}
            max={-3}
            value={s.ducking.amountDb}
            onChange={(amountDb) => setDuck({ amountDb })}
          />
        </Field>
        <Field label={`Konuşma eşiği: ${s.ducking.thresholdDb} dB`}>
          <RangeInput
            label="Konuşma eşiği"
            min={-60}
            max={-15}
            value={s.ducking.thresholdDb}
            onChange={(thresholdDb) => setDuck({ thresholdDb })}
          />
        </Field>
        <Field label={`Geri dönüş süresi: ${s.ducking.releaseMs} ms`}>
          <RangeInput
            label="Geri dönüş süresi"
            min={100}
            max={3000}
            step={50}
            value={s.ducking.releaseMs}
            onChange={(releaseMs) => setDuck({ releaseMs })}
          />
        </Field>
      </fieldset>

      <BroadcastGatewayPanel />

      <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
        Tarayıcının gürültü engelleme, yankı önleme ve otomatik kazanç özelliği
        mikrofon açılırken zaten etkindir; bu panel onun üstüne çalışır.
        Kulaklık kullanmak yankıyı en iyi şekilde önler.
      </p>
    </section>
  );
}
