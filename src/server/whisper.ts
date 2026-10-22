// src/server/whisper.ts
// Automatic subtitles with open-source Whisper speech recognition, run as a local CLI (nothing is
// sent to a cloud service). Supported backends:
//   whisper-cpp          github.com/ggml-org/whisper.cpp       (C++, light, recommended on small servers)
//   whisper-ctranslate2  github.com/Softcatala/whisper-ctranslate2 (faster-whisper, pip)
//   whisper              github.com/openai/whisper             (reference implementation, pip)
//
//   WHISPER_BACKEND=whisper-cpp
//   WHISPER_BIN=/home/user/whisper.cpp/build/bin/whisper-cli   (default: the backend's usual name)
//   WHISPER_MODEL=/home/user/whisper.cpp/models/ggml-small.bin (cpp: model file; others: name, default "small")
//   WHISPER_THREADS=2   WHISPER_TIMEOUT_MIN=180
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type WhisperBackend = "whisper-cpp" | "whisper-ctranslate2" | "whisper";

export interface WhisperConfig {
  backend: WhisperBackend;
  bin: string;
  model: string;
  threads: number;
  timeoutMs: number;
}

const BACKENDS: readonly WhisperBackend[] = [
  "whisper-cpp",
  "whisper-ctranslate2",
  "whisper",
];

const DEFAULT_BIN: Record<WhisperBackend, string> = {
  "whisper-cpp": "whisper-cli",
  "whisper-ctranslate2": "whisper-ctranslate2",
  whisper: "whisper",
};

export function whisperFromEnv(
  env: Record<string, string | undefined>,
): WhisperConfig | null {
  const backend = (env["WHISPER_BACKEND"] ?? "").trim() as WhisperBackend;
  if (!BACKENDS.includes(backend)) return null;
  const model = (env["WHISPER_MODEL"] ?? "").trim();
  if (backend === "whisper-cpp" && model === "") return null;
  const threads = Math.min(
    32,
    Math.max(1, Number(env["WHISPER_THREADS"]) || 2),
  );
  const minutes = Math.min(
    720,
    Math.max(1, Number(env["WHISPER_TIMEOUT_MIN"]) || 180),
  );
  return {
    backend,
    bin: (env["WHISPER_BIN"] ?? "").trim() || DEFAULT_BIN[backend],
    model: model || "small",
    threads,
    timeoutMs: minutes * 60_000,
  };
}

export interface WhisperCommand {
  args: string[];
  /** where the CLI writes the WebVTT file */
  outFile: string;
}

/** Pure: the argument list for one transcription (no shell involved anywhere). */
export function whisperCommand(
  cfg: WhisperConfig,
  wav: string,
  outDir: string,
  lang: string,
): WhisperCommand {
  const base = wav.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
  const language = /^[a-z]{2,3}$/.test(lang) ? lang : "auto";
  if (cfg.backend === "whisper-cpp") {
    const outBase = join(outDir, base);
    return {
      args: [
        "-m",
        cfg.model,
        "-f",
        wav,
        "-l",
        language,
        "-t",
        String(cfg.threads),
        "-ovtt",
        "-of",
        outBase,
        "-pp",
      ],
      outFile: `${outBase}.vtt`,
    };
  }
  const common = [
    wav,
    "--model",
    cfg.model,
    "--output_format",
    "vtt",
    "--output_dir",
    outDir,
    ...(language !== "auto" ? ["--language", language] : []),
  ];
  return {
    args:
      cfg.backend === "whisper-ctranslate2"
        ? [
            ...common,
            "--threads",
            String(cfg.threads),
            "--compute_type",
            "int8",
            "--verbose",
            "False",
          ]
        : [...common, "--fp16", "False", "--verbose", "False"],
    outFile: join(outDir, `${base}.vtt`),
  };
}

/** Is the configured CLI runnable? (`--help` exits quickly on all three.) */
export function whisperAvailable(cfg: WhisperConfig): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(cfg.bin, ["--help"], { timeout: 15_000 }, (err) => {
      resolve(!err || (err as NodeJS.ErrnoException).code !== "ENOENT");
    });
  });
}

/**
 * Runs the CLI on a 16 kHz mono WAV and returns the WebVTT text it wrote. `onProgress` gets 0..1
 * whenever the CLI prints a percentage.
 */
export async function runWhisper(
  cfg: WhisperConfig,
  wav: string,
  lang: string,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  const outDir = await mkdtemp(join(tmpdir(), "whisper-"));
  try {
    const cmd = whisperCommand(cfg, wav, outDir, lang);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(cfg.bin, cmd.args, {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let tail = "";
      const feed = (chunk: Buffer) => {
        const s = chunk.toString();
        tail = (tail + s).slice(-2000);
        const m = [...s.matchAll(/(\d{1,3})\s?%/g)].pop();
        if (m) onProgress?.(Math.min(1, Number(m[1]) / 100));
      };
      child.stdout.on("data", feed);
      child.stderr.on("data", feed);
      const timer = setTimeout(() => child.kill("SIGKILL"), cfg.timeoutMs);
      signal?.addEventListener("abort", () => child.kill("SIGKILL"));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (signal?.aborted) return reject(new Error("cancelled"));
        if (code === 0) resolve();
        else
          reject(new Error(`whisper exited with ${code}: ${tail.slice(-300)}`));
      });
    });
    return await readFile(cmd.outFile, "utf8");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}
