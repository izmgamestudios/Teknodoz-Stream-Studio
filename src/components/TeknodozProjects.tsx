// src/components/TeknodozProjects.tsx
import { useEffect, useState, type FormEvent } from "react";

export const PROJECTS_API = "https://teknodoz-projects.ortakofis.org";

export type ProjectItem = {
  id: string;
  name: string;
  description: string;
  tag: "open-source" | "private";
  locked: boolean;
  url?: string;
  repo?: string;
};

const httpsOnly = (value: string | undefined) => {
  try {
    return value && new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
};

function SafeLink({
  href,
  children,
}: {
  href?: string | undefined;
  children: string;
}) {
  const safe = httpsOnly(href);
  return safe ? (
    <a href={safe} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ) : (
    <span>{children}</span>
  );
}

function PrivateProject({ project }: { project: ProjectItem }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!password) return;
    setMessage("");
    try {
      const res = await fetch(`${PROJECTS_API}/v1/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: project.id, password }),
      });
      setPassword("");
      if (res.status === 429)
        return setMessage("Çok fazla deneme. Biraz bekle.");
      if (!res.ok) return setMessage("Şifre hatalı.");
      const safe = httpsOnly(((await res.json()) as { url?: string }).url);
      if (safe) window.open(safe, "_blank", "noopener,noreferrer");
    } catch {
      setMessage("Liste şu an yüklenemedi.");
    }
  }

  return (
    <>
      <button
        type="button"
        className="tdp-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        🔒 Şifreyle aç
      </button>
      {open && (
        <form className="tdp-form" onSubmit={submit}>
          <input
            type="password"
            autoComplete="off"
            maxLength={200}
            placeholder="Şifre"
            aria-label={`${project.name} şifre`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
          <button type="submit">Aç</button>
          {message && (
            <p className="tdp-msg" role="status">
              {message}
            </p>
          )}
        </form>
      )}
    </>
  );
}

/** "Diğer Teknodoz Projeleri": open-source projects link out, private ones need the sheet password. */
export function TeknodozProjects({ current }: { current: string }) {
  const [projects, setProjects] = useState<ProjectItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(
      `${PROJECTS_API}/v1/projects?current=${encodeURIComponent(current)}`,
      { signal: controller.signal },
    )
      .then((res) =>
        res.ok ? res.json() : Promise.reject(new Error(String(res.status))),
      )
      .then((data: { projects: ProjectItem[] }) => setProjects(data.projects))
      .catch((err: Error) => {
        if (err.name !== "AbortError") setFailed(true);
      });
    return () => controller.abort();
  }, [current]);

  return (
    <section className="tdp" aria-label="Diğer Teknodoz Projeleri">
      <h2 className="tdp-title">Diğer Teknodoz Projeleri</h2>
      {failed && <p className="tdp-msg">Liste şu an yüklenemedi.</p>}
      <ul className="tdp-list">
        {projects?.map((p) => (
          <li className="tdp-item" key={p.id}>
            <div className="tdp-head">
              {p.locked ? (
                <span className="tdp-name">{p.name}</span>
              ) : (
                <SafeLink href={p.url}>{p.name}</SafeLink>
              )}
              <span
                className={
                  p.locked ? "tdp-tag tdp-private" : "tdp-tag tdp-open"
                }
              >
                {p.locked ? "Özel" : "Açık Kaynak"}
              </span>
            </div>
            {p.description && <div className="tdp-desc">{p.description}</div>}
            {!p.locked && p.repo && (
              <div className="tdp-desc">
                <SafeLink href={p.repo}>Kaynak kodu</SafeLink>
              </div>
            )}
            {p.locked && <PrivateProject project={p} />}
          </li>
        ))}
      </ul>
    </section>
  );
}
