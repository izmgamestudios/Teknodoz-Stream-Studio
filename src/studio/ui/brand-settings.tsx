// src/studio/ui/brand-settings.tsx
// Branding editor on /settings.
//  - BrandLocalSection: this browser only (name, slogan, badge, colors, radius, scale, logo), live.
//  - BrandSiteSection: the owner's view of the whole brand (meta, share image, icons…) with a
//    share-card preview, advisory checks and export/import for config.ts, .env or BRAND_JSON.
import { useId, useMemo, useRef, useState } from "react";

import {
  BRAND_KEYS,
  LOCAL_KEYS,
  parseBrandPatch,
  resolveBrand,
  type Brand,
} from "../branding/brand";
import { WARNING_TEXT, checkBrand } from "../branding/check";
import {
  exportBrand,
  importBrand,
  patchFromDefaults,
  type ExportFormat,
} from "../branding/export";
import {
  BRAND_GROUPS,
  BRAND_LABELS,
  FIELD_KIND,
  OPTIONAL_COLORS,
} from "../branding/labels";
import { LOGO_FILE_TYPES, logoDataUrl } from "../branding/logo-file";
import { downloadBlob } from "../engine/download";
import { useContentLang } from "../i18n/use-t";
import { useBrandControls } from "./brand-context";
import {
  BTN,
  BTN_ACCENT,
  INPUT,
  PANEL,
  PanelTitle,
  RangeInput,
  SelectInput,
} from "./fields";

type Lang = "tr" | "en";
type Value = Brand[keyof Brand];

const TXT = {
  localTitle: {
    tr: "Marka ve görünüm (bu tarayıcı)",
    en: "Brand and look (this browser)",
  },
  localBody: {
    tr: "Ad, slogan, etiket, renkler, köşe ve ölçek yalnızca bu tarayıcıda değişir; anında uygulanır. Herkes için kalıcı yapmak için aşağıdaki “Site” bölümünü kullan.",
    en: "Name, slogan, badge, colors, corners and scale change only in this browser, instantly. To change it for everyone, use the “Site” section below.",
  },
  reset: { tr: "Sunucu değerlerine dön", en: "Back to server values" },
  siteTitle: {
    tr: "Site ve paylaşım (dağıtım sahibi)",
    en: "Site and sharing (owner)",
  },
  siteBody: {
    tr: "Burada yaptığın değişiklikler sunucuyu değiştirmez: çıktıyı src/studio/branding/config.ts dosyasına ya da sunucu ortam değişkenlerine (BRAND_*) koyup yeniden dağıt. Başlık, açıklama, paylaşım görseli ve uygulama simgeleri bu yolla herkese ulaşır.",
    en: "Changes here do not touch the server: put the output in src/studio/branding/config.ts or the server environment (BRAND_*) and redeploy. Titles, descriptions, the share image and app icons reach everybody that way.",
  },
  preview: { tr: "Paylaşım önizlemesi", en: "Share preview" },
  checks: { tr: "Kontroller", en: "Checks" },
  allGood: { tr: "Her şey yolunda görünüyor.", en: "Everything looks fine." },
  export: { tr: "Dışa aktar", en: "Export" },
  copy: { tr: "Kopyala", en: "Copy" },
  copied: { tr: "Kopyalandı", en: "Copied" },
  download: { tr: "İndir", en: "Download" },
  import: { tr: "İçe aktar", en: "Import" },
  importHint: {
    tr: "JSON ya da BRAND_* satırları yapıştır.",
    en: "Paste JSON or BRAND_* lines.",
  },
  importRun: { tr: "Uygula", en: "Apply" },
  importFail: {
    tr: "Okunamadı: JSON ya da BRAND_* satırları bekleniyor.",
    en: "Could not read it: expected JSON or BRAND_* lines.",
  },
  imported: { tr: "alan alındı", en: "fields applied" },
  ignored: { tr: "geçersiz alan atlandı", en: "invalid fields skipped" },
  discard: { tr: "Taslağı sıfırla", en: "Reset draft" },
  empty: { tr: "Varsayılan", en: "Default" },
  upload: { tr: "Dosyadan yükle", en: "Upload file" },
  invalid: { tr: "Geçersiz değer", en: "Invalid value" },
  uploadErr: {
    tr: "PNG, JPEG, WebP veya GIF seçin (en çok 8 MB).",
    en: "Pick a PNG, JPEG, WebP or GIF (max 8 MB).",
  },
  noEntries: {
    tr: "Varsayılanlardan fark yok; çıktı boş.",
    en: "Nothing differs from the defaults; the output is empty.",
  },
} satisfies Record<string, Record<Lang, string>>;

const ROBOTS: readonly { value: Brand["robots"]; tr: string; en: string }[] = [
  {
    value: "index,follow",
    tr: "Dizine ekle ve bağlantıları izle",
    en: "Index and follow links",
  },
  {
    value: "index,nofollow",
    tr: "Dizine ekle, bağlantıları izleme",
    en: "Index, do not follow links",
  },
  {
    value: "noindex,follow",
    tr: "Dizine ekleme, bağlantıları izle",
    en: "Do not index, follow links",
  },
  { value: "noindex,nofollow", tr: "Hiçbir şey yapma", en: "Do nothing" },
];

/* ------------------------------------------------------------------ */
/* one field                                                           */
/* ------------------------------------------------------------------ */

function FieldEditor({
  k,
  value,
  lang,
  local,
  onCommit,
}: {
  k: keyof Brand;
  value: Value;
  lang: Lang;
  local: boolean;
  onCommit: (v: Value) => void;
}) {
  const info = BRAND_LABELS[k];
  const kind = FIELD_KIND[k];
  const [draft, setDraft] = useState(String(value));
  const [bad, setBad] = useState(false);
  const [uploadError, setUploadError] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const label = info[lang];
  const hint = lang === "tr" ? info.hintTr : info.hintEn;
  const uid = useId();
  const id = `${uid}-${k}`;

  const commit = (raw: string | number) => {
    const r = parseBrandPatch({ [k]: raw }, { allowData: local, only: [k] });
    const v = r.patch[k];
    if (v === undefined) {
      setBad(true);
      return;
    }
    setBad(false);
    onCommit(v);
  };
  const type = (raw: string) => {
    setDraft(raw);
    commit(raw);
  };

  let control;
  if (kind === "range") {
    const range =
      k === "radius"
        ? { min: 0, max: 1.5, step: 0.05 }
        : { min: 0.85, max: 1.3, step: 0.05 };
    control = (
      <div className="flex items-center gap-2">
        <RangeInput
          label={label}
          value={Number(value)}
          {...range}
          onChange={(n) => onCommit(n)}
        />
        <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
          {Number(value).toFixed(2)}
        </span>
      </div>
    );
  } else if (kind === "color") {
    const hex = /^#[0-9a-fA-F]{6}$/.test(draft) ? draft : "#000000";
    control = (
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={label}
          value={hex}
          onChange={(e) => type(e.target.value)}
          className="h-7 w-10 shrink-0 cursor-pointer rounded-md border bg-background p-0.5"
        />
        <input
          id={id}
          className={INPUT}
          value={draft}
          placeholder={
            OPTIONAL_COLORS.includes(k) ? TXT.empty[lang] : "#rrggbb"
          }
          aria-invalid={bad}
          maxLength={7}
          onChange={(e) => type(e.target.value)}
        />
        {OPTIONAL_COLORS.includes(k) && draft !== "" && (
          <button type="button" className={BTN} onClick={() => type("")}>
            ×
          </button>
        )}
      </div>
    );
  } else if (kind === "robots") {
    control = (
      <SelectInput
        value={String(value)}
        options={ROBOTS.map((o) => ({ value: o.value, label: o[lang] }))}
        onChange={(v) => onCommit(v as Value)}
      />
    );
  } else if (kind === "textarea") {
    control = (
      <textarea
        id={id}
        className={INPUT}
        rows={2}
        value={draft}
        aria-invalid={bad}
        onChange={(e) => type(e.target.value)}
      />
    );
  } else if (kind === "asset") {
    const showPreview = typeof value === "string" && value !== "" && !bad;
    control = (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          {showPreview && (
            <img
              src={String(value)}
              alt=""
              className="h-8 w-8 shrink-0 rounded border bg-secondary object-contain"
            />
          )}
          <input
            id={id}
            className={INPUT}
            value={draft.startsWith("data:") ? "(embedded image)" : draft}
            readOnly={draft.startsWith("data:")}
            placeholder="/brand/logo.png"
            aria-invalid={bad}
            onChange={(e) => type(e.target.value)}
          />
          {draft !== "" && (
            <button type="button" className={BTN} onClick={() => type("")}>
              ×
            </button>
          )}
        </div>
        {local && k === "logoUrl" && (
          <>
            <button
              type="button"
              className={BTN}
              onClick={() => fileRef.current?.click()}
            >
              {TXT.upload[lang]}
            </button>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept={LOGO_FILE_TYPES.join(",")}
              aria-label={label}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                setUploadError(false);
                void logoDataUrl(f).then(
                  (url) => {
                    setDraft(url);
                    commit(url);
                  },
                  () => setUploadError(true),
                );
              }}
            />
            {uploadError && (
              <p role="alert" className="text-[11px] text-destructive">
                {TXT.uploadErr[lang]}
              </p>
            )}
          </>
        )}
      </div>
    );
  } else {
    control = (
      <input
        id={id}
        className={INPUT}
        value={draft}
        aria-invalid={bad}
        onChange={(e) => type(e.target.value)}
      />
    );
  }

  return (
    <div className="text-xs">
      <label
        htmlFor={id}
        className="mb-1 block text-[11px] text-muted-foreground"
      >
        {label}
      </label>
      {control}
      {bad ? (
        <p role="alert" className="mt-0.5 text-[11px] text-destructive">
          {TXT.invalid[lang]}
        </p>
      ) : (
        hint && (
          <p className="mt-0.5 text-[11px] text-muted-foreground/80">{hint}</p>
        )
      )}
    </div>
  );
}

function Groups({
  keys,
  values,
  lang,
  local,
  nonce,
  onCommit,
}: {
  keys: readonly (keyof Brand)[];
  values: Brand;
  lang: Lang;
  local: boolean;
  nonce: number;
  onCommit: (k: keyof Brand, v: Value) => void;
}) {
  return (
    <div className="space-y-4">
      {BRAND_GROUPS.map((g) => {
        const ks = g.keys.filter((k) => keys.includes(k));
        if (ks.length === 0) return null;
        return (
          <fieldset key={g.id} className="space-y-3">
            <legend className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
              {g[lang]}
            </legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {ks.map((k) => (
                <div
                  key={`${k}-${nonce}`}
                  className={
                    FIELD_KIND[k] === "textarea" || FIELD_KIND[k] === "asset"
                      ? "sm:col-span-2"
                      : ""
                  }
                >
                  <FieldEditor
                    k={k}
                    value={values[k]}
                    lang={lang}
                    local={local}
                    onCommit={(v) => onCommit(k, v)}
                  />
                </div>
              ))}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* this browser                                                        */
/* ------------------------------------------------------------------ */

export function BrandLocalSection() {
  const lang = useContentLang();
  const { brand, local, setLocal, resetLocal } = useBrandControls();
  const [nonce, setNonce] = useState(0);
  const dirty = Object.keys(local).length > 0;
  return (
    <section className={PANEL} aria-label={TXT.localTitle[lang]}>
      <PanelTitle
        aside={
          <button
            className={BTN}
            disabled={!dirty}
            onClick={() => {
              resetLocal();
              setNonce((n) => n + 1);
            }}
          >
            {TXT.reset[lang]}
          </button>
        }
      >
        {TXT.localTitle[lang]}
      </PanelTitle>
      <p className="mb-3 text-xs text-muted-foreground">
        {TXT.localBody[lang]}
      </p>
      <Groups
        keys={LOCAL_KEYS}
        values={brand}
        lang={lang}
        local
        nonce={nonce}
        onCommit={(k, v) => setLocal({ [k]: v } as Partial<Brand>)}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* owner: site, share preview, export / import                         */
/* ------------------------------------------------------------------ */

function hostOf(siteUrl: string): string {
  try {
    return new URL(siteUrl).host;
  } catch {
    return "alan.adi";
  }
}

function SharePreview({ brand }: { brand: Brand }) {
  const lang = useContentLang();
  return (
    <div>
      <p className="mb-1 text-[11px] text-muted-foreground">
        {TXT.preview[lang]}
      </p>
      <div className="overflow-hidden rounded-lg border bg-background">
        <div className="flex aspect-[1200/630] w-full items-center justify-center bg-secondary text-xs text-muted-foreground">
          {brand.ogImage ? (
            <img
              src={brand.ogImage}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            "—"
          )}
        </div>
        <div className="space-y-0.5 p-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {hostOf(brand.siteUrl)}
          </p>
          <p className="truncate text-sm font-semibold">{brand.name}</p>
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {brand.description}
          </p>
        </div>
      </div>
    </div>
  );
}

export function BrandSiteSection() {
  const lang = useContentLang();
  const { server } = useBrandControls();
  const [draft, setDraft] = useState<Partial<Brand>>({});
  const [nonce, setNonce] = useState(0);
  const [format, setFormat] = useState<ExportFormat>("env");
  const [pasted, setPasted] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const next = useMemo(() => resolveBrand(server, draft), [server, draft]);
  const patch = useMemo(() => patchFromDefaults(next), [next]);
  const output = useMemo(() => exportBrand(patch, format), [patch, format]);
  const warnings = useMemo(() => checkBrand(next), [next]);
  const changed = Object.keys(draft).length > 0;

  const FILES: Record<ExportFormat, string> = {
    json: "brand.json",
    env: "brand.env",
    config: "config.ts",
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked: the text is selectable in the box below
    }
  };

  const run = () => {
    const r = importBrand(pasted);
    if (!r.ok) {
      setNote(TXT.importFail[lang]);
      return;
    }
    setDraft((d) => ({ ...d, ...r.patch }));
    setNonce((n) => n + 1);
    setNote(
      `${Object.keys(r.patch).length} ${TXT.imported[lang]}` +
        (r.rejected.length > 0
          ? ` · ${r.rejected.length} ${TXT.ignored[lang]} (${r.rejected.join(", ")})`
          : ""),
    );
  };

  return (
    <section className={PANEL} aria-label={TXT.siteTitle[lang]}>
      <PanelTitle
        aside={
          <button
            className={BTN}
            disabled={!changed}
            onClick={() => {
              setDraft({});
              setNonce((n) => n + 1);
              setNote(null);
            }}
          >
            {TXT.discard[lang]}
          </button>
        }
      >
        {TXT.siteTitle[lang]}
      </PanelTitle>
      <p className="mb-3 text-xs text-muted-foreground">{TXT.siteBody[lang]}</p>
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <Groups
          keys={BRAND_KEYS}
          values={next}
          lang={lang}
          local={false}
          nonce={nonce}
          onCommit={(k, v) => setDraft((d) => ({ ...d, [k]: v }))}
        />
        <aside className="space-y-4 lg:sticky lg:top-3 lg:self-start">
          <SharePreview brand={next} />
          <div>
            <p className="mb-1 text-[11px] text-muted-foreground">
              {TXT.checks[lang]}
            </p>
            {warnings.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {TXT.allGood[lang]}
              </p>
            ) : (
              <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                {warnings.map((w) => (
                  <li key={w}>{WARNING_TEXT[w][lang]}</li>
                ))}
              </ul>
            )}
          </div>
          <div className="space-y-2">
            <p className="text-[11px] text-muted-foreground">
              {TXT.export[lang]}
            </p>
            <div role="tablist" className="flex gap-1">
              {(["env", "json", "config"] as const).map((f) => (
                <button
                  key={f}
                  role="tab"
                  aria-selected={format === f}
                  className={format === f ? BTN_ACCENT : BTN}
                  onClick={() => setFormat(f)}
                >
                  {f === "env" ? ".env" : f === "json" ? "JSON" : "config.ts"}
                </button>
              ))}
            </div>
            <textarea
              readOnly
              aria-label={TXT.export[lang]}
              className={`${INPUT} h-40 font-mono text-[11px]`}
              value={output || `# ${TXT.noEntries[lang]}`}
              onFocus={(e) => e.currentTarget.select()}
            />
            <div className="flex gap-2">
              <button className={BTN} onClick={() => void copy()}>
                {copied ? TXT.copied[lang] : TXT.copy[lang]}
              </button>
              <button
                className={BTN}
                onClick={() =>
                  downloadBlob(
                    new Blob([output], { type: "text/plain;charset=utf-8" }),
                    FILES[format],
                  )
                }
              >
                {TXT.download[lang]}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-[11px] text-muted-foreground">
              {TXT.import[lang]} — {TXT.importHint[lang]}
            </p>
            <textarea
              aria-label={TXT.import[lang]}
              className={`${INPUT} h-20 font-mono text-[11px]`}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
            />
            <button className={BTN} disabled={!pasted.trim()} onClick={run}>
              {TXT.importRun[lang]}
            </button>
            {note && (
              <p role="status" className="text-[11px] text-muted-foreground">
                {note}
              </p>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
