import { describe, expect, it } from "vitest";
import { isQuotaError, StorageError, toStorageError } from "./errors";

describe("isQuotaError", () => {
  it("recognises the many spellings of 'out of space'", () => {
    expect(isQuotaError(new DOMException("full", "QuotaExceededError"))).toBe(
      true,
    );
    expect(isQuotaError({ name: "QuotaExceededError" })).toBe(true);
    expect(isQuotaError({ name: "NS_ERROR_DOM_QUOTA_REACHED" })).toBe(true);
    expect(isQuotaError({ code: 22 })).toBe(true);
    expect(isQuotaError({ code: 1014 })).toBe(true);
    expect(isQuotaError(new StorageError("quota"))).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isQuotaError(new StorageError("io"))).toBe(false);
    expect(isQuotaError(new Error("nope"))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
    expect(isQuotaError(undefined)).toBe(false);
    expect(isQuotaError("QuotaExceededError")).toBe(false);
    expect(isQuotaError({ code: 21 })).toBe(false);
  });
});

describe("toStorageError", () => {
  it("passes StorageErrors through unchanged", () => {
    const err = new StorageError("blocked");
    expect(toStorageError(err)).toBe(err);
  });

  it("maps quota errors to code 'quota' and keeps the cause", () => {
    const cause = new DOMException("full", "QuotaExceededError");
    const err = toStorageError(cause);
    expect(err.code).toBe("quota");
    expect(err.cause).toBe(cause);
  });

  it("maps clone/data errors to 'invalid'", () => {
    expect(toStorageError(new DOMException("x", "DataCloneError")).code).toBe(
      "invalid",
    );
    expect(toStorageError(new DOMException("x", "DataError")).code).toBe(
      "invalid",
    );
  });

  it("uses the fallback code for anything else", () => {
    expect(toStorageError(new Error("x")).code).toBe("io");
    expect(toStorageError(new Error("x"), "unavailable").code).toBe(
      "unavailable",
    );
    expect(toStorageError(undefined).code).toBe("io");
    expect(toStorageError("string").code).toBe("io");
  });
});
