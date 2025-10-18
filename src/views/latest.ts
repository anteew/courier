import { Envelope } from '../types/envelope.js';

export class LatestPerAgentView {
  private map = new Map<string, Envelope>();
  update(env: Envelope) {
    if (env.to?.startsWith('agents/') && env.to.endsWith('/inbox')) {
      this.map.set(env.to, env);
    }
  }
  snapshot() { return Array.from(this.map.entries()).map(([addr, env]) => ({ addr, env })); }
}
