# proto — prototype broadcast helpers

Pure/canvas logic for broadcasting a web prototype inside a device frame. No React here.

## Technical reality (read this first)

- An `<iframe>` **cannot** be drawn into a canvas. The prototype's pixels reach the compositor
  only through screen/tab capture (`capture.ts`): ideally `preferCurrentTab` + Region Capture
  (`CropTarget.fromElement(iframeContainer)` + `track.cropTo`) so only the iframe region is
  captured, or the user picks another tab for sites whose CSP / `X-Frame-Options` forbid embedding.
- Input events of a **cross-origin** iframe are invisible to the parent page. Ripples therefore
  have three honest sources:
  1. **Same-origin iframe** — `attachSameOriginListener` listens inside `contentDocument` (full fidelity).
  2. **Demo overlay** — a transparent element above the iframe intercepts pointer events
     (`createPointerSource`). Ripples show, but the page underneath does NOT receive the click.
  3. **Manual** — the broadcaster taps the overlay deliberately.

## Files

| File             | Purpose                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| `frames.ts`      | device geometry (mobile 390x844, desktop 16:9 + tab/address bar), canvas drawing, returns inner screen rect |
| `ripples.ts`     | `RippleField` (normalized coords, lifetime, cap 24) + per-layer registry                                    |
| `capture.ts`     | `getDisplayMedia` bridge with feature detection + typed `CaptureError`                                      |
| `url.ts`         | strict http(s) URL normalization, mixed-content, known framing blockers, iframe sandbox                     |
| `interaction.ts` | pointer → ripple conversion, same-origin listener                                                           |
