# Courier (Skeleton)

Minimal skeleton for an in-memory envelope queue + trigger server that integrates with mkolbol Stream Kernel.

## Layout
- RFC-COURIER.md — high-level concept
- TDS-COURIER-v1.md — v1 technical design spec
- vendor/mkolbol — pinned snapshot (courier-freeze-YYYYMMDD)
- src/ — TypeScript skeleton

## Dev

Install local deps (no global installs):

```bash
cd ~/repos/courier
npm ci || npm install
```

Run locally (uses ts-node locally):

```bash
npm run dev
# Courier HTTP gateway on :8787
# Courier WS gateway on :8788
```

Enqueue an envelope:

```bash
curl -sS -X POST http://localhost:8787/v1/enqueue \
  -H 'content-type: application/json' \
  -d '{"to":"agents/Jen/inbox","envelope":{"id":"e-1","ts":"2025-10-18T22:50:00Z","type":"notify","payload":{"msg":"hello"}}}'
```

Subscribe with credit (requires websocat):

```bash
websocat ws://localhost:8788/v1/subscribe?stream=agents/Jen/inbox -E -t -n <<< '{"credit": 1}'
```

Docs: see docs/mkctl-courier.md for mkctl helper ideas.
