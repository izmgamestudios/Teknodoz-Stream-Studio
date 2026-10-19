// src/studio/pwa/downloads.ts
// Native installer / store links shown on /download. The links come from `downloads-config.ts`
// (owner edited); only https links on a known release / store host (or the site's own host) become
// buttons, everything else is reported and ignored, exactly like the community channels.
import { PLATFORM_IDS, type DownloadTarget } from "./platform";

export interface DownloadLink {
  url: string;
  /** button text override */
  label?: string;
  /** shown next to the button, e.g. "0.3.1" */
  version?: string;
  /** SHA-256 of the file so people can verify it (hex, 64 chars) */
  sha256?: string;
}

export interface DownloadsConfig {
  links: Partial<Record<DownloadTarget, DownloadLink>>;
  /** extra hostnames allowed for installer files (a CDN, your own domain…) */
  extraHosts?: readonly string[];
}

/** Hosts that may serve releases and store listings. `*.x` matches subdomains only. */
export const BASE_DOWNLOAD_HOSTS: readonly string[] = [
  "github.com",
  "*.githubusercontent.com",
  "play.google.com",
  "apps.apple.com",
  "testflight.apple.com",
  "apps.microsoft.com",
  "www.microsoft.com",
  "flathub.org",
  "snapcraft.io",
  "f-droid.org",
  "appimage.github.io",
];

export type DownloadKind = "store" | "file";
export type DownloadProblem =
  "invalid" | "not-https" | "credentials" | "host" | "too-long" | "sha256";

export interface DownloadStatus {
  target: DownloadTarget;
  link: (DownloadLink & { kind: DownloadKind; format: string | null }) | null;
  problem: DownloadProblem | null;
}

const STORE_HOSTS = [
  "play.google.com",
  "apps.apple.com",
  "testflight.apple.com",
  "apps.microsoft.com",
  "www.microsoft.com",
  "flathub.org",
  "snapcraft.io",
  "f-droid.org",
];

const FORMATS: readonly [RegExp, string][] = [
  [/\.msix(bundle)?$/i, "MSIX"],
  [/\.msi$/i, "MSI"],
  [/\.exe$/i, "EXE"],
  [/\.dmg$/i, "DMG"],
  [/\.pkg$/i, "PKG"],
  [/\.appimage$/i, "AppImage"],
  [/\.deb$/i, "DEB"],
  [/\.rpm$/i, "RPM"],
  [/\.apk$/i, "APK"],
  [/\.aab$/i, "AAB"],
  [/\.ipa$/i, "IPA"],
  [/\.(tar\.gz|tgz)$/i, "tar.gz"],
  [/\.zip$/i, "ZIP"],
];

function hostAllowed(host: string, patterns: readonly string[]): boolean {
  const h = host.toLowerCase();
  return patterns.some((p) => {
    const q = p.toLowerCase();
    return q.startsWith("*.")
      ? h.endsWith(q.slice(1)) && h.length > q.length - 1
      : h === q;
  });
}

export function resolveDownloads(
  cfg: DownloadsConfig,
  siteUrl = "",
): DownloadStatus[] {
  let own: string[] = [];
  try {
    if (siteUrl) own = [new URL(siteUrl).hostname];
  } catch {
    own = [];
  }
  const hosts = [...BASE_DOWNLOAD_HOSTS, ...(cfg.extraHosts ?? []), ...own];
  return PLATFORM_IDS.map((target): DownloadStatus => {
    const raw = cfg.links[target];
    if (!raw || raw.url.trim() === "")
      return { target, link: null, problem: null };
    const fail = (problem: DownloadProblem): DownloadStatus => ({
      target,
      link: null,
      problem,
    });
    const s = raw.url.trim();
    if (s.length > 500) return fail("too-long");
    let u: URL;
    try {
      u = new URL(s);
    } catch {
      return fail("invalid");
    }
    if (u.protocol !== "https:") return fail("not-https");
    if (u.username || u.password) return fail("credentials");
    if (!hostAllowed(u.hostname, hosts)) return fail("host");
    if (raw.sha256 !== undefined && !/^[0-9a-f]{64}$/i.test(raw.sha256))
      return fail("sha256");
    const format = FORMATS.find(([re]) => re.test(u.pathname))?.[1] ?? null;
    const kind: DownloadKind = hostAllowed(u.hostname, STORE_HOSTS)
      ? "store"
      : "file";
    return {
      target,
      problem: null,
      link: {
        ...raw,
        url: u.toString(),
        kind,
        format,
      },
    };
  });
}
