// src/studio/ui/chat-panels.tsx
// Room chat UI: the moderation desk (director / editor), the editor-link card and the
// participant chat box. All text is rendered as plain text (never innerHTML).
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";

import type { MessageKey } from "../i18n/messages";
import { useT } from "../i18n/use-t";
import { RoomApiError, type ChatMessage, type ChatMode } from "../room/api";
import {
  EMPTY_CHAT,
  type ChatSnapshot,
  type RoomChatClient,
} from "../room/chat-client";
import { useRoom, useStudio } from "../runtime/use-studio";
import { BTN, BTN_ACCENT, INPUT, PANEL, PanelTitle } from "./fields";
import { QrImage } from "./qr-image";

const noopSubscribe = () => () => undefined;

export function useChatSnapshot(chat: RoomChatClient | null): ChatSnapshot {
  return useSyncExternalStore(
    chat ? chat.subscribe : noopSubscribe,
    chat ? chat.getSnapshot : () => EMPTY_CHAT,
    () => EMPTY_CHAT,
  );
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ------------------------------------------------------------------ */
/* Moderation desk (director + editor)                                  */
/* ------------------------------------------------------------------ */

type Tab = "pending" | "approved" | "rejected";

const TAB_LABEL: Record<Tab, string> = {
  pending: "Bekleyen",
  approved: "Onaylı",
  rejected: "Reddedilen",
};

const MODE_LABEL: Record<ChatMode, string> = {
  moderated: "Onaylı (önce onay)",
  open: "Serbest (anında yayın)",
  off: "Kapalı",
};

const ROLE_LABEL: Record<ChatMessage["role"], string> = {
  guest: "konuk",
  viewer: "izleyici",
  reji: "reji",
  editor: "editör",
};

function errText(e: unknown): string {
  if (e instanceof RoomApiError) {
    if (e.detail === "rate-limited") return "Çok hızlı, biraz bekleyin.";
    if (e.code === "forbidden") return "Bu işlem için yetkiniz yok.";
    if (e.code === "closed") return "Oda kapandı.";
    return `İşlem başarısız (${e.detail ?? e.code}).`;
  }
  return "İşlem başarısız.";
}

export function ModerationDesk({
  chat,
  director,
  onMode,
}: {
  chat: RoomChatClient;
  /** director may put messages on air and change the chat mode */
  director: boolean;
  onMode?: (mode: ChatMode) => Promise<void>;
}) {
  const snap = useChatSnapshot(chat);
  const [tab, setTab] = useState<Tab>("pending");
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(
    null,
  );
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errText(e));
    }
  };

  const count = (s: Tab) => snap.messages.filter((m) => m.status === s).length;
  const rows = snap.messages.filter((m) => m.status === tab);
  const ordered = tab === "pending" ? rows : [...rows].reverse();

  const say = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    void run(async () => {
      await chat.post(text);
      setDraft("");
    });
  };

  const live = snap.status === "live";
  return (
    <section className={PANEL} aria-label="Sohbet masası">
      <PanelTitle
        aside={
          <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
            {snap.status === "offline" && "○ bağlantı koptu"}
            {snap.status === "denied" && "yetki yok / anahtar iptal"}
            {snap.status === "closed" && "oda kapandı"}
            {live && `● ${director ? "reji" : "editör"}`}
          </span>
        }
      >
        Sohbet · {director ? "reji" : "editör"} masası
      </PanelTitle>

      {director && onMode && (
        <label className="mb-2 flex items-center gap-2 text-xs">
          Mod
          <select
            className={INPUT}
            value={snap.mode}
            onChange={(e) => void run(() => onMode(e.target.value as ChatMode))}
          >
            {(Object.keys(MODE_LABEL) as ChatMode[]).map((m) => (
              <option key={m} value={m}>
                {MODE_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
      )}
      {!director && (
        <p className="mb-2 text-[11px] text-muted-foreground">
          Mod: {MODE_LABEL[snap.mode]}. Mesajları onaylayabilir, düzenleyebilir
          veya reddedebilirsiniz; yayına almak rejinin işidir.
        </p>
      )}

      {snap.onAir && (
        <div className="mb-2 rounded-md border border-primary/60 bg-primary/10 p-2 text-sm">
          <span className="mr-2 rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
            YAYINDA
          </span>
          <b>{snap.onAir.author}:</b> {snap.onAir.text}
          {director && (
            <button
              className={`${BTN} ml-2`}
              onClick={() =>
                void run(() => chat.moderate(snap.onAir?.id ?? 0, "offair"))
              }
            >
              Yayından al
            </button>
          )}
        </div>
      )}

      <div role="tablist" className="mb-2 flex gap-1">
        {(Object.keys(TAB_LABEL) as Tab[]).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            className={`${BTN} ${tab === k ? "!border-speaker-b/60 !bg-speaker-b/10" : ""}`}
            onClick={() => setTab(k)}
          >
            {TAB_LABEL[k]} ({count(k)})
          </button>
        ))}
      </div>

      <ul className="max-h-96 space-y-1.5 overflow-y-auto" aria-live="polite">
        {ordered.length === 0 && (
          <li className="text-xs text-muted-foreground">
            {tab === "pending"
              ? "Onay bekleyen mesaj yok."
              : "Bu listede mesaj yok."}
          </li>
        )}
        {ordered.map((m) => (
          <li
            key={m.id}
            className={`rounded-md border p-2 text-sm ${snap.onAir?.id === m.id ? "border-primary/60" : ""}`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-semibold">
                {m.author}
                <span className="ml-1.5 text-[10px] font-normal uppercase text-muted-foreground">
                  {ROLE_LABEL[m.role]} · {clock(m.at)}
                  {m.edited && " · düzenlendi"}
                </span>
              </span>
              <span className="flex flex-wrap gap-1">
                {m.status !== "approved" && (
                  <button
                    className={BTN_ACCENT}
                    onClick={() =>
                      void run(() => chat.moderate(m.id, "approve"))
                    }
                  >
                    ✓ Onayla
                  </button>
                )}
                {director &&
                  m.status === "approved" &&
                  snap.onAir?.id !== m.id && (
                    <button
                      className={BTN_ACCENT}
                      onClick={() =>
                        void run(() => chat.moderate(m.id, "onair"))
                      }
                    >
                      📺 Yayına al
                    </button>
                  )}
                {m.status !== "rejected" && (
                  <button
                    className={BTN}
                    onClick={() =>
                      void run(() => chat.moderate(m.id, "reject"))
                    }
                  >
                    {m.status === "approved" ? "Gizle" : "✕ Reddet"}
                  </button>
                )}
                <button
                  className={BTN}
                  onClick={() => setEditing({ id: m.id, text: m.text })}
                >
                  ✎
                </button>
              </span>
            </div>
            {editing?.id === m.id ? (
              <form
                className="mt-1.5 flex gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  const text = editing.text;
                  void run(async () => {
                    await chat.moderate(m.id, "edit", text);
                    setEditing(null);
                  });
                }}
              >
                <input
                  autoFocus
                  className={INPUT}
                  maxLength={280}
                  value={editing.text}
                  onChange={(e) =>
                    setEditing({ id: m.id, text: e.target.value })
                  }
                />
                <button className={BTN_ACCENT} type="submit">
                  Kaydet
                </button>
                <button
                  className={BTN}
                  type="button"
                  onClick={() => setEditing(null)}
                >
                  Vazgeç
                </button>
              </form>
            ) : (
              <p className="mt-0.5 whitespace-pre-wrap break-words">{m.text}</p>
            )}
          </li>
        ))}
      </ul>

      <form className="mt-3 flex gap-1.5" onSubmit={say}>
        <input
          className={INPUT}
          maxLength={280}
          placeholder={`${director ? "Reji" : "Editör"} olarak yaz (anında onaylı)…`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Duyuru mesajı"
        />
        <button className={BTN_ACCENT} type="submit" disabled={!live}>
          Gönder
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Director: editor link                                                */
/* ------------------------------------------------------------------ */

export function EditorLinkCard() {
  const rt = useStudio();
  const room = useRoom();
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  if (room.status !== "open") return null;
  const link = rt.room.editorLink();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // the input is selectable as a fallback
    }
  };

  return (
    <section className={PANEL} aria-label="Editör bağlantısı">
      <PanelTitle>Editör bağlantısı</PanelTitle>
      <p className="mb-2 text-[11px] text-muted-foreground">
        Sohbet editörü bu bağlantıyla ayrı bir cihazdan mesajları onaylar,
        düzenler veya reddeder. Yayına almak yalnızca sizdedir. Anahtar adres
        çubuğundaki <code>#k=…</code> kısmındadır; sunucuya gönderilmez ve
        “Yenile” ile eski bağlantı iptal olur.
      </p>
      {link ? (
        <div className="space-y-2">
          <input
            readOnly
            className={`${INPUT} font-mono`}
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Editör bağlantısı"
          />
          <div className="flex flex-wrap gap-1.5">
            <button className={BTN} onClick={() => void copy()}>
              {copied ? "✓ Kopyalandı" : "Kopyala"}
            </button>
            <button
              className={BTN}
              aria-pressed={showQr}
              onClick={() => setShowQr((v) => !v)}
            >
              QR
            </button>
            <button
              className={BTN}
              onClick={() => {
                if (
                  window.confirm(
                    "Yeni anahtar üretilsin mi? Eski editör bağlantısı çalışmaz.",
                  )
                )
                  void rt.room.issueEditorKey();
              }}
            >
              Yenile
            </button>
            <button
              className={BTN}
              onClick={() => void rt.room.revokeEditorKey()}
            >
              İptal et
            </button>
          </div>
          {showQr && <QrImage text={link} size={180} />}
        </div>
      ) : (
        <button
          className={BTN_ACCENT}
          onClick={() => void rt.room.issueEditorKey()}
        >
          Editör bağlantısı oluştur
        </button>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Participant chat box                                                 */
/* ------------------------------------------------------------------ */

export function ParticipantChat({ chat }: { chat: RoomChatClient }) {
  const t = useT();
  const selfId = chat.selfId;
  const snap = useChatSnapshot(chat);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [snap.messages.length]);

  if (snap.status === "idle") return null;
  const off = snap.mode === "off";

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const v = text.trim();
    if (!v || busy) return;
    setBusy(true);
    setError(null);
    try {
      await chat.post(v);
      setText("");
    } catch (err) {
      const key = `chat.err.${err instanceof RoomApiError ? (err.detail ?? "") : ""}`;
      const known = [
        "chat.err.rate-limited",
        "chat.err.queue-full",
        "chat.err.chat-closed",
      ].includes(key);
      setError(t((known ? key : "chat.err.default") as MessageKey));
    } finally {
      setBusy(false);
    }
  };

  const label = (m: ChatMessage) =>
    m.status === "pending"
      ? t("chat.pending")
      : m.status === "rejected"
        ? t("chat.rejected")
        : snap.onAir?.id === m.id
          ? t("chat.onair")
          : null;

  return (
    <section
      className="space-y-2 rounded-xl border bg-card p-4"
      aria-label={t("chat.title")}
    >
      <h2 className="text-sm font-semibold">💬 {t("chat.title")}</h2>
      <ul
        className="max-h-60 space-y-1.5 overflow-y-auto text-sm"
        aria-live="polite"
      >
        {snap.messages.length === 0 && (
          <li className="text-xs text-muted-foreground">{t("chat.empty")}</li>
        )}
        {snap.messages.map((m) => {
          const tag = label(m);
          const own = selfId !== null && m.authorId === selfId;
          return (
            <li
              key={m.id}
              className={`rounded-md px-2 py-1 ${own ? "bg-speaker-b/10" : "bg-secondary/60"} ${m.status === "rejected" ? "opacity-60" : ""}`}
            >
              <span className="font-semibold">{m.author}: </span>
              <span className="whitespace-pre-wrap break-words">{m.text}</span>
              {tag && (
                <span className="ml-2 text-[10px] uppercase text-muted-foreground">
                  {tag}
                </span>
              )}
            </li>
          );
        })}
        <li ref={endRef} aria-hidden="true" />
      </ul>
      {snap.mode === "moderated" && (
        <p className="text-[11px] text-muted-foreground">
          {t("chat.moderated")}
        </p>
      )}
      {snap.status === "offline" && (
        <p className="text-[11px] text-primary">{t("chat.offline")}</p>
      )}
      {off ? (
        <p className="text-xs text-muted-foreground">{t("chat.off")}</p>
      ) : (
        <form className="flex gap-2" onSubmit={(e) => void send(e)}>
          <input
            className={INPUT}
            maxLength={280}
            value={text}
            placeholder={t("chat.placeholder")}
            aria-label={t("chat.placeholder")}
            onChange={(e) => setText(e.target.value)}
          />
          <button
            className={BTN_ACCENT}
            type="submit"
            disabled={busy || snap.status !== "live"}
          >
            {t("chat.send")}
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
