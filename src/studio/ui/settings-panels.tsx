// src/studio/ui/settings-panels.tsx
// Settings screen sections: output, connection (STUN + relay), shortcuts, language.
import { useEffect, useMemo, useState } from "react";

import { defaultSettings } from "../defaults";
import { LANGS, type MessageKey } from "../i18n/messages";
import { useT } from "../i18n/use-t";
import { useTheme } from "../theme";
import { loadIceText, parseIceLines, saveIceText } from "../p2p/ice-config";
import { createRoomApi } from "../room/api";
import {
  useProject,
  useRuntimeSnapshot,
  useStudio,
} from "../runtime/use-studio";
import { OUTPUT_LIMITS } from "../storage/settings-schema";
import {
  SHORTCUT_ACTIONS,
  eventToCombo,
  findConflicts,
  isValidCombo,
} from "../storage/shortcuts";
import type { AppSettings, OutputSettings, ShortcutAction } from "../types";
import {
  BTN,
  BTN_ACCENT,
  Check,
  Field,
  INPUT,
  NumInput,
  PANEL,
  PanelTitle,
  RangeInput,
  SelectInput,
} from "./fields";

const PRESETS = [
  { w: 1280, h: 720 },
  { w: 1920, h: 1080 },
  { w: 2560, h: 1440 },
  { w: 3840, h: 2160 },
  // vertical / square (Reels, Shorts, TikTok, Instagram)
  { w: 720, h: 1280 },
  { w: 1080, h: 1920 },
  { w: 1080, h: 1350 },
  { w: 1080, h: 1080 },
  { w: 1440, h: 1080 },
] as const;
const FPS = [24, 30, 60] as const;
const AUDIO_KBPS = [96, 128, 160, 192, 256, 320] as const;

function useSettings() {
  const rt = useStudio();
  const project = useProject();
  return {
    rt,
    settings: project.settings,
    update: (patch: Partial<AppSettings>) => rt.project.updateSettings(patch),
  };
}

/* ------------------------------------------------------------------ */

export function OutputSection() {
  const t = useT();
  const { rt, settings, update } = useSettings();
  const snap = useRuntimeSnapshot();
  const [custom, setCustom] = useState(false);
  const o = settings.output;
  const recording =
    snap.recorder?.status === "recording" ||
    snap.recorder?.status === "paused" ||
    snap.recorder?.status === "stopping";
  const set = (patch: Partial<OutputSettings>) =>
    update({ output: { ...o, ...patch } });

  const preset = PRESETS.find((p) => p.w === o.width && p.h === o.height);
  const presetValue = custom || !preset ? "custom" : `${preset.w}x${preset.h}`;
  const mbPerMin = Math.round(
    ((o.videoBitrate + o.audioBitrate) * 60) / 8 / 1_000_000,
  );
  const heavy = o.width * o.height >= 2560 * 1440 && o.fps >= 60;
  const even = (n: number) => Math.round(n / 2) * 2;

  return (
    <section className={PANEL} aria-label={t("settings.output")}>
      <PanelTitle>{t("settings.output")}</PanelTitle>
      {recording && (
        <p role="status" className="mb-3 text-xs text-primary">
          {t("settings.output.locked")}
        </p>
      )}
      <fieldset disabled={recording} className="grid gap-3 sm:grid-cols-2">
        <Field label={t("settings.output.resolution")}>
          <select
            className={INPUT}
            value={presetValue}
            onChange={(e) => {
              if (e.target.value === "custom") {
                setCustom(true);
                return;
              }
              setCustom(false);
              const [w, h] = e.target.value.split("x").map(Number);
              if (w && h) rt.setOutputFormat(w, h);
            }}
          >
            {PRESETS.map((p) => (
              <option key={`${p.w}x${p.h}`} value={`${p.w}x${p.h}`}>
                {p.w === p.h
                  ? "Kare"
                  : p.h > p.w
                    ? "Dikey"
                    : p.h === 1080 && p.w === 1440
                      ? "4:3"
                      : `${p.h}p`}{" "}
                ({p.w}×{p.h})
              </option>
            ))}
            <option value="custom">
              {t("settings.output.resolution.custom")}
            </option>
          </select>
        </Field>
        <Field label={t("settings.output.fps")}>
          <SelectInput
            value={String(
              FPS.includes(o.fps as (typeof FPS)[number]) ? o.fps : 60,
            )}
            options={FPS.map((f) => ({ value: String(f), label: `${f} fps` }))}
            onChange={(v) => set({ fps: Number(v) })}
          />
        </Field>
        {presetValue === "custom" && (
          <>
            <Field label="W">
              <NumInput
                value={o.width}
                min={OUTPUT_LIMITS.width.min}
                max={OUTPUT_LIMITS.width.max}
                step={2}
                onChange={(w) => set({ width: even(w) })}
              />
            </Field>
            <Field label="H">
              <NumInput
                value={o.height}
                min={OUTPUT_LIMITS.height.min}
                max={OUTPUT_LIMITS.height.max}
                step={2}
                onChange={(h) => set({ height: even(h) })}
              />
            </Field>
          </>
        )}
        <Field
          label={t("settings.output.videoBitrate", {
            n: (o.videoBitrate / 1_000_000).toFixed(0),
          })}
        >
          <RangeInput
            label={t("settings.output.videoBitrate", { n: "" })}
            min={2}
            max={40}
            value={Math.round(o.videoBitrate / 1_000_000)}
            onChange={(mb) => set({ videoBitrate: mb * 1_000_000 })}
          />
        </Field>
        <Field label={t("settings.output.audioBitrate")}>
          <SelectInput
            value={String(Math.round(o.audioBitrate / 1000))}
            options={AUDIO_KBPS.map((k) => ({
              value: String(k),
              label: `${k} kbps`,
            }))}
            onChange={(v) => set({ audioBitrate: Number(v) * 1000 })}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label={t("settings.output.container")}>
            <SelectInput
              value={o.container}
              options={[
                { value: "auto", label: t("settings.output.container.auto") },
                { value: "mp4", label: "MP4" },
                { value: "webm", label: "WebM" },
              ]}
              onChange={(container) => set({ container })}
            />
          </Field>
        </div>
      </fieldset>
      <p className="mt-3 text-xs text-muted-foreground">
        {t("settings.output.estimate", { mb: mbPerMin })}
      </p>
      {heavy && (
        <p className="mt-1 text-xs text-primary">
          {t("settings.output.heavy")}
        </p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */

export function ConnectionSection() {
  const t = useT();
  const { rt, settings, update } = useSettings();
  const [relay, setRelay] = useState<"idle" | "checking" | "ok" | "fail">(
    "idle",
  );
  const o = settings.output;
  const peers = rt.getPeersSnapshot().length;
  const [iceText, setIceText] = useState(loadIceText);
  const ice = parseIceLines(iceText);

  return (
    <section className={PANEL} aria-label={t("settings.connection")}>
      <PanelTitle>{t("settings.connection")}</PanelTitle>
      <Check
        checked={o.usePublicStun}
        onChange={(usePublicStun) =>
          update({ output: { ...o, usePublicStun } })
        }
      >
        <b>{t("settings.stun")}</b>
      </Check>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("settings.stun.body")}
      </p>
      {peers > 0 && (
        <p className="mt-1 text-xs text-primary">{t("settings.stun.busy")}</p>
      )}

      <div className="mt-3">
        <label className="text-sm font-semibold" htmlFor="ice-servers">
          {t("settings.ice")}
        </label>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("settings.ice.body")}
        </p>
        <textarea
          id="ice-servers"
          rows={3}
          spellCheck={false}
          autoComplete="off"
          placeholder="turn:turn.example.org:3478 | user | password"
          className="mt-2 w-full rounded-md border bg-background p-2 font-mono text-xs"
          value={iceText}
          onChange={(e) => {
            setIceText(e.target.value);
            saveIceText(e.target.value);
          }}
        />
        {iceText.trim() !== "" && (
          <p
            className={`mt-1 text-xs ${ice.invalid.length > 0 ? "text-destructive" : "text-muted-foreground"}`}
          >
            {t("settings.ice.valid", { n: ice.servers.length })}
            {ice.invalid.length > 0 &&
              ` · ${t("settings.ice.invalid", { lines: ice.invalid.join(", ") })}`}
          </p>
        )}
      </div>

      <div className="mt-4 border-t pt-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          {t("settings.relay")}
        </h3>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            className={BTN}
            disabled={relay === "checking"}
            onClick={async () => {
              setRelay("checking");
              setRelay((await createRoomApi().health()) ? "ok" : "fail");
            }}
          >
            {t("settings.relay.check")}
          </button>
          {relay === "ok" && (
            <span className="text-xs text-speaker-b">
              {t("settings.relay.ok")}
            </span>
          )}
          {relay === "fail" && (
            <span role="alert" className="text-xs text-destructive">
              {t("settings.relay.fail")}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function prettyCombo(c: string): string {
  return c === ""
    ? "—"
    : c
        .replace("ArrowUp", "↑")
        .replace("ArrowDown", "↓")
        .replace("ArrowLeft", "←")
        .replace("ArrowRight", "→");
}

export function ShortcutsSection() {
  const t = useT();
  const { settings, update } = useSettings();
  const [capturing, setCapturing] = useState<ShortcutAction | null>(null);
  const map = settings.shortcuts;
  const conflicts = useMemo(() => findConflicts(map), [map]);

  useEffect(() => {
    if (!capturing) return;
    const down = (e: KeyboardEvent) => {
      // pure modifier presses are not a binding yet
      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setCapturing(null);
        return;
      }
      const combo = eventToCombo(e);
      if (combo && isValidCombo(combo)) {
        update({ shortcuts: { ...map, [capturing]: combo } });
      }
      setCapturing(null);
    };
    window.addEventListener("keydown", down, true);
    return () => window.removeEventListener("keydown", down, true);
  }, [capturing, map, update]);

  return (
    <section className={PANEL} aria-label={t("settings.shortcuts")}>
      <PanelTitle
        aside={
          <button
            className={BTN}
            onClick={() => update({ shortcuts: defaultSettings().shortcuts })}
          >
            {t("settings.shortcuts.reset")}
          </button>
        }
      >
        {t("settings.shortcuts")}
      </PanelTitle>
      <p className="mb-3 text-xs text-muted-foreground">
        {t("settings.shortcuts.body")}
      </p>
      <ul className="divide-y">
        {SHORTCUT_ACTIONS.map((a) => {
          const conflicted = conflicts.some((c) => c.ids.includes(a));
          return (
            <li
              key={a}
              className="flex items-center justify-between gap-3 py-2 text-sm"
            >
              <span>{t(`action.${a}` as MessageKey)}</span>
              <span className="flex items-center gap-2">
                <kbd
                  className={`min-w-14 rounded border px-2 py-1 text-center font-mono text-xs ${conflicted ? "border-destructive text-destructive" : ""}`}
                >
                  {capturing === a
                    ? t("settings.shortcuts.press")
                    : prettyCombo(map[a])}
                </kbd>
                <button
                  className={capturing === a ? BTN_ACCENT : BTN}
                  onClick={() => setCapturing(capturing === a ? null : a)}
                >
                  {t("settings.shortcuts.change")}
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      {conflicts.map((c) => (
        <p key={c.combo} role="alert" className="mt-2 text-xs text-destructive">
          {t("settings.shortcuts.conflict", {
            a: t(`action.${c.ids[0]}` as MessageKey),
            b: t(`action.${c.ids[1]}` as MessageKey),
            combo: prettyCombo(c.combo),
          })}
        </p>
      ))}
    </section>
  );
}

/* ------------------------------------------------------------------ */

export function ThemeSelect() {
  const t = useT();
  const [theme, setTheme] = useTheme();
  return (
    <SelectInput
      label={t("settings.theme")}
      value={theme}
      options={[
        { value: "system", label: t("settings.theme.system") },
        { value: "light", label: t("settings.theme.light") },
        { value: "dark", label: t("settings.theme.dark") },
      ]}
      onChange={setTheme}
    />
  );
}

export function LanguageSection() {
  const t = useT();
  const { rt, settings, update } = useSettings();
  return (
    <section className={PANEL} aria-label={t("settings.lang")}>
      <PanelTitle>{t("settings.lang")}</PanelTitle>
      <div className="max-w-xs">
        <SelectInput
          label={t("settings.lang")}
          value={settings.lang}
          options={LANGS.map((l) => ({ value: l.id, label: l.label }))}
          onChange={(lang) => update({ lang })}
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {t("settings.lang.body")}
      </p>
      <div className="mt-4 max-w-xs">
        <ThemeSelect />
      </div>
      <div className="mt-4 border-t pt-3">
        <button
          className={BTN}
          onClick={() => {
            if (window.confirm(t("settings.reset.confirm")))
              rt.project.updateSettings(defaultSettings());
          }}
        >
          {t("settings.reset.all")}
        </button>
      </div>
    </section>
  );
}
