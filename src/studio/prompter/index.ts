// src/studio/prompter/index.ts
// Public surface of the prompter module. UI/runtime code imports from here only.

export * from "./script";
export * from "./engine";
// voice-follow re-exports the pure ScriptAligner from ./aligner
export * from "./voice-follow";
export * from "./burn-in";
export * from "./files";
