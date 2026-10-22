// src/routes/settings.tsx
import { createFileRoute } from "@tanstack/react-router";

import { useT } from "@/studio/i18n/use-t";
import { StudioProvider } from "@/studio/runtime/use-studio";
import {
  BrandLocalSection,
  BrandSiteSection,
} from "@/studio/ui/brand-settings";
import { WorkspaceBackup } from "@/studio/ui/workspace-backup";
import { CreditsFooter } from "@/studio/ui/credits";
import {
  ConnectionSection,
  LanguageSection,
  OutputSection,
  ShortcutsSection,
} from "@/studio/ui/settings-panels";
import { useAdmin } from "@/studio/watch/admin-session";
import { titleFromMatches } from "@/studio/branding/head";

export const Route = createFileRoute("/settings")({
  head: ({ matches }) => ({
    meta: [
      { title: titleFromMatches(matches, "Ayarlar") },
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
  const { admin } = useAdmin();
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
          <BrandLocalSection />
          <WorkspaceBackup />
        </div>
      </div>
      {admin && (
        <details className="group mx-auto mt-4 max-w-5xl">
          <summary className="cursor-pointer rounded-md px-1 py-2 text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground">
            {t("settings.site.summary")}
          </summary>
          <BrandSiteSection />
        </details>
      )}
      <CreditsFooter className="mx-auto mt-6 max-w-5xl border-t pt-3" />
    </div>
  );
}
