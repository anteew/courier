import { InMemoryQueue } from './core/queue.js';
import { TriggerEngine, TriggerRule } from './triggers/engine.js';
import { LatestPerAgentView } from './views/latest.js';
import { startHttpGateway } from './gateway/http.js';
import { startWsGateway } from './gateway/ws.js';
import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { Recorder } from './control/record.js';
import { PipeClient, makeDuplexPair } from './control/client.js';
import { PipeServer } from './control/server.js';

export const COURIER_VERSION = 'v1.0.0-stage1';
export const COURIER_FEATURES = ['enqueue', 'subscribe', 'stats', 'snapshot', 'triggers'];

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
// Wrap enqueue to update views and fire triggers
(core as any).enqueue = (to: string, env: any) => { const r = realEnq(to, env); try { view.update(env); engine.onInsert(env); } catch {}; return r; };

// Build in-process pipe between client and server
const [clientEnd, serverEnd] = makeDuplexPair();
const recorderPath = process.env.COURIER_RECORD_CONTROL;
const rec = new Recorder(recorderPath);
// Attach server
const server = new PipeServer(core, view, rec);
server.attach(serverEnd);
// Create client
const client = new PipeClient(clientEnd, rec);
client.hello().catch(()=>{});

// Config
const httpPort = Number(process.env.COURIER_HTTP_PORT || 8787);
const wsPort = Number(process.env.COURIER_WS_PORT || 8788);
const bind = process.env.COURIER_BIND || '127.0.0.1';
const disableHttp = String(process.env.COURIER_DISABLE_HTTP || 'false').toLowerCase() === 'true';
const disableWs = String(process.env.COURIER_DISABLE_WS || 'false').toLowerCase() === 'true';

if (!disableHttp) {
  startHttpGateway(client, view, httpPort, bind);
  console.log(`Courier HTTP gateway on ${bind}:${httpPort}`);
}
if (!disableWs) {
  startWsGateway(client, wsPort, bind);
  console.log(`Courier WS gateway on ${bind}:${wsPort}`);
}
