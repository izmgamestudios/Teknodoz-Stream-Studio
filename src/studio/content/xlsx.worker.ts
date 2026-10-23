// src/studio/content/xlsx.worker.ts
// Reads an XLSX file off the main thread. The limits live in shared/xlsx.ts.
import { readTable, XlsxError } from "../../shared/xlsx";

self.onmessage = async (e: MessageEvent<{ bytes: Uint8Array }>) => {
  try {
    (self as unknown as Worker).postMessage({
      table: await readTable(e.data.bytes),
    });
  } catch (err) {
    (self as unknown as Worker).postMessage({
      code: err instanceof XlsxError ? err.code : "not-xlsx",
    });
  }
};
