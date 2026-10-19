// src/lib/remote/host.tsx
import type { DataConnection, MediaConnection, Peer } from "peerjs";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { newPeer } from "./peer";
import {
  type Command,
  type HostState,
  isMsg,
  newRoomId,
  isRoomId,
} from "./protocol";

type Status = "off" | "connecting" | "ready" | "error";
export type GuestRequest = { id: string; name: string };

type Handler = (c: Command) => void;

type Ctx = {
  roomId: string | null;
  status: Status;
  remotes: number;
  pending: GuestRequest[];
  guest: { id: string; name: string; stream: MediaStream } | null;
  start(): void;
  stop(): void;
  renew(): void;
  accept(id: string): void;
  reject(id: string): void;
  kickGuest(): void;
  /** A page registers its command handler; returns an unregister function. */
  register(h: Handler): () => void;
  publish(state: HostState): void;
};

const HostCtx = createContext<Ctx | null>(null);
const ROOM_KEY = "studio.room";

export function useRemoteHost() {
  const c = useContext(HostCtx);
  if (!c) throw new Error("useRemoteHost outside RemoteHostProvider");
  return c;
}

export function RemoteHostProvider({ children }: { children: ReactNode }) {
  const peerRef = useRef<Peer | null>(null);
  const conns = useRef(new Set<DataConnection>());
  const calls = useRef(new Map<string, MediaConnection>());
  const handler = useRef<Handler | null>(null);
  const lastState = useRef<HostState>({ page: "idle" });
  const lastJson = useRef("");

  const [roomId, setRoomId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("off");
  const [remotes, setRemotes] = useState(0);
  const [pending, setPending] = useState<GuestRequest[]>([]);
  const [guest, setGuest] = useState<Ctx["guest"]>(null);

  const send = useCallback((c: DataConnection) => {
    if (c.open) c.send({ t: "state", state: lastState.current });
  }, []);

  const teardown = useCallback(() => {
    peerRef.current?.destroy();
    peerRef.current = null;
    conns.current.clear();
    calls.current.clear();
    setRemotes(0);
    setPending([]);
    setGuest(null);
    setStatus("off");
  }, []);

  const boot = useCallback(
    async (forceNew: boolean) => {
      teardown();
      setStatus("connecting");
      let id: string | null = null;
      try {
        id = forceNew ? null : localStorage.getItem(ROOM_KEY);
      } catch {
        /* storage blocked */
      }
      if (!isRoomId(id)) id = newRoomId();
      try {
        const peer = await newPeer(id);
        peerRef.current = peer;
        peer.on("open", (opened) => {
          setRoomId(opened);
          setStatus("ready");
          try {
            localStorage.setItem(ROOM_KEY, opened);
          } catch {
            /* storage blocked */
          }
        });
        peer.on("error", (e) => {
          if ((e as { type?: string }).type === "unavailable-id") {
            void boot(true);
            return;
          }
          setStatus("error");
        });
        peer.on("connection", (c) => {
          c.on("open", () => {
            conns.current.add(c);
            setRemotes(conns.current.size);
            send(c);
          });
          c.on("data", (d) => {
            if (isMsg(d) && d.t === "cmd")
              handler.current?.({
                cmd: d.cmd,
                ...(d.arg !== undefined ? { arg: d.arg } : {}),
              });
          });
          const drop = () => {
            conns.current.delete(c);
            setRemotes(conns.current.size);
          };
          c.on("close", drop);
          c.on("error", drop);
        });
        peer.on("call", (call) => {
          const name = String(
            (call.metadata as { name?: string } | null)?.name ?? "Konuk",
          );
          calls.current.set(call.peer, call);
          setPending((p) => [
            ...p.filter((x) => x.id !== call.peer),
            { id: call.peer, name },
          ]);
          call.on("close", () => {
            calls.current.delete(call.peer);
            setPending((p) => p.filter((x) => x.id !== call.peer));
            setGuest((g) => (g?.id === call.peer ? null : g));
          });
        });
      } catch {
        setStatus("error");
      }
    },
    [send, teardown],
  );

  const accept = useCallback((id: string) => {
    const call = calls.current.get(id);
    if (!call) return;
    const name = String(
      (call.metadata as { name?: string } | null)?.name ?? "Konuk",
    );
    call.on("stream", (stream) => setGuest({ id, name, stream }));
    call.answer();
    setPending((p) => p.filter((x) => x.id !== id));
  }, []);
  const reject = useCallback((id: string) => {
    calls.current.get(id)?.close();
    calls.current.delete(id);
    setPending((p) => p.filter((x) => x.id !== id));
  }, []);
  const kickGuest = useCallback(() => {
    if (guest) reject(guest.id);
    setGuest(null);
  }, [guest, reject]);

  const publish = useCallback(
    (state: HostState) => {
      const json = JSON.stringify(state);
      lastState.current = state;
      if (json === lastJson.current) return;
      lastJson.current = json;
      conns.current.forEach(send);
    },
    [send],
  );

  const register = useCallback((h: Handler) => {
    handler.current = h;
    return () => {
      if (handler.current === h) handler.current = null;
    };
  }, []);

  useEffect(() => () => peerRef.current?.destroy(), []);

  const value = useMemo<Ctx>(
    () => ({
      roomId,
      status,
      remotes,
      pending,
      guest,
      start: () => void boot(false),
      stop: teardown,
      renew: () => void boot(true),
      accept,
      reject,
      kickGuest,
      register,
      publish,
    }),
    [
      roomId,
      status,
      remotes,
      pending,
      guest,
      boot,
      teardown,
      accept,
      reject,
      kickGuest,
      register,
      publish,
    ],
  );

  return <HostCtx.Provider value={value}>{children}</HostCtx.Provider>;
}
