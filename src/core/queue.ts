import { Envelope } from '../types/envelope.js';

export type StreamId = string;

export interface StreamStats {
  depth: number;
  inflight: number;
  rateIn: number;
  rateOut: number;
  latP50: number;
  latP95: number;
  lastTs?: string;
}

export interface QueueCore {
  enqueue(stream: StreamId, env: Envelope): { id: string };
  subscribe(stream: StreamId): Subscriber;
  grantCredit(subId: string, n: number): void;
  ack(subId: string, id: string): void;
  nack(subId: string, id: string): void;
  stats(stream: StreamId): StreamStats;
}

export interface Subscriber {
  id: string;
  stream: StreamId;
  credit: number;
  onDeliver(cb: (env: Envelope) => void): void;
}

type Lease = { id: string; subscriberId: string; expiresAt: number; env: Envelope };

class Ring<T> {
  private buf: T[];
  private head = 0; // next read
  private tail = 0; // next write
  private _size = 0;
  constructor(private capacity: number) { this.buf = new Array<T>(capacity); }
  push(x: T) {
    if (this._size === this.capacity) {
      // overwrite oldest (drop)
      this.buf[this.tail] = x;
      this.tail = (this.tail + 1) % this.capacity;
      this.head = this.tail; // drop oldest
      return;
    }
    this.buf[this.tail] = x;
    this.tail = (this.tail + 1) % this.capacity;
    this._size++;
  }
  peek(): T | undefined { return this._size === 0 ? undefined : this.buf[this.head]; }
  pop(): T | undefined {
    if (this._size === 0) return undefined;
    const v = this.buf[this.head];
    this.head = (this.head + 1) % this.capacity;
    this._size--;
    return v;
  }
  size() { return this._size; }
}

interface StreamState {
  ring: Ring<Envelope>;
  subscriber?: { sub: InternalSubscriber };
  inflight: Map<string, Lease>;
  recent: { set: Set<string>; q: string[]; cap: number };
  rateIn: number;
  rateOut: number;
  latSamples: number[];
  lastTs?: string;
}

class InternalSubscriber implements Subscriber {
  id: string;
  credit = 0;
  private deliverCb: ((env: Envelope) => void) | null = null;
  constructor(public stream: StreamId) { this.id = `sub-${Math.random().toString(36).slice(2, 8)}`; }
  onDeliver(cb: (env: Envelope) => void) { this.deliverCb = cb; }
  deliver(env: Envelope) { if (this.deliverCb) this.deliverCb(env); }
}

export class InMemoryQueue implements QueueCore {
  private streams = new Map<StreamId, StreamState>();
  private leaseMs = 30_000;
  private now() { return Date.now(); }

  constructor(private maxDepth = 100_000) {
    // periodic lease scanner
    setInterval(() => this.scanTimeouts(), 1000).unref?.();
  }

  private getStream(stream: StreamId): StreamState {
    let s = this.streams.get(stream);
    if (!s) {
      s = { ring: new Ring<Envelope>(this.maxDepth), inflight: new Map(), recent: { set: new Set(), q: [], cap: 10000 }, rateIn: 0, rateOut: 0, latSamples: [] };
      this.streams.set(stream, s);
    }
    return s;
  }

  enqueue(stream: StreamId, env: Envelope): { id: string } {
    if (!env?.id || !env?.ts || !stream) throw new Error('invalid envelope');
    const s = this.getStream(stream);
    // de-dup window: drop if recently acked
    if (s.recent.set.has(env.id)) {
      return { id: env.id };
    }
    s.ring.push(env);
    s.rateIn++;
    s.lastTs = env.ts;
    this.maybeDeliver(stream, s);
    return { id: env.id };
  }

  subscribe(stream: StreamId): Subscriber {
    const s = this.getStream(stream);
    if (s.subscriber) throw new Error('stream already has a subscriber (v1 limitation)');
    const sub = new InternalSubscriber(stream);
    s.subscriber = { sub };
    // Try to deliver any backlog when credit arrives
    return sub;
  }

  grantCredit(subId: string, n: number): void {
    const s = this.findStreamBySub(subId);
    if (!s) return;
    s.subscriber!.sub.credit += n;
    this.maybeDeliver(s.subscriber!.sub.stream, s);
  }

  ack(subId: string, id: string): void {
    const s = this.findStreamBySub(subId);
    if (!s) return;
    if (s.inflight.delete(id)) {
      // record in recent window
      s.recent.set.add(id);
      s.recent.q.push(id);
      if (s.recent.q.length > s.recent.cap) {
        const oldest = s.recent.q.shift()!;
        s.recent.set.delete(oldest);
      }
    }
    this.maybeDeliver(s.subscriber!.sub.stream, s);
  }

  nack(subId: string, id: string): void {
    const s = this.findStreamBySub(subId);
    if (!s) return;
    const lease = s.inflight.get(id);
    if (lease) {
      s.inflight.delete(id);
      // Re-enqueue original envelope at tail
      s.ring.push(lease.env);
    }
    this.maybeDeliver(s.subscriber!.sub.stream, s);
  }

  stats(stream: StreamId): StreamStats {
    const s = this.getStream(stream);
    const arr = s.latSamples.slice(-64).sort((a,b)=>a-b);
    const p = (q:number)=> arr.length? arr[Math.floor(q*(arr.length-1))]:0;
    return { depth: s.ring.size(), inflight: s.inflight.size, rateIn: s.rateIn, rateOut: s.rateOut, latP50: p(0.5), latP95: p(0.95), lastTs: s.lastTs };
  }

  private findStreamBySub(subId: string): StreamState | undefined {
    for (const s of this.streams.values()) {
      if (s.subscriber?.sub.id === subId) return s;
    }
    return undefined;
  }

  private maybeDeliver(stream: StreamId, s: StreamState) {
    const sub = s.subscriber?.sub; if (!sub) return;
    while (sub.credit > 0 && s.ring.size() > 0) {
      const env = s.ring.pop(); if (!env) break;
      const lease: Lease = { id: env.id, subscriberId: sub.id, expiresAt: this.now() + this.leaseMs, env };
      s.inflight.set(env.id, lease);
      sub.credit--;
      s.rateOut++;
      // naive latency sample using current time vs ts
      const sentAt = Date.parse(env.ts) || this.now();
      s.latSamples.push(Math.max(0, this.now() - sentAt));
      sub.deliver(env);
    }
  }

  private scanTimeouts() {
    const now = this.now();
    for (const [stream, s] of this.streams.entries()) {
      for (const [id, lease] of Array.from(s.inflight.entries())) {
        if (lease.expiresAt <= now) {
          s.inflight.delete(id);
          // re-enqueue for redelivery
          s.ring.push(lease.env);
        }
      }
    }
  }
}
