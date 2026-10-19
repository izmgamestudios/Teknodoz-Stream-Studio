// src/studio/p2p/errors.ts
// Typed errors for the serverless WebRTC layer. UI code must branch on `code`, never on
// `message`. Messages are short Turkish defaults and may be replaced by the UI.

/** Codes raised while encoding/decoding a signaling code (see signaling.ts `SignalError`). */
export type SignalErrorCode =
  "bad-prefix" | "corrupt" | "too-large" | "version";

export type P2PErrorCode =
  | SignalErrorCode
  /** WebRTC / getUserMedia / Web Audio is missing in this runtime (SSR, old browser, http). */
  | "unsupported"
  /** The host / client was disposed. */
  | "disposed"
  /** The host already serves `maxPeers` live peers. */
  | "max-peers"
  /** No peer with that id (never existed, kicked, or invite expired). */
  | "unknown-peer"
  /** The operation is not valid in the connection's current state (late answer, closed peer). */
  | "bad-state"
  /** An answer was already applied to this invite (a different one was pasted twice). */
  | "already-answered"
  /** An offer code was pasted where an answer is expected, or vice versa. */
  | "wrong-direction"
  /** The code was produced for a different role than the invite. */
  | "role-mismatch"
  /** The method is not available for this connection's role (e.g. startGuest on a viewer). */
  | "wrong-role"
  /** The browser rejected the SDP (corrupt or incompatible description). */
  | "bad-sdp"
  /** ICE gathering produced no candidate at all (no network interface / blocked). */
  | "ice-failed"
  /** The control channel is not open yet (or any more). */
  | "not-connected"
  /** The user (or policy) denied camera/microphone access. */
  | "permission-denied"
  /** No camera/microphone matches the request. */
  | "no-device"
  /** The device is in use by another application. */
  | "device-busy"
  /** Any other getUserMedia failure. */
  | "media-error";

const MESSAGES: Record<P2PErrorCode, string> = {
  "bad-prefix": "Geçersiz bağlantı kodu",
  corrupt: "Bağlantı kodu bozuk veya eksik",
  "too-large": "Bağlantı kodu çok büyük",
  version: "Bağlantı kodu sürümü desteklenmiyor",
  unsupported: "Bu tarayıcı WebRTC'yi desteklemiyor",
  disposed: "Bağlantı kapatıldı",
  "max-peers": "Azami katılımcı sayısına ulaşıldı",
  "unknown-peer": "Katılımcı bulunamadı",
  "bad-state": "Bağlantı bu işlem için uygun durumda değil",
  "already-answered": "Bu davet zaten yanıtlandı",
  "wrong-direction": "Yanlış kod türü (davet ve yanıt karıştı)",
  "role-mismatch": "Kod bu davetin rolüyle uyuşmuyor",
  "wrong-role": "Bu işlem bu rol için kullanılamaz",
  "bad-sdp": "Tarayıcı bağlantı kodunu kabul etmedi",
  "ice-failed": "Ağ adayı bulunamadı",
  "not-connected": "Bağlantı henüz hazır değil",
  "permission-denied": "Kamera/mikrofon izni verilmedi",
  "no-device": "Kamera veya mikrofon bulunamadı",
  "device-busy": "Kamera veya mikrofon başka bir uygulamada kullanılıyor",
  "media-error": "Kamera/mikrofon açılamadı",
};

/** Default Turkish message for a code (stable fallback for UI layers). */
export function p2pErrorMessage(code: P2PErrorCode): string {
  return MESSAGES[code];
}

export class P2PError<C extends string = P2PErrorCode> extends Error {
  readonly code: C;

  constructor(code: C, message?: string, options?: { cause?: unknown }) {
    super(
      message ?? MESSAGES[code as unknown as P2PErrorCode] ?? String(code),
      options,
    );
    this.name = "P2PError";
    this.code = code;
  }
}

export function isP2PError(value: unknown): value is P2PError<P2PErrorCode> {
  return value instanceof P2PError;
}
