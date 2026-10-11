// src/studio/ui/qr-image.tsx
// Renders text as a QR code (own encoder, no dependency). Shown via an <img> data URL, never
// innerHTML. Falls back to a message when the payload is too long for a QR code.
import { useMemo } from "react";

import { encodeQr } from "../p2p/qr";
import { qrToDataUrl } from "../p2p/qr-render";

export function QrImage({ text, size = 220 }: { text: string; size?: number }) {
  const result = useMemo(() => {
    try {
      return { src: qrToDataUrl(encodeQr(text, { ecc: "L" }), { margin: 2 }) };
    } catch {
      return { src: null };
    }
  }, [text]);

  if (!result.src) {
    return (
      <p className="text-xs text-muted-foreground">
        Bu kod QR için çok uzun. Bağlantıyı kopyalayıp gönderin.
      </p>
    );
  }
  return (
    <img
      src={result.src}
      width={size}
      height={size}
      alt="Bağlantı QR kodu"
      className="rounded-md bg-white p-1"
      style={{ imageRendering: "pixelated" }}
    />
  );
}
