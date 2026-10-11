// src/routes/settings.tsx
import { createFileRoute } from "@tanstack/react-router";

import { useT } from "@/studio/i18n/use-t";
import { StudioProvider } from "@/studio/runtime/use-studio";
import { CreditsFooter } from "@/studio/ui/credits";
import {
  ConnectionSection,
  LanguageSection,
  OutputSection,
  ShortcutsSection,
} from "@/studio/ui/settings-panels";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Ayarlar — Teknodoz Studio" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <StudioProvider
      fallback={
        <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
          …
        </div>
      }
    >
      <SettingsApp />
    </StudioProvider>
  );
}

function SettingsApp() {
  const t = useT();
  return (
    <div className="min-h-screen p-3 md:p-6">
      <header className="mx-auto mb-4 max-w-5xl">
        <h1 className="text-3xl font-bold">{t("settings.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.intro")}
        </p>
      </header>
      <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <OutputSection />
          <ConnectionSection />
        </div>
        <div className="space-y-4">
          <ShortcutsSection />
          <LanguageSection />
        </div>
      </div>
      <CreditsFooter className="mx-auto mt-6 max-w-5xl border-t pt-3" />
    </div>
  );
}
