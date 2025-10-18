import { spawn } from 'child_process';
import http from 'http';

function post(to: string, type: string, payload: any): Promise<void> {
  return new Promise((resolve, reject) => {
    const env = { id: `e-${Date.now()}`, ts: new Date().toISOString(), type, payload };
    const data = JSON.stringify({ to, envelope: env });
    const req = http.request({ hostname: 'localhost', port: 8787, path: '/v1/enqueue', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
      res.on('data', ()=>{}); res.on('end', ()=>resolve());
    });
    req.on('error', reject); req.write(data); req.end();
  });
}

async function main() {
  console.log('Subscribing to agents/architect/inbox with credit=1...');
  const sub = spawn(process.execPath, ['--loader','ts-node/esm','scripts/cli/subscribe.ts','--stream','agents/architect/inbox','--credit','1'], { stdio: ['ignore','pipe','inherit'] });
  let got = false;
  sub.stdout.on('data', (buf) => {
    const s = String(buf);
    process.stdout.write(s);
    if (s.includes('DELIVER')) { got = true; }
  });
  await new Promise((r)=>setTimeout(r, 500));
  console.log('Enqueuing Jen sprint.log to trigger notify...');
  await post('agents/Jen/outbox', 'sprint.log', { text: 'demo' });
  // wait up to 5s
  const deadline = Date.now() + 5000;
  while (!got && Date.now() < deadline) { await new Promise((r)=>setTimeout(r, 100)); }
  if (!got) console.error('Did not receive notification within 5s');
  sub.kill();
}

main().catch((e)=>{ console.error(e); process.exit(2); });

