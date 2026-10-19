// src/lib/remote/client.ts
import type { DataConnection, MediaConnection, Peer } from "peerjs";
import { useCallback, useEffect, useRef, useState } from "react";

import { newPeer } from "./peer";
import { type Command, type HostState, isMsg } from "./protocol";

export type ClientStatus = "connecting" | "connected" | "lost" | "error";

/** Phone side: control channel to the studio plus optional camera/mic as "guest". */
export function useRemoteClient(room: string | null, control = true) {
  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const callRef = useRef<MediaConnection | null>(null);
  const [status, setStatus] = useState<ClientStatus>("connecting");
  const [state, setState] = useState<HostState>({ page: "idle" });
  const [guestLive, setGuestLive] = useState(false);
  const [guestErr, setGuestErr] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!room) return;
    let dead = false;
    setStatus("connecting");
    void newPeer()
      .then((peer) => {
        if (dead) return peer.destroy();
        peerRef.current = peer;
        peer.on("open", () => {
          if (!control) return setStatus("connected");
          const c = peer.connect(room, { reliable: true });
          connRef.current = c;
          c.on("open", () => setStatus("connected"));
          c.on("data", (d) => {
            if (isMsg(d) && d.t === "state") setState(d.state);
          });
          c.on("close", () => setStatus("lost"));
          c.on("error", () => setStatus("error"));
        });
        peer.on("error", () => setStatus("error"));
        peer.on("disconnected", () =>
          setStatus((s) => (s === "connected" ? "lost" : s)),
        );
      })
      .catch(() => setStatus("error"));
    return () => {
      dead = true;
      callRef.current?.close();
      peerRef.current?.destroy();
      peerRef.current = null;
    };
  }, [room, attempt, control]);

  const send = useCallback((c: Command) => {
    const conn = connRef.current;
    if (conn?.open) conn.send({ t: "cmd", ...c });
  }, []);

  /** Share this device's camera + mic with the studio (host must accept). */
  const shareCamera = useCallback(
    async (name: string, facing: "user" | "environment" = "user") => {
      setGuestErr("");
      const peer = peerRef.current;
      if (!room || !peer) return null;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: 1280, height: 720 },
          audio: true,
        });
        callRef.current?.close();
        const call = peer.call(room, stream, { metadata: { name } });
        callRef.current = call;
        call.on("close", () => {
          stream.getTracks().forEach((t) => t.stop());
          setGuestLive(false);
        });
        setGuestLive(true);
        return stream;
      } catch {
        setGuestErr("Kamera/mikrofon izni verilmedi.");
        return null;
      }
    },
    [room],
  );

  const stopCamera = useCallback(() => {
    callRef.current?.close();
    setGuestLive(false);
  }, []);

  return {
    status,
    state,
    send,
    shareCamera,
    stopCamera,
    guestLive,
    guestErr,
    retry: () => setAttempt((n) => n + 1),
  };
}
