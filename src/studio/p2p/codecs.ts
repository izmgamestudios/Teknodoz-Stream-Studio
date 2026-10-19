// src/studio/p2p/codecs.ts
// Shrinks the host's OFFER (and therefore the copy/paste code) by restricting the codec list
// through the standard RTCRtpTransceiver.setCodecPreferences() API - never by editing SDP text.
//
// Why this is safe:
//  - opus is mandatory-to-implement for every WebRTC endpoint (RFC 7874); VP8 and H.264 are
//    both mandatory-to-implement video codecs (RFC 7742), so any compliant answerer can match
//    at least one of them.
//  - `video/rtx` is kept so packet-loss recovery (NACK retransmission) keeps working.
//  - The browser itself regenerates a consistent m-section (payload types, rtcp-fb, fmtp), so
//    there is no hand-made SDP that could be malformed.
//  - Any failure (unsupported API, InvalidAccessError, empty selection) leaves the browser's
//    default codec list untouched: see `applyCompactCodecs`.
//  - What is dropped: VP9/AV1/H.265 (heavy on a 1080p60 mesh anyway), RED/ULPFEC/FlexFEC,
//    G.722/PCMU/PCMA/CN/telephone-event.
//
// NOTE: this behaviour could not be exercised against real browsers in the headless test
// environment. It is therefore guarded, fully optional (`compactCodecs: false` on StudioHost)
// and only ever affects the offer; the answer is the intersection chosen by the other browser.
import { safely, type RtcCodec, type RtcTransceiverLike } from "./rtc";

function mime(codec: RtcCodec): string {
  return codec.mimeType.toLowerCase();
}

/**
 * Pure selection of the codecs to offer. Returns null when no safe restriction exists
 * (e.g. capabilities list lacks opus/VP8/H.264), meaning "leave the defaults alone".
 * Relative order of the browser's own preference list is preserved.
 */
export function selectCompactCodecs(
  kind: "audio" | "video",
  capabilities: readonly RtcCodec[],
): RtcCodec[] | null {
  const keep =
    kind === "audio"
      ? ["audio/opus"]
      : ["video/vp8", "video/h264", "video/rtx"];
  const primary =
    kind === "audio" ? ["audio/opus"] : ["video/vp8", "video/h264"];
  const selected = capabilities.filter((codec) => keep.includes(mime(codec)));
  if (!selected.some((codec) => primary.includes(mime(codec)))) return null;
  if (selected.length === capabilities.length) return null; // nothing to drop
  return selected;
}

/**
 * Apply `selectCompactCodecs` to the given transceivers. `getCapabilities` is injected
 * (RtcFactory.getCodecCapabilities). Never throws. Returns how many transceivers were changed.
 */
export function applyCompactCodecs(
  transceivers: readonly RtcTransceiverLike[],
  getCapabilities: ((kind: "audio" | "video") => RtcCodec[] | null) | undefined,
): number {
  if (!getCapabilities) return 0;
  let changed = 0;
  for (const transceiver of transceivers) {
    if (typeof transceiver.setCodecPreferences !== "function") continue;
    const kind = transceiver.receiver.track.kind;
    if (kind !== "audio" && kind !== "video") continue;
    safely(() => {
      const capabilities = getCapabilities(kind);
      if (!capabilities) return;
      const selection = selectCompactCodecs(kind, capabilities);
      if (!selection) return;
      transceiver.setCodecPreferences?.(selection);
      changed++;
    });
  }
  return changed;
}
