// src/routes/creator.tsx
// Direct link for content creators: sign in or apply. After signing in the studio opens.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { titleFromMatches } from "@/studio/branding/head";
import { setAudience } from "@/studio/audience";
import { CreatorAccess } from "@/studio/ui/creator-access";
import { canCreate, useCreator } from "@/studio/watch/creator-session";

export const Route = createFileRoute("/creator")({
  head: ({ matches }) => ({
    meta: [
      { title: titleFromMatches(matches, "Creator") },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CreatorPage,
});

function CreatorPage() {
  const navigate = useNavigate();
  const account = useCreator();
  // already signed in (creator or administrator): nothing to ask
  useEffect(() => {
    if (account.loaded && account.enabled && canCreate(account)) {
      setAudience("creator");
      void navigate({ to: "/", replace: true });
    }
  }, [account, navigate]);
  return (
    <div className="mx-auto max-w-md p-4">
      <CreatorAccess
        onSignedIn={() => {
          setAudience("creator");
          void navigate({ to: "/" });
        }}
        onBack={() => {
          setAudience("viewer");
          void navigate({ to: "/watch" });
        }}
      />
    </div>
  );
}
