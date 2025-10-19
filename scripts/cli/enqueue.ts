import http from 'http';

function usage() {
  console.log('Usage: npm run cli:enqueue -- --to <stream> --type <type> --id <id> --payload <json>');
  process.exit(1);
}

const args = process.argv.slice(2);
function arg(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i+1] : undefined;
}

const to = arg('to');
const type = arg('type');
const id = arg('id') || `e-${Date.now()}`;
const payloadRaw = arg('payload') || '{}';
if (!to || !type) usage();

let payload: any = {};
try { payload = JSON.parse(payloadRaw); } catch { console.error('Invalid JSON for --payload'); process.exit(2); }

const env = { id, ts: new Date().toISOString(), type, payload };
const data = JSON.stringify({ to, envelope: env });

const req = http.request({ hostname: 'localhost', port: 8787, path: '/v1/enqueue', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
  let body = ''; res.on('data', (c)=>body+=c); res.on('end', ()=>{ console.log(body); });
});
req.on('error', (e)=>{ console.error('Request failed:', e.message); process.exit(2); });
req.write(data); req.end();

