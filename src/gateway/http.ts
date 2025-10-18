import http from 'http';
import { InMemoryQueue } from '../core/queue.js';
import { Envelope } from '../types/envelope.js';

export function startHttpGateway(core: InMemoryQueue, port = 8787) {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/v1/enqueue') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const { to, envelope } = JSON.parse(body);
          const env = envelope as Envelope;
          env.to = to || env.to;
          const { id } = core.enqueue(env.to, env);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id }));
        } catch (e: any) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: e?.message || 'bad request' }));
        }
      });
      return;
    }
    res.statusCode = 404; res.end();
  });
  server.listen(port);
  return server;
}
