import { Envelope } from '../types/envelope.js';
import { EventEmitter } from 'events';

export class LatestPerAgentView extends EventEmitter {
  private map = new Map<string, Envelope>();
  update(env: Envelope) {
    if (env.to?.startsWith('agents/') && env.to.endsWith('/inbox')) {
      this.map.set(env.to, env);
      this.emit('update', { addr: env.to, env });
    }
  }
  snapshot() { return Array.from(this.map.entries()).map(([addr, env]) => ({ addr, env })); }
}
