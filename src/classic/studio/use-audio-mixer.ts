// src/lib/studio/use-audio-mixer.ts
import { useCallback, useEffect, useRef } from "react";

import { createMusicPlayer, type MusicPlayer } from "@/studio/engine/music";

/** One WebAudio graph feeding both the speakers and the recorder (MediaStreamDestination). */
export function useAudioMixer() {
  const ctxRef = useRef<AudioContext | null>(null);
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const wired = useRef(new WeakSet<object>());

  const ensure = useCallback(() => {
    if (!ctxRef.current) {
      ctxRef.current = new AudioContext();
      destRef.current = ctxRef.current.createMediaStreamDestination();
    }
    void ctxRef.current.resume();
    return { ctx: ctxRef.current, dest: destRef.current! };
  }, []);

  /** Mic / screen audio: recorded but not monitored (avoids echo). */
  const connectStream = useCallback(
    (s: MediaStream | null, monitor = false) => {
      if (!s || !s.getAudioTracks().length || wired.current.has(s)) return;
      const { ctx, dest } = ensure();
      wired.current.add(s);
      const src = ctx.createMediaStreamSource(s);
      src.connect(dest);
      if (monitor) src.connect(ctx.destination);
    },
    [ensure],
  );

  /** createMediaElementSource may only be called once per element. */
  const connectElement = useCallback(
    (el: HTMLMediaElement | null) => {
      if (!el || wired.current.has(el)) return;
      const { ctx, dest } = ensure();
      wired.current.add(el);
      const src = ctx.createMediaElementSource(el);
      src.connect(dest);
      src.connect(ctx.destination);
    },
    [ensure],
  );

  const playBuffer = useCallback(
    (buf: AudioBuffer, gain = 1) => {
      const { ctx, dest } = ensure();
      const src = ctx.createBufferSource();
      const g = ctx.createGain();
      g.gain.value = gain;
      src.buffer = buf;
      src.connect(g);
      g.connect(dest);
      g.connect(ctx.destination);
      src.start();
    },
    [ensure],
  );

  const decode = useCallback(
    async (file: Blob) => {
      const { ctx } = ensure();
      return ctx.decodeAudioData(await file.arrayBuffer());
    },
    [ensure],
  );

  const musicRef = useRef<MusicPlayer | null>(null);
  /** Procedural music bus, routed to both the recorder and the speakers. */
  const music = useCallback(() => {
    if (!musicRef.current) {
      const { ctx, dest } = ensure();
      const bus = ctx.createGain();
      bus.connect(dest);
      bus.connect(ctx.destination);
      musicRef.current = createMusicPlayer(ctx, bus);
    }
    return musicRef.current;
  }, [ensure]);

  const stopMusic = useCallback(() => musicRef.current?.stop(), []);

  // release the AudioContext (and any playing music) when the page goes away
  useEffect(
    () => () => {
      musicRef.current?.stop();
      musicRef.current = null;
      void ctxRef.current?.close();
      ctxRef.current = null;
      destRef.current = null;
      wired.current = new WeakSet();
    },
    [],
  );

  return {
    music,
    stopMusic,
    ensure,
    connectStream,
    connectElement,
    playBuffer,
    decode,
  };
}
