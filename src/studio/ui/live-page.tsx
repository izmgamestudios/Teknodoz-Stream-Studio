// src/studio/ui/live-page.tsx
// /live: go live to YouTube, Facebook, Twitch, Kick, Instagram, TikTok or any RTMP(S) ingest.
// The browser records the program output and sends it to the server bridge (ffmpeg -> RTMPS).
import { useEffect, useMemo, useRef, useState } from "react";

import { LiveApiError, createLiveApi, type LiveStatus } from "../live/api";
import { describeApiError, describeCode } from "../live/messages";
import { QUALITIES, getQuality } from "../live/platforms";
import {
  loadLiveSettings,
  loadToken,
  saveLiveSettings,
  saveToken,
  type LiveSettings,
} from "../live/settings";
import { useLive, useStudio } from "../runtime/use-studio";
import {
  BTN,
  BTN_ACCENT,
  BTN_PRIMARY,
  Check,
  INPUT,
  PANEL,
  PanelTitle,
} from "./fields";
import { AnnounceCard } from "./announce-card";
import { DestinationsCard } from "./live-destinations";
import { LiveStatusCard } from "./live-status";

type Server = "checking" | "unavailable" | "disabled" | "ready";

function useServer(): Server {
  const [s, setS] = useState<Server>("checking");
  useEffect(() => {
    let off = false;
    createLiveApi()
      .health()
      .then((r) => !off && setS(r.enabled ? "ready" : "disabled"))
      .catch(() => !off && setS("unavailable"));
    return () => {
      off = true;
    };
  }, []);
  return s;
}

function Preview() {
  const rt = useStudio();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    rt.mountCanvas(el);
    return () => rt.unmountCanvas(el);
  }, [rt]);
  return (
    <div
      ref={ref}
      className="relative aspect-video w-full overflow-hidden rounded-lg border bg-black"
      aria-label="Program önizlemesi"
    />
  );
}

const SETUP = `# sunucuda (CloudPanel / SSH)
sudo apt install -y ffmpeg
export LIVE_ADMIN_TOKEN="$(openssl rand -hex 24)"   # en az 16 karakter
# pm2 ile başlatırken ortama ekleyin, sonra bu sayfaya aynı değeri girin`;

export function LiveApp() {
  const rt = useStudio();
  const snap = useLive();
  const server = useServer();
  const [settings, setSettings] = useState<LiveSettings>(() =>
    loadLiveSettings(),
  );
  const [{ token, remember }, setTok] = useState(() => loadToken());
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => saveLiveSettings(settings), [settings]);

  const busy =
    snap.phase === "starting" ||
    snap.phase === "live" ||
    snap.phase === "stopping";
  useEffect(() => {
    if (!busy) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [busy]);

  const connect = async () => {
    setConnecting(true);
    setConnectError(null);
    try {
      const st = await createLiveApi().status(token.trim());
      saveToken(token.trim(), remember);
      setStatus(st);
    } catch (e) {
      setStatus(null);
      setConnectError(
        e instanceof LiveApiError ? describeApiError(e) : "Bağlanılamadı.",
      );
    } finally {
      setConnecting(false);
    }
  };

  // reconnect automatically when a token was remembered
  const auto = useRef(false);
  useEffect(() => {
    if (server === "ready" && token && !auto.current) {
      auto.current = true;
      void connect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server]);

  const quality = getQuality(settings.quality);
  const usable = useMemo(
    () =>
      settings.dests.filter(
        (d) => d.enabled && d.server.trim() && d.key.trim(),
      ),
    [settings.dests],
  );
  const kbpsTooHigh = status
    ? quality.kbps > status.limits.maxVideoKbps
    : false;
  const canStart =
    status !== null &&
    status.ffmpeg.ok &&
    usable.length > 0 &&
    !kbpsTooHigh &&
    (snap.phase === "idle" || snap.phase === "ended" || snap.phase === "error");

  const start = async () => {
    rt.live.reset();
    await rt.live.start({
      token: token.trim(),
      quality,
      destinations: usable.map((d) => ({
        label: d.label,
        server: d.server.trim(),
        key: d.key.trim(),
      })),
    });
    // pick up the (possibly new) server state
    void connect();
  };

  return (
    <div className="min-h-screen p-3 md:p-6">
      <header className="mx-auto mb-4 max-w-6xl">
        <p className="text-xs uppercase tracking-[0.3em] text-speaker-b">
          Teknodoz · DozLive
        </p>
        <h1 className="mt-1 text-3xl font-bold">Canlı yayın (RTMPS)</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Program çıkışınızı YouTube, Facebook, Twitch, Kick, Instagram, TikTok
          veya herhangi bir RTMP(S) sunucusuna gönderin. Tarayıcı RTMP
          konuşamadığı için görüntü, sizin sunucunuzdaki ffmpeg köprüsünden
          geçer; <b>üçüncü taraf bir servis yoktur</b>. Anahtarlar yalnızca
          tarayıcınız ve kendi sunucunuz arasında dolaşır.
        </p>
      </header>

      <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          {server === "checking" && (
            <section className={PANEL}>
              <p className="text-sm text-muted-foreground">
                Sunucu denetleniyor…
              </p>
            </section>
          )}

          {(server === "unavailable" || server === "disabled") && (
            <section className={PANEL} aria-label="Sunucu kurulumu">
              <PanelTitle>Sunucu köprüsü hazır değil</PanelTitle>
              <p role="alert" className="mb-2 text-sm text-primary">
                {describeCode(server)}
              </p>
              <p className="mb-2 text-xs text-muted-foreground">
                Bu özellik gizli bir <b>operatör anahtarı</b> ve sunucuda{" "}
                <b>ffmpeg</b> ister; varsayılan olarak kapalıdır. Kurulum
                (ayrıntılar: <code>docs/LIVE.md</code>):
              </p>
              <pre className="overflow-x-auto rounded-md bg-secondary p-2 font-mono text-[11px]">
                {SETUP}
              </pre>
            </section>
          )}

          {server === "ready" && (
            <section className={PANEL} aria-label="Operatör girişi">
              <PanelTitle
                aside={
                  status && (
                    <span className="text-[11px] text-muted-foreground">
                      {status.ffmpeg.ok
                        ? `● ffmpeg ${status.ffmpeg.version ?? ""}`
                        : "○ ffmpeg yok"}
                    </span>
                  )
                }
              >
                Operatör girişi
              </PanelTitle>
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void connect();
                }}
              >
                <label className="min-w-0 flex-1 text-xs">
                  <span className="mb-1 block text-muted-foreground">
                    Operatör anahtarı (LIVE_ADMIN_TOKEN)
                  </span>
                  <input
                    className={`${INPUT} font-mono`}
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={token}
                    onChange={(e) =>
                      setTok({ token: e.target.value, remember })
                    }
                  />
                </label>
                <button
                  className={BTN_ACCENT}
                  type="submit"
                  disabled={connecting || token.trim().length < 8}
                >
                  {connecting ? "Bağlanıyor…" : status ? "Yenile" : "Bağlan"}
                </button>
              </form>
              <div className="mt-2">
                <Check
                  checked={remember}
                  onChange={(r) => setTok({ token, remember: r })}
                >
                  <span className="text-[11px]">
                    Bu tarayıcıda hatırla (kapalıyken yalnızca bu sekme boyunca)
                  </span>
                </Check>
              </div>
              {connectError && (
                <p role="alert" className="mt-2 text-xs text-destructive">
                  {connectError}
                </p>
              )}
              {status && !status.ffmpeg.ok && (
                <p role="alert" className="mt-2 text-xs text-destructive">
                  {describeCode("ffmpeg-missing")}
                </p>
              )}
              {status?.session && !busy && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-primary/50 p-2 text-xs">
                  <span>
                    Sunucuda açık bir yayın var ({status.session.state}) →{" "}
                    {status.session.destinations.map((d) => d.host).join(", ")}
                  </span>
                  <button
                    className={BTN}
                    onClick={async () => {
                      await rt.live.stopRemote(
                        token.trim(),
                        status.session?.id ?? "",
                      );
                      void connect();
                    }}
                  >
                    O yayını durdur
                  </button>
                </div>
              )}
            </section>
          )}

          <DestinationsCard
            dests={settings.dests}
            token={token.trim()}
            locked={busy}
            rememberKeys={settings.rememberKeys}
            onChange={(dests) => setSettings((s) => ({ ...s, dests }))}
            onRememberKeys={(rememberKeys) =>
              setSettings((s) => ({ ...s, rememberKeys }))
            }
          />

          <section className={PANEL} aria-label="Kalite">
            <PanelTitle>Kalite</PanelTitle>
            <select
              className={INPUT}
              value={settings.quality}
              disabled={busy}
              aria-label="Yayın kalitesi"
              onChange={(e) =>
                setSettings((s) => ({ ...s, quality: e.target.value }))
              }
            >
              {QUALITIES.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {quality.hint}. Sunucu görüntüyü yeniden kodlar (H.264 + AAC);
              yükleme hızınız bit hızının en az 1,5 katı olmalı.
              {kbpsTooHigh && status && (
                <span className="text-destructive">
                  {" "}
                  Bu kalite sunucu sınırını ({status.limits.maxVideoKbps} kbps)
                  aşıyor.
                </span>
              )}
            </p>
          </section>
        </div>

        <div className="space-y-4">
          <section className={PANEL} aria-label="Program">
            <PanelTitle>Program çıkışı</PanelTitle>
            <Preview />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Sahneyi Stüdyo sayfasında hazırlayın; yayın sırasında başka
              sayfalara geçebilirsiniz.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {snap.phase === "live" || snap.phase === "starting" ? (
                <button
                  className="inline-flex flex-1 items-center justify-center rounded-md bg-destructive px-4 py-2 text-sm font-bold text-primary-foreground"
                  onClick={() => void rt.live.stop().then(() => connect())}
                >
                  ■ Yayını bitir
                </button>
              ) : (
                <button
                  className={`${BTN_PRIMARY} flex-1 justify-center`}
                  disabled={!canStart}
                  onClick={() => void start()}
                >
                  ● Canlı yayına çık
                </button>
              )}
            </div>
            {!canStart &&
              snap.phase !== "live" &&
              snap.phase !== "starting" && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {server !== "ready"
                    ? "Önce sunucu köprüsünü kurun."
                    : !status
                      ? "Önce operatör anahtarıyla bağlanın."
                      : usable.length === 0
                        ? "En az bir hedef için sunucu adresi ve yayın anahtarı girin."
                        : null}
                </p>
              )}
          </section>
          <LiveStatusCard snap={snap} />
          {(snap.phase === "live" || snap.phase === "ended") && (
            <AnnounceCard live />
          )}
        </div>
      </div>
    </div>
  );
}
