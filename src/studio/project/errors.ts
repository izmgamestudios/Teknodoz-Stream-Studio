// src/studio/project/errors.ts
// Typed errors of the project module. UI code branches on `code`, never on `message`.

export type PptdzErrorCode =
  | "bad-magic"
  | "bad-version"
  | "corrupt"
  | "too-large"
  | "invalid-project"
  | "unsupported-asset";

/** Short Turkish default messages. The `code` is the stable contract. */
const PPTDZ_MESSAGES: Record<PptdzErrorCode, string> = {
  "bad-magic": "Bu dosya bir .pptdz paketi değil",
  "bad-version": "Paket sürümü desteklenmiyor",
  corrupt: "Paket bozuk veya eksik",
  "too-large": "Paket çok büyük",
  "invalid-project": "Paketteki proje geçersiz",
  "unsupported-asset": "Pakette desteklenmeyen dosya türü var",
};

export class PptdzError extends Error {
  readonly code: PptdzErrorCode;

  constructor(
    code: PptdzErrorCode,
    message?: string,
    options?: { cause?: unknown },
  ) {
    super(message ?? PPTDZ_MESSAGES[code], options);
    this.name = "PptdzError";
    this.code = code;
  }
}

export function isPptdzError(value: unknown): value is PptdzError {
  return value instanceof PptdzError;
}

export type ProjectSchemaErrorCode =
  "not-an-object" | "unsupported-version" | "invalid";

const SCHEMA_MESSAGES: Record<ProjectSchemaErrorCode, string> = {
  "not-an-object": "Proje verisi geçersiz",
  "unsupported-version": "Proje sürümü desteklenmiyor",
  invalid: "Proje okunamadı",
};

export class ProjectSchemaError extends Error {
  readonly code: ProjectSchemaErrorCode;

  constructor(
    code: ProjectSchemaErrorCode,
    message?: string,
    options?: { cause?: unknown },
  ) {
    super(message ?? SCHEMA_MESSAGES[code], options);
    this.name = "ProjectSchemaError";
    this.code = code;
  }
}

export function isProjectSchemaError(
  value: unknown,
): value is ProjectSchemaError {
  return value instanceof ProjectSchemaError;
}
