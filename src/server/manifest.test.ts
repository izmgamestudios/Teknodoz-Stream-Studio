import { describe, expect, it } from "vitest";

import { resolveBrand } from "../studio/branding/brand";
import { handleManifest } from "./manifest";

const brand = () => resolveBrand({ name: "Acme", shortName: "Acme" });
const req = (path: string, method = "GET") =>
  new Request(`https://x.example${path}`, { method });

describe("manifest endpoint", () => {
  it("serves the brand as an installable manifest", async () => {
    const res = handleManifest(req("/manifest.webmanifest"), brand);
    expect(res?.status).toBe(200);
    expect(res?.headers.get("content-type")).toContain(
      "application/manifest+json",
    );
    expect(res?.headers.get("cache-control")).toContain("max-age");
    const json = (await res?.json()) as { name: string; display: string };
    expect(json.name).toBe("Acme");
    expect(json.display).toBe("standalone");
  });

  it("ignores other paths and query strings do not matter", () => {
    expect(handleManifest(req("/studio"), brand)).toBeNull();
    expect(handleManifest(req("/manifest.webmanifest.bak"), brand)).toBeNull();
    expect(
      handleManifest(req("/manifest.webmanifest?v=2"), brand)?.status,
    ).toBe(200);
  });

  it("allows GET and HEAD only", async () => {
    const head = handleManifest(req("/manifest.webmanifest", "HEAD"), brand);
    expect(head?.status).toBe(200);
    expect(await head?.text()).toBe("");
    const post = handleManifest(req("/manifest.webmanifest", "POST"), brand);
    expect(post?.status).toBe(405);
    expect(post?.headers.get("allow")).toBe("GET, HEAD");
  });
});
