// src/studio/proto/index.ts
export {
  MOBILE_SCREEN,
  drawDeviceFrame,
  drawDeviceOverlay,
  frameGeometry,
  roundRectPath,
  roundRectSubpath,
  type FrameGeometry,
  type FrameStyle,
} from "./frames";
export {
  LIFETIME_MS,
  MAX_RIPPLES,
  RippleField,
  getRippleField,
  releaseRippleField,
  type Ripple,
  type RippleKind,
} from "./ripples";
export {
  EMBED_HELP,
  MAX_URL_LENGTH,
  iframeSandbox,
  isMixedContentBlocked,
  likelyBlocksEmbedding,
  normalizePrototypeUrl,
  type UrlResult,
} from "./url";
export {
  CaptureError,
  captureSupport,
  captureSurface,
  type CaptureErrorCode,
  type CaptureHandle,
  type CaptureOptions,
  type CaptureSupport,
} from "./capture";
export {
  DRAG_THROTTLE_MS,
  attachSameOriginListener,
  createPointerSource,
  toRipple,
  type ElementRect,
  type PointerLike,
} from "./interaction";
