// src/routes/live.tsx
// Go live (RTMPS) through the server-side ffmpeg bridge. See docs/LIVE.md.
import { createFileRoute } from "@tanstack/react-router";

import { StudioProvider } from "@/studio/runtime/use-studio";
import { CreditsFooter } from "@/studio/ui/credits";
import { LiveApp } from "@/studio/ui/live-page";

export const Route = createFileRoute("/live")({
  head: () => ({
    meta: [
      { title: "Canlı yayın — Teknodoz Studio" },
      {
        name: "description",
        content:
          "Program çıkışını YouTube, Facebook, Twitch, Kick, Instagram ve TikTok'a RTMPS ile gönderin; kendi sunucunuzdaki ffmpeg köprüsüyle.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LivePage,
});

function LivePage() {
  return (
    <StudioProvider
      fallback={
        <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
          Yükleniyor…
        </div>
      }
    >
      <LiveApp />
      <CreditsFooter className="mx-auto mb-6 mt-2 max-w-6xl border-t px-3 pt-3 md:px-6" />
    </StudioProvider>
  );
}
