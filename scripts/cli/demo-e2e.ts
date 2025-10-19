#!/usr/bin/env node
const BASE_URL = process.env.COURIER_URL || 'http://127.0.0.1:8787';

async function main() {
async function enqueue(to: string, envelope: any) {
  const res = await fetch(`${BASE_URL}/v1/enqueue`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ to, envelope })
  });
  if (!res.ok) throw new Error(`Enqueue failed: ${res.status}`);
  return res.json();
}

async function stats(stream: string) {
  const res = await fetch(`${BASE_URL}/v1/stats?stream=${encodeURIComponent(stream)}`);
  if (!res.ok) throw new Error(`Stats failed: ${res.status}`);
  return res.json();
}

async function snapshot(view: string) {
  const res = await fetch(`${BASE_URL}/v1/snapshot?view=${encodeURIComponent(view)}`);
  if (!res.ok) throw new Error(`Snapshot failed: ${res.status}`);
  return res.json();
}

async function health() {
  const res = await fetch(`${BASE_URL}/health`);
  if (!res.ok) throw new Error(`Health failed: ${res.status}`);
  return res.json();
}

async function metrics() {
  const res = await fetch(`${BASE_URL}/v1/metrics`);
  if (!res.ok) throw new Error(`Metrics failed: ${res.status}`);
  return res.json();
}

console.log('🚀 Courier E2E Demo\n');

console.log('1. Health check...');
const h = await health();
console.log(`   ✓ ${h.version} features: ${h.features.join(', ')}\n`);

console.log('2. Enqueue messages...');
const env1 = { id: 'e-demo-1', ts: new Date().toISOString(), type: 'task', payload: { task: 'Process order #123' } };
const env2 = { id: 'e-demo-2', ts: new Date().toISOString(), type: 'notify', payload: { message: 'Build complete' } };
await enqueue('agents/Alice/inbox', env1);
await enqueue('agents/Bob/inbox', env2);
console.log('   ✓ Enqueued 2 messages\n');

console.log('3. Check stream stats...');
const s1 = await stats('agents/Alice/inbox');
const s2 = await stats('agents/Bob/inbox');
console.log(`   ✓ Alice inbox: depth=${s1.depth}`);
console.log(`   ✓ Bob inbox: depth=${s2.depth}\n`);

console.log('4. View snapshot...');
const snap = await snapshot('latestPerAgent');
console.log(`   ✓ latestPerAgent has ${snap.rows.length} rows\n`);

console.log('5. Global metrics...');
const m = await metrics();
console.log(`   ✓ Tracked streams: ${m.streams.length}`);
m.streams.forEach((s: any) => {
  console.log(`     - ${s.id}: depth=${s.stats.depth}, rateIn=${s.stats.rateIn}`);
});

console.log('\n✅ E2E demo complete!');
}

main().catch((e) => {
  console.error('❌ Demo failed:', e.message);
  process.exit(1);
});
