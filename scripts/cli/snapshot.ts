#!/usr/bin/env node
const args = process.argv.slice(2);
const viewIdx = args.indexOf('--view');
const urlIdx = args.indexOf('--url');

const view = viewIdx !== -1 ? args[viewIdx + 1] : undefined;
const url = urlIdx !== -1 ? args[urlIdx + 1] : 'http://127.0.0.1:8787';

if (!view) {
  console.error('Usage: npm run cli:snapshot -- --view <view-name>');
  process.exit(1);
}

const fullUrl = `${url}/v1/snapshot?view=${encodeURIComponent(view)}`;
const res = await fetch(fullUrl);
if (!res.ok) {
  console.error(`Error: ${res.status} ${res.statusText}`);
  const text = await res.text();
  console.error(text);
  process.exit(1);
}

const snapshot = await res.json();
console.log(JSON.stringify(snapshot, null, 2));
