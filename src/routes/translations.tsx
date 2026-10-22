// src/routes/translations.tsx
// Creator-side editor for the texts of every language. Edits are stored on the server
// (PocketBase or JSON file) and override the built-in messages for all visitors immediately.
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import { titleFromMatches } from "@/studio/branding/head";
import {
  LANGS,
  MESSAGES,
  tr,
  type Lang,
  type MessageKey,
} from "@/studio/i18n/messages";
import { getOverrides, loadOverrides } from "@/studio/i18n/overrides";
import { useT } from "@/studio/i18n/use-t";
import {
  BTN,
  BTN_ACCENT,
  Check,
  INPUT,
  INPUT_AUTO,
  PANEL,
  PanelTitle,
} from "@/studio/ui/fields";
import { readAdminToken, saveAdminToken } from "@/studio/watch/admin-token";
import { fold } from "@/studio/watch/filter";

export const Route = createFileRoute("/translations")({
  head: ({ matches }) => ({
    meta: [
      { title: titleFromMatches(matches, "Translations") },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TranslationsPage,
});

const KEYS = Object.keys(tr) as MessageKey[];
const PAGE = 40;

async function put(
  token: string,
  lang: Lang,
  key: string,
  value: string,
): Promise<"ok" | "placeholder" | "error"> {
  try {
    const res = await fetch(`/api/i18n/${lang}/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ value }),
    });
    if (res.ok) return "ok";
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return body.error === "placeholder-mismatch" ? "placeholder" : "error";
  } catch {
    return "error";
  }
}

async function del(token: string, lang: Lang, key: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/i18n/${lang}/${encodeURIComponent(key)}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

function TranslationsPage() {
  const t = useT();
  const [token, setToken] = useState("");
  const [typed, setTyped] = useState("");
  const [lang, setLang] = useState<Lang>("de");
  const [text, setText] = useState("");
  const [changedOnly, setChangedOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, string>>({});
  const [, bump] = useState(0);

  useEffect(() => {
    const tk = readAdminToken();
    if (tk) setToken(tk);
    void loadOverrides().then(() => bump((n) => n + 1));
  }, []);

  const overrides = getOverrides()[lang] ?? {};
  const rows = useMemo(() => {
    const q = fold(text);
    return KEYS.filter((k) => {
      if (changedOnly && overrides[k] === undefined) return false;
      if (!q) return true;
      return fold(
        `${k} ${tr[k]} ${MESSAGES[lang][k]} ${overrides[k] ?? ""}`,
      ).includes(q);
    });
    // overrides is read fresh from the store on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, changedOnly, lang, getOverrides()]);

  const save = useCallback(
    async (key: MessageKey) => {
      const value = drafts[key];
      if (value === undefined) return;
      const r = await put(token, lang, key, value);
      if (r === "ok") {
        await loadOverrides();
        setDrafts((d) => {
          const { [key]: _gone, ...rest } = d;
          return rest;
        });
        setStatus((s) => ({ ...s, [`${lang}:${key}`]: "tr.saved" }));
        bump((n) => n + 1);
      } else
        setStatus((s) => ({
          ...s,
          [`${lang}:${key}`]:
            r === "placeholder" ? "tr.err.placeholder" : "tr.err.save",
        }));
    },
    [drafts, lang, token],
  );

  const reset = async (key: MessageKey) => {
    if (await del(token, lang, key)) {
      await loadOverrides();
      setDrafts((d) => {
        const { [key]: _gone, ...rest } = d;
        return rest;
      });
      setStatus((s) => ({ ...s, [`${lang}:${key}`]: "tr.saved" }));
      bump((n) => n + 1);
    } else setStatus((s) => ({ ...s, [`${lang}:${key}`]: "tr.err.save" }));
  };

  return (
    <div className="min-h-screen p-3 md:p-6">
      <header className="mx-auto mb-4 max-w-5xl">
        <h1 className="text-3xl font-bold">{t("tr.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("tr.intro")}</p>
      </header>

      <div className="mx-auto max-w-5xl space-y-4">
        {!token ? (
          <section className={PANEL}>
            <PanelTitle>{t("catalog.token")}</PanelTitle>
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                saveAdminToken(typed);
                setToken(typed);
              }}
            >
              <input
                type="password"
                autoComplete="off"
                className={`${INPUT} min-w-0 flex-1`}
                aria-label={t("catalog.token")}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
              />
              <button className={BTN_ACCENT} disabled={typed.length < 16}>
                {t("catalog.connect")}
              </button>
            </form>
            <p className="mt-2 text-xs text-muted-foreground">
              {t("catalog.token.note")}
            </p>
          </section>
        ) : (
          <>
            <section className={`${PANEL} flex flex-wrap items-center gap-2`}>
              <label className="flex items-center gap-2 text-sm">
                {t("tr.lang")}
                <select
                  className={INPUT_AUTO}
                  value={lang}
                  onChange={(e) => {
                    setLang(e.target.value as Lang);
                    setLimit(PAGE);
                  }}
                >
                  {LANGS.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>
              <input
                type="search"
                className={`${INPUT_AUTO} min-w-0 flex-1 basis-56`}
                placeholder={t("tr.search")}
                aria-label={t("tr.search")}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setLimit(PAGE);
                }}
              />
              <Check checked={changedOnly} onChange={setChangedOnly}>
                {t("tr.onlyChanged")}
              </Check>
              <span
                className="text-xs text-muted-foreground"
                aria-live="polite"
              >
                {t("tr.count", { n: rows.length })}
              </span>
            </section>

            <ul className="space-y-3">
              {rows.slice(0, limit).map((k) => {
                const changed = overrides[k] !== undefined;
                const shown = drafts[k] ?? overrides[k] ?? MESSAGES[lang][k];
                const st = status[`${lang}:${k}`];
                const dirty =
                  drafts[k] !== undefined &&
                  drafts[k] !== (overrides[k] ?? MESSAGES[lang][k]);
                return (
                  <li key={k} className={PANEL}>
                    <p className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
                      {k}
                      {changed && (
                        <span className="rounded bg-speaker-b px-1.5 py-0.5 font-sans text-[10px] font-bold text-background">
                          {t("tr.changed")}
                        </span>
                      )}
                    </p>
                    {lang !== "tr" && (
                      <p className="mt-1 text-xs">
                        <span className="text-muted-foreground">
                          {t("tr.source")}:{" "}
                        </span>
                        {tr[k]}
                      </p>
                    )}
                    <textarea
                      className={`${INPUT} mt-2`}
                      rows={Math.min(
                        5,
                        Math.max(1, Math.ceil(shown.length / 90)),
                      )}
                      lang={lang}
                      aria-label={`${k} (${lang})`}
                      value={shown}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [k]: e.target.value }))
                      }
                    />
                    {changed && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {t("tr.builtin")}: {MESSAGES[lang][k]}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        className={BTN_ACCENT}
                        disabled={!dirty}
                        onClick={() => void save(k)}
                      >
                        {t("tr.save")}
                      </button>
                      {changed && (
                        <button className={BTN} onClick={() => void reset(k)}>
                          {t("tr.reset")}
                        </button>
                      )}
                      {st && (
                        <span
                          role="status"
                          className={`text-xs ${st === "tr.saved" ? "text-muted-foreground" : "text-destructive"}`}
                        >
                          {t(st as MessageKey)}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            {rows.length > limit && (
              <button className={BTN} onClick={() => setLimit((n) => n + PAGE)}>
                {t("tr.more")}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
