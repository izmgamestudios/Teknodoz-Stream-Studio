// src/studio/branding/server-fn.ts
// Server function the root route loads: runs on the server during SSR, so BRAND_* environment
// variables can shape the <head> without leaking the environment to the client.
import { createServerFn } from "@tanstack/react-start";

import { serverBrand } from "./server-brand";

export const getBrand = createServerFn({ method: "GET" }).handler(async () =>
  serverBrand(),
);
