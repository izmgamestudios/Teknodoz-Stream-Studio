import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { DEFAULT_BRAND, type Brand } from "@/studio/branding/brand";
import {
  brandCss,
  brandHeadLinks,
  brandHeadMeta,
} from "@/studio/branding/head";
import { getBrand } from "@/studio/branding/server-fn";
import { registerServiceWorker } from "@/studio/pwa/register";
import { BrandProvider } from "@/studio/ui/brand-context";

import appCss from "../styles.css?url";
import { AppShell } from "../components/app-shell";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">
          Page not found
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back
          home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    // identity (name, colors, share data, icons) comes from config.ts + BRAND_* on the server
    loader: () => getBrand(),
    head: ({ loaderData, matches }) => {
      const brand: Brand = loaderData ?? DEFAULT_BRAND;
      const pathname = matches.at(-1)?.pathname;
      const css = brandCss(brand);
      return {
        meta: [
          { charSet: "utf-8" },
          { name: "viewport", content: "width=device-width, initial-scale=1" },
          ...brandHeadMeta(brand, pathname),
        ],
        links: [
          { rel: "stylesheet", href: appCss },
          {
            rel: "preload",
            href: "/fonts/space-grotesk-latin-wght-normal.woff2",
            as: "font",
            type: "font/woff2",
            crossOrigin: "anonymous",
          },
          ...brandHeadLinks(brand, pathname),
        ],
        ...(css ? { styles: [{ children: css }] } : {}),
      };
    },
    shellComponent: RootShell,
    component: RootComponent,
    notFoundComponent: NotFoundComponent,
    errorComponent: ErrorComponent,
  },
);

function RootShell({ children }: { children: ReactNode }) {
  const lang = useRouterState({
    select: (s) => {
      const d = s.matches.find((m) => m.routeId === "__root__")?.loaderData as
        Partial<Brand> | undefined;
      return d?.lang ?? DEFAULT_BRAND.lang;
    },
  });
  return (
    <html lang={lang}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const brand = Route.useLoaderData();
  // installable app + offline page: production only (see public/sw.js)
  useEffect(() => registerServiceWorker(import.meta.env.PROD), []);

  return (
    <QueryClientProvider client={queryClient}>
      <BrandProvider server={brand}>
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <AppShell>
          <Outlet />
        </AppShell>
      </BrandProvider>
    </QueryClientProvider>
  );
}
