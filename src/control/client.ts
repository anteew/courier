import { Duplex, PassThrough, Readable, Writable } from 'stream';
import { ControlFrame, encodeFrame, decodeLines } from './types.js';
import { Envelope } from '../types/envelope.js';
import { Recorder } from './record.js';

export interface StreamStats { depth: number; inflight: number; rateIn: number; rateOut: number; latP50: number; latP95: number; lastTs?: string }

export type DeliverHandler = (env: Envelope) => void;

function wrapDuplex(readable: Readable, writable: Writable): Duplex {
  const d = new Duplex({ read(_size) { /* push happens from readable events */ }, write(chunk, enc, cb) { writable.write(chunk, enc as any, cb); } });
  (readable as any).on('data', (c: any) => d.push(c));
  (readable as any).on('end', () => d.push(null));
  return d;
}

export function makeDuplexPair(): [Duplex, Duplex] {
  const aToB = new PassThrough({ encoding: 'utf8' as any });
  const bToA = new PassThrough({ encoding: 'utf8' as any });
  const A = wrapDuplex(bToA, aToB);
  const B = wrapDuplex(aToB, bToA);
  (A as any).setEncoding?.('utf8');
  (B as any).setEncoding?.('utf8');
  return [A, B];
}

export class PipeClient {
  private buf = '';
  private seq = 0;
  private pending = new Map<string, (res: any, err?: any) => void>();
  private onDeliver: DeliverHandler | null = null;
  constructor(private stream: Duplex, private rec?: Recorder) {
    (stream as any).setEncoding?.('utf8');
    stream.on('data', (chunk: string) => {
      this.buf += chunk;
      this.buf = decodeLines(this.buf, (f) => this.onFrame(f));
    });
  }
  private send(f: ControlFrame) {
    this.rec?.write(f, 'out');
    this.stream.write(encodeFrame(f));
  }
  private onFrame(f: ControlFrame) {
    this.rec?.write(f, 'in');
    if (f.type === 'deliver') { this.onDeliver?.(f.env); return; }
    if (f.type === 'ok') {
      const cb = this.pending.get(f.reqId); if (cb) { this.pending.delete(f.reqId); cb(f.result); }
      return;
    }
    if (f.type === 'error') {
      const cb = this.pending.get(f.reqId); if (cb) { this.pending.delete(f.reqId); cb(undefined, f); }
      return;
    }
  }
  private reqId(): string { return 'r' + (++this.seq); }
  async hello(features: string[] = []): Promise<{ version: string; features: string[] }> {
    const reqId = 'hello';
    return new Promise((resolve) => { this.pending.set(reqId, (res)=>resolve(res)); this.send({ type: 'hello', version: 'v1', features }); });
  }
  async enqueue(to: string, env: Envelope): Promise<{ id: string }> {
    const reqId = this.reqId();
    return new Promise((resolve, reject) => {
      this.pending.set(reqId, (res, err)=> err ? reject(err) : resolve(res));
      this.send({ type: 'enqueue', to, env, reqId });
    });
  }
  async subscribe(stream: string, onDeliver: DeliverHandler): Promise<{ subId: string }> {
    this.onDeliver = onDeliver;
    this.send({ type: 'subscribe', stream });
    return { subId: 'local' };
  }
  grant(n: number) { this.send({ type: 'grant', n }); }
  ack(id: string) { this.send({ type: 'ack', id }); }
  nack(id: string, delayMs?: number) { this.send({ type: 'nack', id, delayMs }); }
  async stats(stream: string): Promise<StreamStats> {
    const reqId = this.reqId();
    return new Promise((resolve, reject) => {
      this.pending.set(reqId, (res, err)=> err ? reject(err) : resolve(res));
      this.send({ type: 'stats', reqId, stream });
    });
  }
  async snapshot(view: string): Promise<{ rows: any[] }> {
    const reqId = this.reqId();
    return new Promise((resolve, reject) => {
      this.pending.set(reqId, (res, err)=> err ? reject(err) : resolve(res));
      this.send({ type: 'snapshot', reqId, view });
    });
  }
}
