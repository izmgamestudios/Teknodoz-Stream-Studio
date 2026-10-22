// src/studio/guide/resources-config.ts
// >>> The project owner edits THIS file: the PDF guide on Google Drive, YouTube videos, extra links. <<<
// They appear on /guide (and in docs/USER-GUIDE*.md after `UPDATE_DOCS=1 npx vitest run src/studio/guide`).
//
//   pdf:    paste the Drive "Share" link (set sharing to "Anyone with the link: Viewer"):
//           { title: "Kullanım kılavuzu (PDF)", url: "https://drive.google.com/file/d/FILE_ID/view?usp=sharing" }
//           A Google Docs link (docs.google.com/document/d/…) works too; a .pdf on GitHub or on your own site opens in a new tab.
//   videos: any YouTube link (watch?v=…, youtu.be/…, shorts/…, with ?t=90 for a start time):
//           { title: "5 dakikada Teknodoz Studio", url: "https://www.youtube.com/watch?v=VIDEO_ID", duration: "5:00" }
//   links:  any https link.
//
// Invalid entries are ignored and reported on /guide instead of breaking the page.
import type { ResourcesConfig } from "./resources";

export const GUIDE_RESOURCES: ResourcesConfig = {
  pdf: [],
  videos: [],
  links: [
    {
      title: "YouTube — Teknodoz",
      url: "https://www.youtube.com/@teknodoz",
      note: "Eğitim videoları ve yayın kayıtları / Tutorials and recordings",
    },
  ],
};
