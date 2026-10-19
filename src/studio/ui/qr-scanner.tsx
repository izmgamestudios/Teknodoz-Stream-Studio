// src/studio/ui/qr-scanner.tsx
// Scans a QR code with the camera using the platform BarcodeDetector API (no dependency).
// Supported in Chromium on Android/macOS/ChromeOS; NOT in Firefox, Safari or Chrome on
// Windows/Linux. Callers must handle `isQrScanSupported() === false` (paste instead).
import { useEffect, useRef, useState } from "react";

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (opts?: {
  formats?: string[];
}) => BarcodeDetectorLike;

function detectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === "undefined") return null;
  const c = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
    .BarcodeDetector;
  return typeof c === "function" ? c : null;
}

export function isQrScanSupported(): boolean {
  return (
    detectorCtor() !== null &&
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

export function QrScanner({
  onResult,
  onClose,
  labels,
}: {
  onResult: (text: string) => void;
  onClose: () => void;
  labels: {
    title: string;
    hint: string;
    close: string;
    denied: string;
    unsupported: string;
  };
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const Ctor = detectorCtor();
    if (!Ctor) {
      setError(labels.unsupported);
      return;
    }
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let done = false;
    let busy = false;

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
          },
          audio: false,
        });
        if (done) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        await v.play().catch(() => undefined);
        const detector = new Ctor({ formats: ["qr_code"] });
        timer = setInterval(async () => {
          if (busy || done || v.readyState < 2) return;
          busy = true;
          try {
            const codes = await detector.detect(v);
            const raw = codes[0]?.rawValue;
            if (raw && !done) {
              done = true;
              onResult(raw);
            }
          } catch {
            // a frame that cannot be decoded is not an error
          } finally {
            busy = false;
          }
        }, 150);
      } catch {
        setError(labels.denied);
      }
    })();

    return () => {
      done = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // callbacks/labels are stable enough for one scan session
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="space-y-2 rounded-lg border p-2"
      role="dialog"
      aria-label={labels.title}
    >
      <div className="flex items-center justify-between text-xs">
        <b>{labels.title}</b>
        <button
          className="text-muted-foreground hover:text-foreground"
          onClick={onClose}
        >
          {labels.close}
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : (
        <>
          <video
            ref={videoRef}
            muted
            playsInline
            className="aspect-video w-full rounded-md bg-black object-cover"
          />
          <p className="text-[11px] text-muted-foreground">{labels.hint}</p>
        </>
      )}
    </div>
  );
}
