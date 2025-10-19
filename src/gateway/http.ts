import http from 'http';
import { Envelope, parseEnvelope } from '../types/envelope.js';
import { PipeClient } from '../control/client.js';

export function startHttpGateway(client: PipeClient, port = 8787, bind = '127.0.0.1') {
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
            client.enqueue(env.to, env)
              .then(({ id }) => {
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ id }));
              })
              .catch((e: any) => {
                res.writeHead(400, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ error: e?.message || 'bad request' }));
              });
            return;
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
        client.stats(stream)
          .then((stats) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(stats)))
          .catch(()=> res.writeHead(500).end());
        return;
      }
      if (req.method === 'GET' && url.pathname === '/v1/snapshot') {
        const viewName = url.searchParams.get('view') || '';
        client.snapshot(viewName)
          .then((result)=> res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result)))
          .catch(()=> res.writeHead(500).end());
        return;
      }
      res.writeHead(404).end();
    } catch {
      res.writeHead(500).end();
    }
  });
  server.listen(port, bind);
  return server;
}
