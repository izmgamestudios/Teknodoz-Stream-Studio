// src/lib/studio/use-audio-mixer.ts
import { useCallback, useRef } from "react";

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
    (s: MediaStream | null) => {
      if (!s || !s.getAudioTracks().length || wired.current.has(s)) return;
      const { ctx, dest } = ensure();
      wired.current.add(s);
      ctx.createMediaStreamSource(s).connect(dest);
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
    async (file: File) => {
      const { ctx } = ensure();
      return ctx.decodeAudioData(await file.arrayBuffer());
    },
    [ensure],
  );

  return { ensure, connectStream, connectElement, playBuffer, decode };
}
