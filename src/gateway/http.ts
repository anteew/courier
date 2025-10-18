import http from 'http';
import { InMemoryQueue } from '../core/queue.js';
import { Envelope, parseEnvelope } from '../types/envelope.js';
import { LatestPerAgentView } from '../views/latest.js';

export function startHttpGateway(core: InMemoryQueue, view: LatestPerAgentView, port = 8787) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      if (req.method === 'POST' && url.pathname === '/v1/enqueue') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const { to, envelope } = JSON.parse(body || '{}');
            const env = parseEnvelope({ to, ...(envelope || {}) });
            const { id } = core.enqueue(env.to, env);
            // update view
            view.update(env);
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ id }));
          } catch (e: any) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: e?.message || 'bad request' }));
          }
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/v1/stats') {
        const stream = url.searchParams.get('stream');
        if (!stream) { res.writeHead(400).end(JSON.stringify({ error: 'missing stream'})); return; }
        const stats = core.stats(stream);
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(stats));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/v1/snapshot') {
        const viewName = url.searchParams.get('view');
        if (viewName === 'latestPerAgent') {
          const rows = view.snapshot();
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ rows }));
          return;
        }
        res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'unknown view' }));
        return;
      }
      res.writeHead(404).end();
    } catch {
      res.writeHead(500).end();
    }
  });
  server.listen(port);
  return server;
}
