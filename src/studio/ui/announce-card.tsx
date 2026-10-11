// src/studio/ui/announce-card.tsx
// "Announce my stream": prepares the text and opens each platform's own share dialog. Nothing is
// posted by the studio and no API key is involved.
import { useEffect, useMemo, useState } from "react";

import {
  SHARE_TARGETS,
  announcementText,
  isHttpUrl,
  shareUrl,
  type AnnounceLang,
} from "../community/share";
import { BTN, BTN_ACCENT, INPUT, PANEL, PanelTitle } from "./fields";

const KEY = "tkz.announce.v1";

interface Saved {
  title: string;
  url: string;
  hashtags: string;
  lang: AnnounceLang;
}

function load(): Saved {
  const def: Saved = { title: "", url: "", hashtags: "teknodoz", lang: "tr" };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return def;
    const p = JSON.parse(raw) as Partial<Record<keyof Saved, unknown>>;
    return {
      title: typeof p.title === "string" ? p.title.slice(0, 140) : "",
      url: typeof p.url === "string" ? p.url.slice(0, 600) : "",
      hashtags:
        typeof p.hashtags === "string"
          ? p.hashtags.slice(0, 200)
          : def.hashtags,
      lang: p.lang === "en" ? "en" : "tr",
    };
  } catch {
    return def;
  }
}

export function AnnounceCard({ live = false }: { live?: boolean }) {
  const [s, setS] = useState<Saved>({
    title: "",
    url: "",
    hashtags: "teknodoz",
    lang: "tr",
  });
  const [when, setWhen] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => setS(load()), []);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      // not remembered
    }
  }, [s]);

  const urlOk = isHttpUrl(s.url);
  const text = useMemo(
    () =>
      announcementText({
        title: s.title,
        url: s.url || "https://…",
        lang: s.lang,
        hashtags: s.hashtags,
        ...(live ? {} : { when }),
      }),
    [s, when, live],
  );
  const input = { url: s.url, text, title: s.title || "Canlı yayın" };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // the text area below is selectable as a fallback
    }
  };

  return (
    <section className={PANEL} id="duyuru" aria-label="Yayın duyurusu">
      <PanelTitle>
        {live ? "Yayını duyur" : "Yayın duyurusu hazırla"}
      </PanelTitle>
      <p className="mb-2 text-[11px] text-muted-foreground">
        Metni hazırlar, her platformun kendi paylaşım penceresini açar; hiçbir
        şey sizin onayınız olmadan paylaşılmaz ve API anahtarı gerekmez.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs sm:col-span-2">
          <span className="mb-1 block text-muted-foreground">
            Yayın başlığı
          </span>
          <input
            className={INPUT}
            maxLength={140}
            value={s.title}
            onChange={(e) => setS({ ...s, title: e.target.value })}
          />
        </label>
        <label className="text-xs sm:col-span-2">
          <span className="mb-1 block text-muted-foreground">
            İzleme bağlantısı{" "}
            {live && "(YouTube/Facebook… yayın sayfanızın adresi)"}
          </span>
          <input
            className={`${INPUT} font-mono`}
            inputMode="url"
            placeholder="https://"
            value={s.url}
            onChange={(e) => setS({ ...s, url: e.target.value })}
            aria-invalid={s.url !== "" && !urlOk}
          />
        </label>
        {!live && (
          <label className="text-xs">
            <span className="mb-1 block text-muted-foreground">
              Tarih ve saat (isteğe bağlı)
            </span>
            <input
              className={INPUT}
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
          </label>
        )}
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">Etiketler</span>
          <input
            className={INPUT}
            value={s.hashtags}
            onChange={(e) => setS({ ...s, hashtags: e.target.value })}
          />
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">Dil</span>
          <select
            className={INPUT}
            value={s.lang}
            onChange={(e) =>
              setS({ ...s, lang: e.target.value === "en" ? "en" : "tr" })
            }
          >
            <option value="tr">Türkçe</option>
            <option value="en">English</option>
          </select>
        </label>
      </div>

      <pre
        className="mt-2 whitespace-pre-wrap break-words rounded-md bg-secondary p-2 font-sans text-xs"
        aria-label="Duyuru metni"
      >
        {text}
      </pre>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {SHARE_TARGETS.map((t) => {
          const href = urlOk ? shareUrl(t.id, input) : null;
          return href ? (
            <a
              key={t.id}
              className={BTN}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              title={
                t.carries === "url-only"
                  ? "Bu platform yalnızca bağlantıyı alır; metni kendiniz ekleyin."
                  : undefined
              }
            >
              {t.icon} {t.name}
            </a>
          ) : (
            <span
              key={t.id}
              className={`${BTN} cursor-not-allowed opacity-50`}
              aria-disabled="true"
            >
              {t.icon} {t.name}
            </span>
          );
        })}
        <button className={BTN_ACCENT} onClick={() => void copy()}>
          {copied ? "✓ Kopyalandı" : "Metni kopyala (Slack, Discord, grup…)"}
        </button>
      </div>
      {!urlOk && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Paylaşım düğmeleri için geçerli bir http(s) bağlantısı girin.
        </p>
      )}
    </section>
  );
}
