import { Duplex } from 'stream';
import { decodeLines, encodeFrame, ControlFrame } from './types.js';
import { QueueCore } from '../core/queue.js';
import { LatestPerAgentView } from '../views/latest.js';
import { Recorder } from './record.js';

export class PipeServer {
  private buf = '';
  private sub: { id: string; stream: string } | null = null;
  private tokenPresent = false;
  constructor(private core: QueueCore, private view: LatestPerAgentView, private rec?: Recorder) {}

  getAllMetrics() {
    return this.core.getAllStreams();
  }

  attach(stream: Duplex) {
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      this.buf += chunk;
      this.buf = decodeLines(this.buf, (frame) => this.onFrame(stream, frame));
    });
  }

  private send(stream: Duplex, f: ControlFrame) {
    this.rec?.write(f, 'out');
    stream.write(encodeFrame(f));
  }

  private onFrame(stream: Duplex, f: ControlFrame) {
    this.rec?.write(f, 'in');
    try {
      switch (f.type) {
        case 'hello':
          this.tokenPresent = !!f.token;
          this.send(stream, { type: 'ok', reqId: 'hello', result: { version: 'v1', features: ['credit','views','triggers'] } });
          break;
        case 'enqueue': {
          const { id } = this.core.enqueue(f.to, f.env);
          this.view.update(f.env);
          const reqId = f.reqId || 'enqueue';
          this.send(stream, { type: 'ok', reqId, result: { id } });
          break;
        }
        case 'subscribe': {
          const sub = this.core.subscribe(f.stream);
          this.sub = { id: sub.id, stream: f.stream };
          sub.onDeliver((env) => this.send(stream, { type: 'deliver', env }));
          break;
        }
        case 'grant':
          if (this.sub) this.core.grantCredit(this.sub.id, f.n);
          break;
        case 'ack':
          if (this.sub) this.core.ack(this.sub.id, f.id);
          break;
        case 'nack':
          if (this.sub) this.core.nack(this.sub.id, f.id, f.delayMs);
          break;
        case 'stats': {
          const stats = this.core.stats(f.stream);
          this.send(stream, { type: 'ok', reqId: f.reqId, result: stats });
          break;
        }
        case 'snapshot': {
          if (f.view === 'latestPerAgent') {
            const rows = this.view.snapshot();
            this.send(stream, { type: 'ok', reqId: f.reqId, result: { rows } });
          } else {
            this.send(stream, { type: 'error', reqId: f.reqId, code: 'UnknownView', detail: f.view });
          }
          break;
        }
        case 'metrics': {
          const streams = this.getAllMetrics();
          this.send(stream, { type: 'ok', reqId: f.reqId, result: { streams } });
          break;
        }
        default:
          // unsupported
          // @ts-ignore
          const reqId = (f as any).reqId || 'req';
          this.send(stream, { type: 'error', reqId, code: 'Unsupported', detail: (f as any).type });
      }
    } catch (e: any) {
      const reqId = (f as any).reqId || 'req';
      this.send(stream, { type: 'error', reqId, code: 'Internal', detail: e?.message || String(e) });
    }
  }
}
