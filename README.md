# Courier

Minimal in-memory envelope queue + trigger server for multi-agent workflows.

## Features (v1.0.0-stage1)

- **Enqueue/Subscribe**: HTTP & WebSocket APIs for message delivery with credit-based flow control
- **Stats & Metrics**: Per-stream and global operational visibility
- **Views**: Materialized snapshots (latestPerAgent)
- **Triggers**: Rule-based envelope forwarding with cooldown limits
- **Health & Diagnostics**: /health endpoint with version/features
- **Rate Limiting**: Optional per-IP token bucket (default: disabled)
- **Auth Plumbing**: Bearer token support in hello negotiation (no policy enforcement yet)

## Quick Start

Install dependencies:

```bash
npm ci
```

Start the server:

```bash
npm run dev
# Courier HTTP gateway on 127.0.0.1:8787
# Courier WS gateway on 127.0.0.1:8788
```

Run the end-to-end demo:

```bash
npm run demo:e2e
```

Run a non-blocking smoke test with timeout (kills old listeners, starts Courier, runs health/stats/metrics/snapshot, tails the log, and cleans up):

```bash
npm run test:watch
```

## API Endpoints

### HTTP Gateway (port 8787)

**Health check:**
```bash
curl http://127.0.0.1:8787/health
```

**Enqueue a message:**
```bash
curl -X POST http://127.0.0.1:8787/v1/enqueue \
  -H 'content-type: application/json' \
  -H 'Authorization: Bearer your-token' \
  -d '{"to":"agents/Jen/inbox","envelope":{"id":"e-1","ts":"2025-10-18T22:50:00Z","type":"notify","payload":{"msg":"hello"}}}'
```

**Get stream stats:**
```bash
npm run cli:stats -- --stream agents/Jen/inbox
```

**Get snapshot:**
```bash
npm run cli:snapshot -- --view latestPerAgent
```

**Get global metrics:**
```bash
curl http://127.0.0.1:8787/v1/metrics
```

**Live updates (SSE):**
```bash
curl -N 'http://127.0.0.1:8787/v1/live?view=latestPerAgent'
```

### WebSocket Gateway (port 8788)

Subscribe to a stream (requires websocat):

```bash
websocat ws://127.0.0.1:8788/v1/subscribe?stream=agents/Jen/inbox -E -t -n <<< '{"credit": 1}'
```

## Configuration

Environment variables:

```bash
# Server
COURIER_HTTP_PORT=8787
COURIER_WS_PORT=8788
COURIER_BIND=127.0.0.1
COURIER_DISABLE_HTTP=false
COURIER_DISABLE_WS=false

# Rate limiting (default: disabled)
COURIER_RATE_LIMIT=false
COURIER_RATE_LIMIT_PER_IP=100
COURIER_RATE_LIMIT_WINDOW_MS=60000
COURIER_TOKENS=dev-local                        # Optional allowlist for edge auth
COURIER_PROTECT_METRICS=false                   # Include /v1/metrics in token protection when true

# Control protocol recording
COURIER_RECORD_CONTROL=/path/to/control.jsonl

# Triggers config
COURIER_CONFIG=config/dev.yaml
```

See config/.env.dev for a complete example.

## CLI Tools

```bash
npm run cli:stats -- --stream <stream-id>      # Get stream statistics
npm run cli:snapshot -- --view <view-name>     # Get view snapshot
npm run cli:enqueue -- <args>                  # Enqueue a message
npm run cli:subscribe -- <args>                # Subscribe to a stream
npm run demo:e2e                                # Run end-to-end demo
npm run test:watch                              # Start + verify with timeout, then teardown
```

## Documentation

- [RFC-COURIER.md](RFC-COURIER.md) — High-level concept
- [TDS-COURIER-v1.md](TDS-COURIER-v1.md) — v1 technical design spec
- [TDS-STAGE1.md](TDS-STAGE1.md) — Stage 1 implementation notes
- [docs/mkctl-courier.md](docs/mkctl-courier.md) — mkctl helper guide
- Ava (Architect): Ava is your technical lead and will keep the scaffolding simple, safe, and reusable. Use agents to run code; Ava handles design and integrations.

## Architecture

```
src/
├── core/           # In-memory queue implementation
├── control/        # Control protocol (client/server)
├── gateway/        # HTTP & WebSocket gateways
├── triggers/       # Trigger engine
├── types/          # Envelope types
└── views/          # Materialized views
```

## Development

Build TypeScript:

```bash
npm run build
```

The project uses ts-node for local development (no build step required).

## Docker

Build and run with Docker:

```bash
# Build image
docker build -t courier:latest .

# Run with default ports
docker run -p 8787:8787 -p 8788:8788 courier:latest

# Run with environment variables
docker run -p 8787:8787 -p 8788:8788 \
  -e COURIER_RATE_LIMIT=true \
  -e COURIER_TOKENS=dev-local \
  courier:latest

# Run with mounted config
docker run -p 8787:8787 -p 8788:8788 \
  -v $(pwd)/config:/app/config \
  courier:latest
```

The Docker image exposes ports 8787 (HTTP) and 8788 (WebSocket).
