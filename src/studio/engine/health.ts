// src/studio/engine/health.ts
// Turns raw engine numbers (fps, frame time, dropped frames, audio peak...) into plain-language
// advice. Pure: the panel polls the runtime and feeds the numbers in.

export type HealthLevel = "ok" | "warn" | "bad";

export interface HealthInput {
  fps: number;
  targetFps: number;
  frameMs: number;
  /** frames dropped since the previous sample */
  droppedDelta: number;
  /** master output peak, dBFS (-100 = silence) */
  masterPeakDb: number;
  micPresent: boolean;
  micMuted: boolean;
  recording: boolean;
  width: number;
  height: number;
  /** document.hidden: background tabs are throttled by the browser */
  tabHidden: boolean;
  /** 0..1 of the storage quota, undefined when unknown */
  storageUsed?: number;
  /** false when WebGL (transitions) is not available */
  webgl?: boolean;
}

export interface HealthIssue {
  id: string;
  level: Exclude<HealthLevel, "ok">;
  text: string;
}

export interface HealthReport {
  level: HealthLevel;
  issues: HealthIssue[];
}

export function assessHealth(i: HealthInput): HealthReport {
  const issues: HealthIssue[] = [];
  const add = (id: string, level: HealthIssue["level"], text: string) =>
    issues.push({ id, level, text });
  const target = i.targetFps > 0 ? i.targetFps : 30;

  if (i.tabHidden && i.recording)
    add(
      "hidden",
      "bad",
      "Sekme arka planda: tarayıcı çizimi yavaşlatır ve kayıt takılabilir. Stüdyo sekmesini açık tut.",
    );

  if (i.fps > 0) {
    const ratio = i.fps / target;
    if (ratio < 0.6)
      add(
        "fps-low",
        "bad",
        `Kare hızı çok düşük (${Math.round(i.fps)}/${target} fps). Çıkış FPS'ini düşür, Full HD'yi kapat ya da ağır efektleri azalt.`,
      );
    else if (ratio < 0.85)
      add(
        "fps-low",
        "warn",
        `Kare hızı hedefin altında (${Math.round(i.fps)}/${target} fps). Çözünürlüğü ya da FPS'i düşürmeyi dene.`,
      );
  }

  if (i.frameMs > (1000 / target) * 0.9)
    add(
      "frame-slow",
      "warn",
      `Kare çizimi yavaş (${i.frameMs.toFixed(1)} ms). Netlik/vinyet efektleri, yeşil perde ve çok katman işlemciyi yorar.`,
    );

  if (i.droppedDelta >= 5)
    add("dropped", "warn", `Son saniyede ${i.droppedDelta} kare atlandı.`);

  if (i.masterPeakDb > -0.5)
    add(
      "clip",
      "bad",
      "Ses kırpılıyor (bozulma). Mikrofon veya müzik seviyesini düşür, Limiter'i aç.",
    );
  else if (i.masterPeakDb > -3)
    add("loud", "warn", "Ses sınıra yakın. Seviyeleri biraz kıs.");

  if (i.recording && !i.micPresent)
    add("no-mic", "warn", "Kayıt sürüyor ama mikrofon kaynağı yok.");
  else if (i.recording && i.micMuted)
    add(
      "mic-muted",
      "warn",
      "Mikrofon sessize alınmış, kayıtta konuşman duyulmaz.",
    );

  if (i.width * i.height >= 2560 * 1440 && i.targetFps >= 60)
    add(
      "heavy",
      "warn",
      "Yüksek çözünürlük + 60 fps çok ağırdır. Takılma olursa 1080p30'a düş.",
    );

  if (i.storageUsed !== undefined && i.storageUsed > 0.9)
    add(
      "storage",
      "warn",
      `Tarayıcı depolaması %${Math.round(i.storageUsed * 100)} dolu. Kullanılmayan medyayı sil.`,
    );

  if (i.webgl === false)
    add("webgl", "warn", "WebGL yok: geçişler yumuşak geçişe (fade) düşer.");

  const level: HealthLevel = issues.some((x) => x.level === "bad")
    ? "bad"
    : issues.length
      ? "warn"
      : "ok";
  return { level, issues };
}

export const HEALTH_LABEL: Record<HealthLevel, string> = {
  ok: "Her şey yolunda",
  warn: "Dikkat",
  bad: "Sorun var",
};
