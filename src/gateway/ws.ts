import { WebSocketServer, WebSocket, RawData } from 'ws';
import { IncomingMessage } from 'http';
import { PipeClient } from '../control/client.js';

export function startWsGateway(client: PipeClient, port = 8788, bind = '127.0.0.1') {
  const wss = new WebSocketServer({ port, host: bind });
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url || '', 'ws://local');
    if (url.pathname !== '/v1/subscribe') { ws.close(); return; }
    const stream = url.searchParams.get('stream');
    if (!stream) { ws.close(); return; }
    client.subscribe(stream, (env)=> ws.send(JSON.stringify({ deliver: env })));
    ws.on('message', (data: RawData) => {
      try {
        const msg = JSON.parse(String(data));
        if (typeof msg.credit === 'number') client.grant(msg.credit);
        else if (typeof msg.ack === 'string') client.ack(msg.ack);
        else if (typeof msg.nack === 'string') client.nack(msg.nack);
      } catch {}
    });
  });
  return wss;
}
