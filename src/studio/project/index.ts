// src/studio/project/index.ts
export {
  ProjectSchemaError,
  PptdzError,
  isPptdzError,
  isProjectSchemaError,
  type PptdzErrorCode,
  type ProjectSchemaErrorCode,
} from "./errors";
export {
  exportPptdz,
  importPptdz,
  suggestedFilename,
  verifyPptdzHeader,
  type ExportResult,
  type ImportOptions,
  type ImportResult,
  type PptdzProgress,
} from "./pptdz";
export {
  LIMITS,
  layerSchema,
  migrateProject,
  parseProject,
  type ParseProjectResult,
} from "./schema";
export {
  assetIdsInProject,
  createProjectStore,
  findLayer,
  getActiveScene,
  type LayerPatch,
  type ProjectStore,
  type ProjectStoreOptions,
} from "./store";
