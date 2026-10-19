// src/studio/pwa/downloads-config.ts
// >>> The project owner edits THIS file when native installers or store listings exist. <<<
//
// Until then /download offers the web app as an installable app (PWA) on every platform. To add a
// native build, paste its link below (see docs/DOWNLOADS.md for how to produce one: PWABuilder for
// Windows / Android / iOS, or a Tauri / Electron build for desktop):
//
//   windows: { url: "https://github.com/izmgamestudios/Teknodoz-Stream-Studio/releases/latest/download/Teknodoz-Studio-Setup.msi", version: "0.1.0", sha256: "…64 hex…" },
//   macos:   { url: "…/Teknodoz-Studio.dmg" },
//   linux:   { url: "…/Teknodoz-Studio.AppImage" },
//   android: { url: "https://play.google.com/store/apps/details?id=…" },
//   ios:     { url: "https://apps.apple.com/app/id…" },
//
// Only https links on GitHub, the app stores, Flathub/Snap/F-Droid, your own site's domain, or a
// host you list in `extraHosts` are accepted; anything else is ignored and reported on /download.
import type { DownloadsConfig } from "./downloads";

export const DOWNLOADS_CONFIG: DownloadsConfig = {
  links: {},
  extraHosts: [],
};
