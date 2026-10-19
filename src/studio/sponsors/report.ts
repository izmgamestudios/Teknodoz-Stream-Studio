// src/studio/sponsors/report.ts
// CSV report of sponsor screen time, meant to be attached to the sponsor's invoice or recap mail.
import { csvCell } from "../room/log";
import type { Sponsor } from "../types";
import { KIND_LABEL } from "./draw";
import type { ExposureData } from "./exposure";

const TIER_LABEL = {
  title: "Ana sponsor",
  gold: "Altın",
  silver: "Gümüş",
  supporter: "Destekçi",
} as const;

const secs = (ms: number | undefined) => Math.round((ms ?? 0) / 1000);

export function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function sponsorReportCsv(
  sponsors: readonly Sponsor[],
  data: ExposureData,
): string {
  const started = data.sessionStartedAt
    ? new Date(data.sessionStartedAt).toISOString()
    : "";
  const head = [
    "Sponsor",
    "Tür",
    "Seviye",
    "Yayında ekranda kalma (sn)",
    "Yayında ekranda kalma (süre)",
    "Tüm yayınlar (sn)",
    "Tüm yayınlar (süre)",
    "Web sitesi",
    "Son yayın başlangıcı (UTC)",
  ];
  const rows = sponsors.map((s) => {
    const sess = secs(data.sessionMs[s.id]);
    const total = secs(data.totalMs[s.id]);
    return [
      s.name,
      KIND_LABEL[s.kind],
      TIER_LABEL[s.tier],
      String(sess),
      fmtDuration(sess),
      String(total),
      fmtDuration(total),
      s.url,
      started,
    ];
  });
  // UTF-8 BOM so spreadsheet apps open Turkish characters correctly
  return (
    "\ufeff" +
    [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") +
    "\r\n"
  );
}
