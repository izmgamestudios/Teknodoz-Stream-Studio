// src/studio/ui/use-client.ts
// Connection state machine for the /join and /remote pages (the non-host side).
import { useCallback, useEffect, useRef, useState } from "react";

import {
  StudioClient,
  extractCode,
  isP2PError,
  isSignalError,
  p2pErrorMessage,
  parseFragment,
  type ClientStatus,
} from "../p2p";

export type ConnectPhase = "idle" | "connecting" | "answer";

export function connectErrorText(e: unknown): string {
  if (isP2PError(e)) return p2pErrorMessage(e.code);
  if (isSignalError(e))
    return "Kod geçersiz veya bozuk. Bağlantıyı/kodu tamamen kopyaladığınızdan emin olun.";
  return "Bağlantı kurulamadı.";
}

/** Reads `#c=<code>` from the URL fragment once on the client. */
export function useFragmentCode(): string {
  const [code, setCode] = useState("");
  useEffect(() => {
    const c = parseFragment(window.location.hash);
    if (c) setCode(c);
  }, []);
  return code;
}

export function useClientConnection() {
  const [phase, setPhase] = useState<ConnectPhase>("idle");
  const [client, setClient] = useState<StudioClient | null>(null);
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState<ClientStatus>("connecting");
  const [error, setError] = useState("");
  const ref = useRef<StudioClient | null>(null);

  useEffect(
    () => () => {
      ref.current?.dispose();
      ref.current = null;
    },
    [],
  );

  const connect = useCallback(
    async (raw: string, name: string, usePublicStun: boolean) => {
      setError("");
      setPhase("connecting");
      try {
        const res = await StudioClient.acceptOffer(extractCode(raw), {
          ...(name.trim() ? { name: name.trim() } : {}),
          usePublicStun,
        });
        ref.current?.dispose();
        ref.current = res.client;
        setClient(res.client);
        setStatus(res.client.status);
        res.client.onStatus(setStatus);
        setAnswer(res.answerCode);
        setPhase("answer");
      } catch (e) {
        setError(connectErrorText(e));
        setPhase("idle");
      }
    },
    [],
  );

  return { phase, client, answer, status, error, connect };
}
