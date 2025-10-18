import { InMemoryQueue } from './core/queue.js';
import { TriggerEngine, TriggerRule } from './triggers/engine.js';
import { LatestPerAgentView } from './views/latest.js';
import { startHttpGateway } from './gateway/http.js';
import { startWsGateway } from './gateway/ws.js';

const core = new InMemoryQueue();
const view = new LatestPerAgentView();
const triggers: TriggerRule[] = [
  {
    id: 'trig.jen.log.notify.architect',
    when: { from: 'agents/Jen/outbox', type: 'sprint.log' },
    do: [{ action: 'notify', to: 'agents/architect/inbox', payload: { title: 'Jen posted sprint log' } }],
    limits: { cooldownMs: 5000 }
  }
];
const engine = new TriggerEngine(triggers, (to, env) => core.enqueue(to, env));

// Wire simple on_insert handler via monkey-patched enqueue (stub for v1 skeleton)
const realEnq = core.enqueue.bind(core);
(core as any).enqueue = (to: string, env: any) => { const r = realEnq(to, env); view.update(env); engine.onInsert(env); return r; };

startHttpGateway(core, 8787);
startWsGateway(core, 8788);
console.log('Courier HTTP gateway on :8787');
console.log('Courier WS gateway on :8788');
