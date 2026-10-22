// src/studio/ui/watch/cue-editor.tsx
// Detailed subtitle editor: one row per cue with exact start / end times, text, split / merge,
// shift-all, find & replace, reading-speed checks and live highlight of the cue on screen.
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { useT } from "../../i18n/use-t";
import {
  activeCue,
  addCue,
  checkCues,
  mergeWithNext,
  parseCues,
  replaceInCues,
  serializeCues,
  shiftCues,
  splitCue,
  type Cue,
  type CueIssue,
} from "../../watch/cues";
import { formatClock, parseClock } from "../../watch/timecode";
import { BTN, BTN_ACCENT, INPUT, INPUT_AUTO } from "../fields";

/** Text field that commits on blur / Enter, so half-typed times never reach the cue. */
function TimeInput({
  value,
  label,
  onCommit,
}: {
  value: number;
  label: string;
  onCommit: (ms: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? formatClock(value, true);
  const commit = () => {
    if (draft !== null) {
      const ms = parseClock(draft);
      if (ms !== null) onCommit(ms);
      setDraft(null);
    }
  };
  return (
    <input
      className={`${INPUT_AUTO} w-28 font-mono`}
      aria-label={label}
      value={shown}
      inputMode="decimal"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setDraft(null);
      }}
    />
  );
}

const ISSUE_KEY: Record<CueIssue, `cue.issue.${string}`> = {
  overlap: "cue.issue.overlap",
  "too-short": "cue.issue.short",
  "too-long": "cue.issue.long",
  "reading-speed": "cue.issue.speed",
  "line-length": "cue.issue.line",
  empty: "cue.issue.empty",
  reversed: "cue.issue.reversed",
};

export function CueEditor({
  initial,
  lang,
  mediaRef,
  onSave,
  onCancel,
}: {
  initial: string;
  lang: string;
  mediaRef: RefObject<HTMLMediaElement | null> | undefined;
  onSave: (vtt: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [cues, setCues] = useState<Cue[]>(() => parseCues(initial));
  const [raw, setRaw] = useState<string | null>(null);
  const [find, setFind] = useState("");
  const [repl, setRepl] = useState("");
  const [shift, setShift] = useState("0.5");
  const [info, setInfo] = useState<string | null>(null);
  const [ms, setMs] = useState(0);
  const rows = useRef(new Map<number, HTMLLIElement>());

  useEffect(() => {
    const m = mediaRef?.current;
    if (!m) return;
    const upd = () => setMs(Math.round(m.currentTime * 1000));
    upd();
    m.addEventListener("timeupdate", upd);
    m.addEventListener("seeked", upd);
    return () => {
      m.removeEventListener("timeupdate", upd);
      m.removeEventListener("seeked", upd);
    };
  }, [mediaRef]);

  const sorted = useMemo(
    () => [...cues].sort((a, b) => a.startMs - b.startMs),
    [cues],
  );
  const issues = useMemo(() => checkCues(sorted), [sorted]);
  const active = activeCue(sorted, ms);
  const activeId = sorted[active]?.id;

  useEffect(() => {
    if (activeId !== undefined)
      rows.current.get(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  const now = () => Math.round((mediaRef?.current?.currentTime ?? 0) * 1000);
  const seek = (v: number) => {
    const m = mediaRef?.current;
    if (m) m.currentTime = Math.max(0, v) / 1000;
  };
  const patch = (id: number, p: Partial<Cue>) =>
    setCues((cs) => cs.map((c) => (c.id === id ? { ...c, ...p } : c)));
  const problems = [...issues.values()].reduce((n, l) => n + l.length, 0);

  if (raw !== null)
    return (
      <div className="space-y-2">
        <textarea
          className={`${INPUT} font-mono`}
          rows={14}
          spellCheck
          aria-label={t("sub.editor")}
          lang={lang}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
        />
        <div className="flex gap-2">
          <button
            className={BTN_ACCENT}
            onClick={() => {
              setCues(parseCues(raw));
              setRaw(null);
            }}
          >
            {t("cue.backToList")}
          </button>
          <button className={BTN} onClick={() => onSave(raw)}>
            {t("catalog.save")}
          </button>
        </div>
      </div>
    );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button className={BTN} onClick={() => setCues(addCue(cues, now()))}>
          ＋ {t("cue.add")}
        </button>
        <span className="mx-1 h-4 border-l" aria-hidden />
        <input
          className={`${INPUT_AUTO} w-16 font-mono`}
          value={shift}
          aria-label={t("cue.shiftBy")}
          onChange={(e) => setShift(e.target.value)}
        />
        <span>s</span>
        {([-1, 1] as const).map((dir) => (
          <button
            key={dir}
            className={BTN}
            title={t("cue.shiftAll")}
            onClick={() => {
              const v = Number(shift.replace(",", "."));
              if (Number.isFinite(v) && v !== 0)
                setCues(shiftCues(cues, dir * Math.round(v * 1000)));
            }}
          >
            {dir < 0 ? "⏪ −" : "+ ⏩"}
          </button>
        ))}
        <span className="mx-1 h-4 border-l" aria-hidden />
        <input
          className={`${INPUT_AUTO} w-28`}
          placeholder={t("cue.find")}
          aria-label={t("cue.find")}
          value={find}
          onChange={(e) => setFind(e.target.value)}
        />
        <input
          className={`${INPUT_AUTO} w-28`}
          placeholder={t("cue.replace")}
          aria-label={t("cue.replace")}
          value={repl}
          onChange={(e) => setRepl(e.target.value)}
        />
        <button
          className={BTN}
          disabled={!find}
          onClick={() => {
            const r = replaceInCues(cues, find, repl);
            setCues(r.cues);
            setInfo(t("cue.replaced", { n: String(r.count) }));
          }}
        >
          {t("cue.replaceAll")}
        </button>
        <button
          className={`${BTN} ml-auto`}
          onClick={() => setRaw(serializeCues(cues))}
        >
          {t("cue.raw")}
        </button>
      </div>
      <p className="text-muted-foreground" role="status">
        {t("cue.count", { n: String(cues.length), p: String(problems) })}
        {info && ` · ${info}`}
      </p>

      <ol className="max-h-[28rem] space-y-1.5 overflow-y-auto pr-1">
        {sorted.map((c, i) => {
          const list = issues.get(c.id) ?? [];
          const isActive = c.id === activeId;
          return (
            <li
              key={c.id}
              ref={(el) => {
                if (el) rows.current.set(c.id, el);
                else rows.current.delete(c.id);
              }}
              className={`space-y-1 rounded-md border p-2 ${isActive ? "border-primary bg-primary/10" : ""}`}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  className={BTN}
                  title={t("cue.jump")}
                  onClick={() => seek(c.startMs)}
                >
                  {i + 1} ▶
                </button>
                <TimeInput
                  label={t("edit.start")}
                  value={c.startMs}
                  onCommit={(v) => patch(c.id, { startMs: v })}
                />
                <button
                  className={BTN}
                  title={t("edit.setNow")}
                  onClick={() => patch(c.id, { startMs: now() })}
                >
                  ⏱
                </button>
                <span aria-hidden>→</span>
                <TimeInput
                  label={t("edit.end")}
                  value={c.endMs}
                  onCommit={(v) => patch(c.id, { endMs: v })}
                />
                <button
                  className={BTN}
                  title={t("edit.setNow")}
                  onClick={() => patch(c.id, { endMs: now() })}
                >
                  ⏱
                </button>
                <button
                  className={BTN}
                  title={t("cue.split")}
                  onClick={() => setCues(splitCue(cues, c.id, now()))}
                >
                  ✂
                </button>
                <button
                  className={BTN}
                  title={t("cue.merge")}
                  disabled={i === sorted.length - 1}
                  onClick={() => setCues(mergeWithNext(cues, c.id))}
                >
                  ⤵
                </button>
                <button
                  className={BTN}
                  aria-label={t("edit.clips.remove")}
                  onClick={() => setCues(cues.filter((x) => x.id !== c.id))}
                >
                  🗑
                </button>
              </div>
              <textarea
                className={INPUT}
                rows={Math.max(2, c.text.split("\n").length)}
                lang={lang}
                spellCheck
                aria-label={`${t("cue.text")} ${i + 1}`}
                value={c.text}
                onChange={(e) => patch(c.id, { text: e.target.value })}
              />
              {list.length > 0 && (
                <p className="text-[11px] text-destructive">
                  ⚠{" "}
                  {list
                    .map((k) => t(ISSUE_KEY[k] as "cue.issue.overlap"))
                    .join(" · ")}
                </p>
              )}
            </li>
          );
        })}
      </ol>

      <div className="flex gap-2">
        <button
          className={BTN_ACCENT}
          onClick={() => onSave(serializeCues(cues))}
        >
          {t("catalog.save")}
        </button>
        <button className={BTN} onClick={onCancel}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}
