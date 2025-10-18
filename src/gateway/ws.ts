import { WebSocketServer } from 'ws';
import { InMemoryQueue } from '../core/queue.js';

export function startWsGateway(core: InMemoryQueue, port = 8788) {
  const wss = new WebSocketServer({ port });
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '', 'ws://local');
    if (url.pathname !== '/v1/subscribe') { ws.close(); return; }
    const stream = url.searchParams.get('stream');
    if (!stream) { ws.close(); return; }
    const sub = core.subscribe(stream);
    sub.onDeliver((env) => ws.send(JSON.stringify({ deliver: env })));
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(String(data));
        if (typeof msg.credit === 'number') core.grantCredit(sub.id, msg.credit);
        else if (typeof msg.ack === 'string') core.ack(sub.id, msg.ack);
        else if (typeof msg.nack === 'string') core.nack(sub.id, msg.nack);
      } catch {}
    });
  });
  return wss;
}
