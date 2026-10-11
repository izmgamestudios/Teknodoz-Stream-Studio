// src/routes/join.tsx
// Manual (serverless) viewer / guest page. Opened from an invite link whose code lives in the URL
// fragment (never sent anywhere). Prefer the short room links (/r/<code>) when the relay exists.
import { createFileRoute } from "@tanstack/react-router";

import { useT } from "@/studio/i18n/use-t";
import { ConnectCard } from "@/studio/ui/connect-card";
import { CreditsFooter } from "@/studio/ui/credits";
import { ViewerGuestView } from "@/studio/ui/guest-views";
import { useClientConnection } from "@/studio/ui/use-client";

export const Route = createFileRoute("/join")({
  head: () => ({
    meta: [
      { title: "Yayına katıl — Teknodoz Studio" },
      { name: "robots", content: "noindex" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: JoinPage,
});

function JoinPage() {
  const t = useT();
  const conn = useClientConnection();
  const { client, status } = conn;
  const connected = conn.phase === "answer" && status !== "connecting";

  return (
    <div className="mx-auto min-h-screen max-w-2xl space-y-4 p-4">
      <header className="pt-4">
        <p className="text-xs uppercase tracking-[0.3em] text-speaker-b">
          Teknodoz Studio
        </p>
        <h1 className="mt-1 text-2xl font-bold">{t("join.title")}</h1>
      </header>

      <ConnectCard
        phase={conn.phase}
        answer={conn.answer}
        status={status}
        error={conn.error}
        askName
        onConnect={conn.connect}
      />

      {connected && client && <ViewerGuestView client={client} />}

      <CreditsFooter className="border-t pt-3" />
    </div>
  );
}
