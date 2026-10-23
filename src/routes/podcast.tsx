// src/routes/podcast.tsx
// The podcast control room now lives inside the studio (one place for scenes, templates, the
// frequency visualiser, recording and the room). Old links and bookmarks land there.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/podcast")({
  beforeLoad: () => {
    throw redirect({ to: "/studio", hash: "podcast", replace: true });
  },
});
