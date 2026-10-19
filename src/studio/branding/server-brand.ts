// src/studio/branding/server-brand.ts
// The brand as the SERVER sees it: defaults < config.ts < environment. Runs on Node-like runtimes;
// elsewhere (no process.env) only config.ts applies.
import {
  DEFAULT_BRAND,
  brandFromEnv,
  brandJsonProblem,
  parseBrandPatch,
  resolveBrand,
  type Brand,
} from "./brand";
import { BRAND_CONFIG } from "./config";

let warned = false;

export function serverBrand(
  env: Record<string, string | undefined> = typeof process !== "undefined" &&
  process.env
    ? process.env
    : {},
): Brand {
  const file = parseBrandPatch(BRAND_CONFIG);
  const fromEnv = brandFromEnv(env);
  const badJson = brandJsonProblem(env);
  if (
    !warned &&
    (file.rejected.length > 0 || fromEnv.rejected.length > 0 || badJson)
  ) {
    warned = true;
    const list = [
      ...file.rejected.map((k) => `config.${k}`),
      ...fromEnv.rejected.map((k) => `env.${k}`),
      ...(badJson ? ["env.BRAND_JSON (not a JSON object)"] : []),
    ];
    console.warn(`[brand] ignored invalid values: ${list.join(", ")}`);
  }
  return resolveBrand(file.patch, fromEnv.patch);
}

export { DEFAULT_BRAND };
