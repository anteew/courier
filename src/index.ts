import { InMemoryQueue } from './core/queue.js';
import { TriggerEngine, TriggerRule } from './triggers/engine.js';
import { LatestPerAgentView } from './views/latest.js';
import { startHttpGateway } from './gateway/http.js';
import { startWsGateway } from './gateway/ws.js';
import fs from 'fs';
import path from 'path';
import YAML from 'yaml';

const core = new InMemoryQueue();
const view = new LatestPerAgentView();

// Load triggers from config (optional)
let triggerRules: TriggerRule[] = [];
try {
  const cfgPath = process.env.COURIER_CONFIG || path.resolve(process.cwd(), 'config/dev.yaml');
  if (fs.existsSync(cfgPath)) {
    const cfg = YAML.parse(fs.readFileSync(cfgPath, 'utf8')) || {};
    if (Array.isArray(cfg.triggers)) {
      triggerRules = cfg.triggers.map((t: any) => ({ id: String(t.id), when: t.when || {}, do: t.do || [], limits: t.limits })) as TriggerRule[];
    }
  } else {
    // default triggers
    triggerRules = [
      { id: 'trig.jen.log.notify.architect', when: { to: 'agents/Jen/outbox', type: 'sprint.log' }, do: [{ action: 'notify', to: 'agents/architect/inbox', payload: { title: 'Jen posted sprint log' } }], limits: { cooldownMs: 5000 } },
      { id: 'trig.arch.assign.notify.jen', when: { to: 'agents/Jen/inbox', type: 'sprint.assign' }, do: [{ action: 'notify', to: 'agents/Jen/inbox', payload: { title: 'New sprint assigned' } }], limits: { cooldownMs: 5000 } }
    ];
  }
} catch {}

const engine = new TriggerEngine(triggerRules, (to, env) => core.enqueue(to, env));

// Wrap enqueue to update views and fire triggers
const realEnq = core.enqueue.bind(core);
(core as any).enqueue = (to: string, env: any) => { const r = realEnq(to, env); try { view.update(env); engine.onInsert(env); } catch {}; return r; };

startHttpGateway(core, view, 8787);
startWsGateway(core, 8788);
console.log('Courier HTTP gateway on :8787');
console.log('Courier WS gateway on :8788');
