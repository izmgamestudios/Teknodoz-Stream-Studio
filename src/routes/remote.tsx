// src/routes/remote.tsx
// Manual (serverless) phone remote. Prefer /r/<code>?as=remote when the relay exists.
import { createFileRoute } from "@tanstack/react-router";

import { ConnectCard } from "@/studio/ui/connect-card";
import { RemoteView } from "@/studio/ui/guest-views";
import { useClientConnection } from "@/studio/ui/use-client";

export const Route = createFileRoute("/remote")({
  head: () => ({
    meta: [
      { title: "Kumanda — Teknodoz Studio" },
      { name: "robots", content: "noindex" },
      { name: "referrer", content: "no-referrer" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, maximum-scale=1",
      },
    ],
  }),
  component: RemotePage,
});

function RemotePage() {
  const conn = useClientConnection();
  const { client, status } = conn;
  const online =
    conn.phase === "answer" &&
    status !== "connecting" &&
    status !== "disconnected";

  if (!online || !client) {
    return (
      <div className="mx-auto min-h-screen max-w-md space-y-4 p-4">
        <header className="pt-4">
          <p className="text-xs uppercase tracking-[0.3em] text-speaker-b">
            Teknodoz Studio
          </p>
          <h1 className="mt-1 text-2xl font-bold">📱 Telefon kumandası</h1>
        </header>
        <ConnectCard
          phase={conn.phase}
          answer={conn.answer}
          status={status}
          error={conn.error}
          askName={false}
          onConnect={conn.connect}
        />
        {status === "disconnected" && conn.phase === "answer" && (
          <p role="alert" className="text-sm text-destructive">
            Bağlantı koptu. Sayfayı yenileyip yeni bir davet isteyin.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-md p-3">
      <RemoteView client={client} />
    </div>
  );
}
