// src/studio/engine/compositor-index.ts
// Public surface of the canvas compositor module. Import from here, not from the individual files:
//
//   import { Compositor, createTicker, hitTestLayer, ChromaProcessor } from "@/studio/engine/compositor-index";
//
//  - compositor.ts  the `Compositor` class plus pure transition / text helpers
//  - transform.ts   pure geometry: hit-testing, handles, resize / rotate / snap / clamp, stage fit
//  - chroma.ts      chroma keying (CPU math + WebGL2 `ChromaProcessor`)
//  - blend.ts       blend-mode validation / support probe and CSS filter sanitizing
//  - ticker.ts      rAF / worker-timer frame pacing and frame statistics
//
// Name clashes between the modules are avoided on purpose so `export *` is safe here.

export * from "./blend";
export * from "./chroma";
export * from "./compositor";
export * from "./ticker";
export * from "./transform";
