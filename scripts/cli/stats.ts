#!/usr/bin/env node
const args = process.argv.slice(2);
const streamIdx = args.indexOf('--stream');
const urlIdx = args.indexOf('--url');

const stream = streamIdx !== -1 ? args[streamIdx + 1] : undefined;
const url = urlIdx !== -1 ? args[urlIdx + 1] : 'http://127.0.0.1:8787';

if (!stream) {
  console.error('Usage: npm run cli:stats -- --stream <stream-id>');
  process.exit(1);
}

const fullUrl = `${url}/v1/stats?stream=${encodeURIComponent(stream)}`;
const res = await fetch(fullUrl);
if (!res.ok) {
  console.error(`Error: ${res.status} ${res.statusText}`);
  const text = await res.text();
  console.error(text);
  process.exit(1);
}

const stats = await res.json();
console.log(JSON.stringify(stats, null, 2));
