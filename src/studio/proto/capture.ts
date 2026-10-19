// src/studio/proto/capture.ts
// Screen/tab capture bridge. The prototype's PIXELS enter the compositor only through here.

export type CaptureErrorCode =
  "unsupported" | "denied" | "aborted" | "crop-failed";

export class CaptureError extends Error {
  readonly code: CaptureErrorCode;
  constructor(
    code: CaptureErrorCode,
    message?: string,
    options?: { cause?: unknown },
  ) {
    super(message ?? code, options);
    this.name = "CaptureError";
    this.code = code;
  }
}

export interface CaptureSupport {
  displayMedia: boolean;
  /** Chromium: getDisplayMedia({preferCurrentTab}) */
  preferCurrentTab: boolean;
  /** Chromium 104+: Region Capture (CropTarget) */
  regionCapture: boolean;
}

interface CropTargetStatic {
  fromElement(el: Element): Promise<unknown>;
}
interface CroppableTrack extends MediaStreamTrack {
  cropTo?: (target: unknown) => Promise<void>;
}

export function captureSupport(): CaptureSupport {
  const hasNav = typeof navigator !== "undefined";
  const displayMedia =
    hasNav && typeof navigator.mediaDevices?.getDisplayMedia === "function";
  const g = globalThis as { CropTarget?: CropTargetStatic };
  const regionCapture = typeof g.CropTarget?.fromElement === "function";
  // preferCurrentTab ships together with Region Capture in Chromium
  return {
    displayMedia,
    preferCurrentTab: displayMedia && regionCapture,
    regionCapture,
  };
}

export interface CaptureOptions {
  mode: "current-tab-region" | "pick";
  /** element whose rectangle should be captured (current-tab-region) */
  cropElement?: HTMLElement;
  audio?: boolean;
  frameRate?: number;
}

export interface CaptureHandle {
  stream: MediaStream;
  track: MediaStreamTrack;
  cropped: boolean;
  stop(): void;
}

export async function captureSurface(
  opts: CaptureOptions,
): Promise<CaptureHandle> {
  const sup = captureSupport();
  if (!sup.displayMedia) throw new CaptureError("unsupported");
  const frameRate = opts.frameRate ?? 30;
  const constraints: Record<string, unknown> = {
    video: { frameRate: { ideal: frameRate, max: 60 } },
    audio: opts.audio ?? false,
  };
  if (opts.mode === "current-tab-region" && sup.preferCurrentTab) {
    constraints["preferCurrentTab"] = true;
    constraints["selfBrowserSurface"] = "include";
    constraints["surfaceSwitching"] = "exclude";
  } else {
    constraints["selfBrowserSurface"] = "exclude";
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia(
      constraints as DisplayMediaStreamOptions,
    );
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    throw new CaptureError(
      name === "NotAllowedError" ? "denied" : "aborted",
      undefined,
      { cause: e },
    );
  }
  const track = stream.getVideoTracks()[0] as CroppableTrack | undefined;
  if (!track) {
    stream.getTracks().forEach((t) => t.stop());
    throw new CaptureError("aborted");
  }
  let cropped = false;
  if (
    opts.mode === "current-tab-region" &&
    opts.cropElement &&
    sup.regionCapture &&
    track.cropTo
  ) {
    try {
      const crop = (globalThis as unknown as { CropTarget: CropTargetStatic })
        .CropTarget;
      const target = await crop.fromElement(opts.cropElement);
      await track.cropTo(target);
      cropped = true;
    } catch (e) {
      // Not fatal: fall back to the uncropped surface, but let the caller know via `cropped`.
      void e;
    }
  }
  return {
    stream,
    track,
    cropped,
    stop: () => stream.getTracks().forEach((t) => t.stop()),
  };
}
