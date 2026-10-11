// src/studio/ui/brand-context.tsx
// Brand for the React tree: the server brand (from the root loader) plus this browser's local
// overrides, with the theme applied to the DOM. Logo and badge components live here too.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { TeknodozLogo } from "@/components/teknodoz-logo";

import {
  DEFAULT_BRAND,
  LOCAL_KEYS,
  resolveBrand,
  type Brand,
} from "../branding/brand";
import {
  applyThemeToDom,
  loadLocalBrand,
  saveLocalBrand,
} from "../branding/local";
import { useT } from "../i18n/use-t";

interface BrandCtx {
  /** server brand + local overrides */
  brand: Brand;
  /** what the server (config + env) says, without local overrides */
  server: Brand;
  local: Partial<Brand>;
  setLocal: (patch: Partial<Brand>) => void;
  resetLocal: () => void;
}

const Ctx = createContext<BrandCtx>({
  brand: DEFAULT_BRAND,
  server: DEFAULT_BRAND,
  local: {},
  setLocal: () => undefined,
  resetLocal: () => undefined,
});

export function BrandProvider({
  server,
  children,
}: {
  server: Brand;
  children: ReactNode;
}) {
  const [local, setLocalState] = useState<Partial<Brand>>({});
  // read after hydration so server and client markup match
  useEffect(() => setLocalState(loadLocalBrand()), []);

  const brand = useMemo(() => resolveBrand(server, local), [server, local]);
  useEffect(() => applyThemeToDom(brand), [brand]);

  const setLocal = useCallback((patch: Partial<Brand>) => {
    setLocalState((cur) => {
      const next: Partial<Brand> = { ...cur, ...patch };
      for (const k of LOCAL_KEYS) if (next[k] === undefined) delete next[k];
      saveLocalBrand(next);
      return next;
    });
  }, []);
  const resetLocal = useCallback(() => {
    saveLocalBrand({});
    setLocalState({});
  }, []);

  const value = useMemo(
    () => ({ brand, server, local, setLocal, resetLocal }),
    [brand, server, local, setLocal, resetLocal],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBrand(): Brand {
  return useContext(Ctx).brand;
}
export function useBrandControls(): BrandCtx {
  return useContext(Ctx);
}

/** Custom logo image when set, otherwise the built-in wordmark. */
export function BrandLogo({ className }: { className?: string }) {
  const { name, logoUrl } = useBrand();
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={name}
        className={`h-8 w-auto max-w-44 object-contain ${className ?? ""}`}
      />
    );
  }
  return <TeknodozLogo {...(className ? { className } : {})} />;
}

/** "Early access" label under the logo; hidden when the badge text is empty. */
export function BrandBadge({ className = "" }: { className?: string }) {
  const t = useT();
  const { badge } = useBrand();
  if (!badge) return null;
  // the default text follows the UI language, a custom one is shown as written
  const label = badge === DEFAULT_BRAND.badge ? t("shell.badge") : badge;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-speaker-b/40 bg-speaker-b/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-speaker-b ${className}`}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-speaker-b" />
      {label}
    </span>
  );
}
