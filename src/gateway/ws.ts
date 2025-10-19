import { WebSocketServer, WebSocket, RawData } from 'ws';
import { IncomingMessage } from 'http';
import { PipeClient } from '../control/client.js';

function sendError(ws: WebSocket, code: string, message: string, closeCode?: number) {
  try {
    ws.send(JSON.stringify({ error: { code, message } }));
    if (closeCode) ws.close(closeCode, message);
  } catch {}
}

export function startWsGateway(client: PipeClient, port = 8788, bind = '127.0.0.1') {
  // auth: begin
  const tokenAllowlist = process.env.COURIER_TOKENS ? new Set(process.env.COURIER_TOKENS.split(',').map(t => t.trim())) : null;
  // auth: end
  
  const wss = new WebSocketServer({ port, host: bind });
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url || '', 'ws://local');
    if (url.pathname !== '/v1/subscribe') { ws.close(); return; }
    const stream = url.searchParams.get('stream');
    if (!stream) { ws.close(); return; }
    
    const authHeader = req.headers['authorization'] || '';
    const token = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    const bearerToken = token.startsWith('Bearer ') ? token.slice(7) : undefined;
    
    // auth: begin
    if (tokenAllowlist) {
      if (!bearerToken || !tokenAllowlist.has(bearerToken)) {
        sendError(ws, 'Unauthorized', 'Invalid or missing token', 1008);
        return;
      }
    }
    // auth: end
    
    client.hello([], bearerToken).catch(() => {});
    
    client.subscribe(stream, (env)=> ws.send(JSON.stringify({ deliver: env })));
    ws.on('message', (data: RawData) => {
      try {
        const msg = JSON.parse(String(data));
        if (typeof msg.credit === 'number') client.grant(msg.credit);
        else if (typeof msg.ack === 'string') client.ack(msg.ack);
        else if (typeof msg.nack === 'string') client.nack(msg.nack, msg.delayMs);
        else {
          sendError(ws, 'UnknownOp', 'Unknown operation', 1003);
        }
      } catch (e: any) {
        sendError(ws, 'InvalidJSON', e?.message || 'Malformed JSON', 1007);
      }
    });
  });
  return wss;
}
