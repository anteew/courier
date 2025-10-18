import WebSocket from 'ws';

function usage() {
  console.log('Usage: npm run cli:subscribe -- --stream <stream> [--credit N]');
  process.exit(1);
}

const args = process.argv.slice(2);
function arg(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i+1] : undefined;
}

const stream = arg('stream');
const credit = parseInt(arg('credit') || '1', 10);
if (!stream) usage();

const ws = new WebSocket(`ws://localhost:8788/v1/subscribe?stream=${encodeURIComponent(stream)}`);
ws.on('open', ()=>{
  ws.send(JSON.stringify({ credit }));
});
ws.on('message', (data)=>{
  try {
    const msg = JSON.parse(String(data));
    if (msg.deliver) {
      console.log('DELIVER', JSON.stringify(msg.deliver));
      if (msg.deliver.id) ws.send(JSON.stringify({ ack: msg.deliver.id }));
    } else if (msg.error) {
      console.error('ERROR', msg.error);
    }
  } catch (e) {
    console.log('RAW', String(data));
  }
});
ws.on('close', ()=>process.exit(0));
ws.on('error', (e)=>{ console.error('WS error', (e as any).message || e); process.exit(2); });

