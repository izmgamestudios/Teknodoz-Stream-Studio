// src/studio/live/uploader.ts
// Sequential, retrying uploader of MediaRecorder chunks. The server needs the bytes in order
// (it pipes them into ffmpeg), so exactly one request is in flight at a time; a request that
// failed on the network is retried with the SAME sequence number (the server de-duplicates).
import { LiveApiError, type LiveApi } from "./api";

export interface UploaderOptions {
  api: LiveApi;
  token: string;
  sessionId: string;
  /** give up when the backlog would exceed this many seconds of media (default 30) */
  maxBacklogChunks?: number;
  retries?: number;
  retryDelayMs?: number;
  onError?: (e: LiveApiError) => void;
}

export class ChunkUploader {
  private queue: Blob[] = [];
  private seq = 0;
  private running = false;
  private stopped = false;
  private failed = false;
  private sent = 0;
  private abort = new AbortController();
  private idle: (() => void)[] = [];

  constructor(private readonly o: UploaderOptions) {}

  get backlog(): number {
    return this.failed ? 0 : this.queue.length + (this.running ? 1 : 0);
  }
  get bytesSent(): number {
    return this.sent;
  }
  get hasFailed(): boolean {
    return this.failed;
  }

  push(chunk: Blob): void {
    if (this.stopped || this.failed || chunk.size === 0) return;
    const max = this.o.maxBacklogChunks ?? 30;
    if (this.queue.length >= max) {
      this.fail(new LiveApiError("network", 0, { reason: "backlog" }));
      return;
    }
    this.queue.push(chunk);
    void this.pump();
  }

  private fail(e: LiveApiError): void {
    if (this.failed) return;
    this.failed = true;
    this.queue = [];
    this.abort.abort();
    this.o.onError?.(e);
    this.flushIdle();
  }

  private flushIdle(): void {
    for (const r of this.idle.splice(0)) r();
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length > 0 && !this.failed) {
        const chunk = this.queue[0] as Blob;
        await this.send(chunk);
        this.queue.shift();
      }
    } finally {
      this.running = false;
      if (this.queue.length === 0) this.flushIdle();
    }
  }

  private async send(chunk: Blob): Promise<void> {
    const retries = this.o.retries ?? 4;
    const delay = this.o.retryDelayMs ?? 700;
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await this.o.api.chunk(
          this.o.token,
          this.o.sessionId,
          this.seq,
          chunk,
          this.abort.signal,
        );
        this.seq = r.next;
        this.sent += chunk.size;
        return;
      } catch (e) {
        if ((e as { name?: string } | null)?.name === "AbortError") return;
        const err = e instanceof LiveApiError ? e : new LiveApiError("network");
        const retryable = err.code === "network" || err.code === "server";
        if (!retryable || attempt >= retries) {
          this.fail(err);
          return;
        }
        await new Promise((r) => setTimeout(r, delay * (attempt + 1)));
        if (this.failed) return;
      }
    }
  }

  /** Resolve when everything queued has been delivered (or the uploader failed). */
  drain(): Promise<void> {
    if (this.queue.length === 0 && !this.running) return Promise.resolve();
    return new Promise((r) => this.idle.push(r));
  }

  stop(): void {
    this.stopped = true;
    this.queue = [];
    this.abort.abort();
    this.flushIdle();
  }
}
