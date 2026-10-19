// src/routes/chat.$code.tsx
// Chat editor desk: opened by the director's "editor link" (/chat/<CODE>#k=<key>) on another
// device. The key stays in the URL fragment (never sent to the server except as the bearer
// token of the chat API). Editors approve / edit / reject; only the director airs a message.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { RoomChatClient } from "@/studio/room/chat-client";
import { ModerationDesk, useChatSnapshot } from "@/studio/ui/chat-panels";
import { CreditsFooter } from "@/studio/ui/credits";
import { titleFromMatches } from "@/studio/branding/head";

export const Route = createFileRoute("/chat/$code")({
  head: ({ matches }) => ({
    meta: [
      { title: titleFromMatches(matches, "Sohbet editörü") },
      { name: "robots", content: "noindex" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: ChatEditorPage,
});

function readKey(): string | null {
  if (typeof location === "undefined") return null;
  const m = /(?:^#|&)k=([^&\s]{10,100})/.exec(location.hash);
  return m?.[1] ?? null;
}

function ChatEditorPage() {
  const { code } = Route.useParams();
  const [key, setKey] = useState<string | null | undefined>(undefined);
  useEffect(() => setKey(readKey()), []);
  const chat = useMemo(() => new RoomChatClient(), []);

  useEffect(() => {
    if (!key) return;
    chat.connect(code, { kind: "bearer", token: key });
    return () => chat.disconnect();
  }, [chat, code, key]);
  useEffect(() => () => chat.dispose(), [chat]);

  const snap = useChatSnapshot(chat);
  useEffect(() => {
    const n = snap.pending;
    document.title = `${n > 0 ? `(${n}) ` : ""}Sohbet editörü — Teknodoz Studio`;
  }, [snap.pending]);

  return (
    <div className="mx-auto min-h-screen max-w-3xl space-y-4 p-4">
      <header className="pt-4">
        <p className="text-xs uppercase tracking-[0.3em] text-speaker-b">
          Teknodoz Studio
        </p>
        <h1 className="mt-1 text-2xl font-bold">Sohbet editörü</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Oda{" "}
          <span className="font-mono font-bold tracking-widest text-foreground">
            {code.toUpperCase()}
          </span>
          . Katılımcı mesajları yayına girmeden önce sizden geçer.
        </p>
      </header>

      {key === null && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 p-3 text-sm text-destructive"
        >
          Editör anahtarı bulunamadı. Rejiden aldığınız bağlantının tamamını
          (sonundaki <code>#k=…</code> dahil) açın.
        </p>
      )}
      {snap.status === "denied" && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 p-3 text-sm text-destructive"
        >
          Bu bağlantı geçersiz ya da iptal edildi. Rejiden yeni bir editör
          bağlantısı isteyin.
        </p>
      )}
      {snap.status === "closed" && (
        <p role="status" className="rounded-md border p-3 text-sm">
          Oda kapatıldı.
        </p>
      )}
      {key && snap.status !== "denied" && snap.status !== "closed" && (
        <ModerationDesk chat={chat} director={false} />
      )}

      <CreditsFooter className="border-t pt-3" />
    </div>
  );
}
