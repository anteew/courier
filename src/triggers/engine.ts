import { Envelope } from '../types/envelope.js';

export interface TriggerRule {
  id: string;
  when: Partial<Pick<Envelope, 'from' | 'to' | 'type'>> & { tags?: string[] };
  do: Array<{ action: 'notify'; to: string; payload?: any }>;
  limits?: { cooldownMs?: number };
}

export class TriggerEngine {
  private lastFire = new Map<string, number>();
  constructor(private rules: TriggerRule[] = [], private emit: (to: string, env: Envelope) => void) {}

  onInsert(env: Envelope): void {
    const now = Date.now();
    for (const r of this.rules) {
      if (!this.match(r.when, env)) continue;
      const last = this.lastFire.get(r.id) || 0;
      const cd = r.limits?.cooldownMs ?? 0;
      if (now - last < cd) continue;
      for (const act of r.do) {
        if (act.action === 'notify') {
          const out: Envelope = {
            id: `n-${env.id}`,
            ts: new Date().toISOString(),
            from: 'system/courier',
            to: act.to,
            type: 'notify',
            payload: { title: 'Notification', ref: env.id, ...act.payload }
          };
          this.emit(act.to, out);
        }
      }
      this.lastFire.set(r.id, now);
    }
  }

  private match(pred: TriggerRule['when'], env: Envelope): boolean {
    if (pred.from && pred.from !== env.from) return false;
    if (pred.to && pred.to !== env.to) return false;
    if (pred.type && pred.type !== env.type) return false;
    if (pred.tags && pred.tags.length) {
      const tags = new Set(env.tags || []);
      for (const t of pred.tags) if (!tags.has(t)) return false;
    }
    return true;
  }
}
