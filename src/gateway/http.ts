import http from 'http';
import { Envelope, parseEnvelope } from '../types/envelope.js';
import { PipeClient } from '../control/client.js';
import { COURIER_VERSION, COURIER_FEATURES } from '../index.js';
import { LatestPerAgentView } from '../views/latest.js';

interface RateLimitConfig {
  enabled: boolean;
  perIpLimit: number;
  windowMs: number;
  exempt: string[];
}

class TokenBucket {
  private buckets = new Map<string, { tokens: number; lastRefill: number }>();
  constructor(private config: RateLimitConfig) {}
  
  tryConsume(ip: string): boolean {
    if (!this.config.enabled) return true;
    const now = Date.now();
    const bucket = this.buckets.get(ip) || { tokens: this.config.perIpLimit, lastRefill: now };
    const elapsed = now - bucket.lastRefill;
    const refillCount = Math.floor(elapsed / this.config.windowMs) * this.config.perIpLimit;
    bucket.tokens = Math.min(this.config.perIpLimit, bucket.tokens + refillCount);
    bucket.lastRefill = now;
    
    if (bucket.tokens > 0) {
      bucket.tokens--;
      this.buckets.set(ip, bucket);
      return true;
    }
    return false;
  }
}

function mapErrorToStatus(err: any): number {
  if (!err) return 500;
  const code = err.code || '';
  if (code === 'InvalidEnvelope') return 400;
  if (code === 'UnknownStream' || code === 'UnknownView') return 404;
  return 500;
}

function sendJson(res: http.ServerResponse, status: number, body: any) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function startHttpGateway(client: PipeClient, view: LatestPerAgentView, port = 8787, bind = '127.0.0.1') {
  const rateLimitConfig: RateLimitConfig = {
    enabled: String(process.env.COURIER_RATE_LIMIT || 'false').toLowerCase() === 'true',
    perIpLimit: Number(process.env.COURIER_RATE_LIMIT_PER_IP || 100),
    windowMs: Number(process.env.COURIER_RATE_LIMIT_WINDOW_MS || 60000),
    exempt: ['/health', '/v1/metrics', '/v1/live']
  };
  const rateLimiter = new TokenBucket(rateLimitConfig);
  let lastToken: string | undefined;
  let helloSent = false;
  
  // auth: begin
  const tokenAllowlist = process.env.COURIER_TOKENS ? new Set(process.env.COURIER_TOKENS.split(',').map(t => t.trim())) : null;
  const protectMetrics = String(process.env.COURIER_PROTECT_METRICS || 'false').toLowerCase() === 'true';
  const protectedEndpoints = ['/v1/enqueue', '/v1/stats', '/v1/snapshot'].concat(protectMetrics ? ['/v1/metrics'] : []);
  // auth: end
  
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const clientIp = req.socket.remoteAddress || 'unknown';
      const authHeader = req.headers['authorization'] || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
      
      // auth: begin
      if (tokenAllowlist && protectedEndpoints.includes(url.pathname)) {
        if (!token || !tokenAllowlist.has(token)) {
          sendJson(res, 401, { error: 'Unauthorized' });
          return;
        }
      }
      // auth: end
      
      if (!helloSent || token !== lastToken) {
        await client.hello([], token).catch(() => {});
        lastToken = token;
        helloSent = true;
      }
      
      if (!rateLimitConfig.exempt.includes(url.pathname)) {
        if (!rateLimiter.tryConsume(clientIp)) {
          sendJson(res, 429, { error: 'rate limit exceeded' });
          return;
        }
      }
      
      if (req.method === 'GET' && url.pathname === '/health') {
        sendJson(res, 200, { ok: true, version: COURIER_VERSION, features: COURIER_FEATURES });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/v1/enqueue') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
        try {
            const { to, envelope } = JSON.parse(body || '{}');
            const env = parseEnvelope({ to, ...(envelope || {}) });
            client.enqueue(env.to, env)
              .then(({ id }) => sendJson(res, 200, { id }))
              .catch((e: any) => sendJson(res, mapErrorToStatus(e), { error: e?.message || e?.detail || 'bad request' }));
            return;
          } catch (e: any) {
            sendJson(res, 400, { error: e?.message || 'invalid json' });
          }
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/v1/stats') {
        const stream = url.searchParams.get('stream');
        if (!stream) { sendJson(res, 400, { error: 'missing stream' }); return; }
        client.stats(stream)
          .then((stats) => sendJson(res, 200, stats))
          .catch((e: any) => sendJson(res, mapErrorToStatus(e), { error: e?.detail || 'stats failed' }));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/v1/snapshot') {
        const viewName = url.searchParams.get('view') || '';
        client.snapshot(viewName)
          .then((result) => sendJson(res, 200, result))
          .catch((e: any) => sendJson(res, mapErrorToStatus(e), { error: e?.detail || 'snapshot failed' }));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/v1/metrics') {
        client.metrics()
          .then((result) => sendJson(res, 200, result))
          .catch((e: any) => sendJson(res, mapErrorToStatus(e), { error: e?.detail || 'metrics failed' }));
        return;
      }
      // sse: begin
      if (req.method === 'GET' && url.pathname === '/v1/live') {
        const viewName = url.searchParams.get('view');
        if (viewName !== 'latestPerAgent') {
          sendJson(res, 404, { error: 'Unknown view' });
          return;
        }
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          'connection': 'keep-alive'
        });
        
        const heartbeat = setInterval(() => {
          res.write(': heartbeat\n\n');
        }, 30000);
        
        const updateHandler = (data: any) => {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        };
        view.on('update', updateHandler);
        
        req.on('close', () => {
          clearInterval(heartbeat);
          view.off('update', updateHandler);
        });
        
        res.write(`data: ${JSON.stringify({ connected: true })}\n\n`);
        return;
      }
      // sse: end
      res.writeHead(404).end();
    } catch {
      res.writeHead(500).end();
    }
  });
  server.listen(port, bind);
  return server;
}
