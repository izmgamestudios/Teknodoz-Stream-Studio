// src/studio/ui/prototype-panel.tsx
// Embeds the selected web layer's page so the studio tab itself can be captured (cropped to the
// frame with Region Capture). See src/studio/proto/README.md for the technical limits.
import { useEffect, useMemo, useRef, useState } from "react";

import {
  EMBED_HELP,
  attachSameOriginListener,
  captureSupport,
  createPointerSource,
  getRippleField,
  iframeSandbox,
  isMixedContentBlocked,
  likelyBlocksEmbedding,
  normalizePrototypeUrl,
} from "../proto";
import { getActiveScene } from "../project/store";
import { useProject, useSources, useStudio } from "../runtime/use-studio";
import { BTN, Check, PANEL, PanelTitle } from "./fields";

export function PrototypePanel({ selectedId }: { selectedId: string | null }) {
  const rt = useStudio();
  const project = useProject();
  const sources = useSources();
  const scene = getActiveScene(project);
  const layer = scene.layers.find((l) => l.id === selectedId);
  const frameRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [overlay, setOverlay] = useState(false);
  const [sameOrigin, setSameOrigin] = useState(false);

  const web = layer?.kind === "web" ? layer : null;
  const parsed = web && web.url ? normalizePrototypeUrl(web.url) : null;
  const url = parsed?.ok ? parsed.url : "";
  const layerId = web?.id ?? "";
  const rippleOn = web?.ripples ?? false;

  const overlaySrc = useMemo(
    () =>
      layerId
        ? createPointerSource(
            getRippleField(layerId),
            () =>
              frameRef.current?.getBoundingClientRect() ?? {
                left: 0,
                top: 0,
                width: 0,
                height: 0,
              },
          )
        : null,
    [layerId],
  );

  // Ripples from inside a same-origin frame (cross-origin returns null and falls back to overlay).
  useEffect(() => {
    setSameOrigin(false);
    const frame = iframeRef.current;
    if (!frame || !url || !layerId || !rippleOn || overlay) return;
    const src = createPointerSource(getRippleField(layerId), () =>
      frame.getBoundingClientRect(),
    );
    // events inside the frame use the frame's own coordinate space
    const detach = attachSameOriginListener(frame, (e) =>
      src.handle({
        type: e.type,
        pointerType: e.pointerType,
        buttons: e.buttons,
        clientX: e.clientX + frame.getBoundingClientRect().left,
        clientY: e.clientY + frame.getBoundingClientRect().top,
      }),
    );
    setSameOrigin(detach !== null);
    return () => detach?.();
  }, [url, layerId, rippleOn, overlay]);

  if (!web) {
    return (
      <section className={PANEL} aria-label="Prototip">
        <PanelTitle>Prototip yayını</PanelTitle>
        <p className="text-xs text-muted-foreground">
          Bir “Web prototip” katmanı seçin (Katman ekle → Web prototip),
          adresini girin; sayfa burada önizlenir ve yakalanır.
        </p>
      </section>
    );
  }

  const support = captureSupport();
  const live = sources.webCaptures.includes(web.id);
  const mixed =
    parsed?.ok &&
    typeof window !== "undefined" &&
    isMixedContentBlocked(parsed.url, window.location.protocol);
  const blocked = parsed?.ok && likelyBlocksEmbedding(parsed.host);
  const mobile = web.frame === "mobile";

  return (
    <section className={PANEL} aria-label="Prototip">
      <PanelTitle>Prototip yayını</PanelTitle>
      <div className="flex flex-wrap items-center gap-2">
        {live ? (
          <button
            className={BTN}
            onClick={() => rt.sources.stopWebCapture(web.id)}
          >
            ■ Yakalamayı durdur
          </button>
        ) : (
          <>
            <button
              className={BTN}
              disabled={!url || !support.preferCurrentTab}
              title={
                support.preferCurrentTab
                  ? "Bu sekmedeki çerçeve bölgesini yakalar"
                  : "Chrome/Edge gerekir"
              }
              onClick={() =>
                void rt.sources.startWebCapture(
                  web.id,
                  frameRef.current ?? undefined,
                  "current-tab-region",
                )
              }
            >
              🎯 Bu çerçeveyi yakala
            </button>
            <button
              className={BTN}
              onClick={() =>
                void rt.sources.startWebCapture(web.id, undefined, "pick")
              }
            >
              🗂 Başka sekmeyi yakala
            </button>
          </>
        )}
        <Check checked={overlay} onChange={setOverlay}>
          Demo overlay (tıklamayı yakala)
        </Check>
      </div>
      {mixed && (
        <p className="mt-2 text-xs text-destructive">{EMBED_HELP.mixed.tr}</p>
      )}
      {blocked && (
        <p className="mt-2 text-xs text-primary">{EMBED_HELP.blocked.tr}</p>
      )}
      {web.ripples && !overlay && url && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {sameOrigin
            ? "Aynı kaynaklı sayfa: dokunma efektleri otomatik."
            : "Başka kaynaklı sayfalarda tıklamalar görünmez. Efekt için “Demo overlay”i açın (sayfa tıklanamaz)."}
        </p>
      )}

      <div className="mt-3 flex justify-center overflow-auto rounded-lg bg-background p-2">
        <div
          ref={frameRef}
          className={`relative overflow-hidden bg-white ${mobile ? "h-[520px] aspect-[390/844]" : "aspect-video w-full max-w-3xl"}`}
        >
          {url ? (
            <iframe
              ref={iframeRef}
              src={url}
              title="Prototip önizleme"
              sandbox={iframeSandbox(false)}
              referrerPolicy="no-referrer"
              className="absolute inset-0 h-full w-full border-0"
            />
          ) : (
            <div className="flex h-full items-center justify-center p-4 text-center text-xs text-neutral-500">
              Özelliklerden bir prototip adresi girin.
            </div>
          )}
          {overlay && (
            <div
              className="absolute inset-0 z-10 cursor-pointer touch-none"
              onPointerDown={(e) => overlaySrc?.handle(e.nativeEvent)}
              onPointerMove={(e) => overlaySrc?.handle(e.nativeEvent)}
            />
          )}
        </div>
      </div>
    </section>
  );
}
